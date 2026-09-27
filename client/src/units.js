// Kaiju, tank and civilian visuals (Quaternius CC0 models) with placeholder fallbacks.
import * as THREE from 'three';
import { loadGLB } from './assets.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TUNING } from '../../shared/tuning.js';

// Asset calibration (not gameplay tuning): which way each model faces
// natively, how big to draw it, and which animation clips to use.
const MODELS = {
  kaiju: {
    url: './assets/units/trex.glb',
    yaw: 0,                    // faces +z natively
    fit: 'length', size: () => TUNING.kaijuLength,
    walk: 'Armature|TRex_Walk', idle: 'Armature|TRex_Idle',
    attack: 'Armature|TRex_Attack', death: 'Armature|TRex_Death',
    flash: true,
  },
  tank: {
    url: './assets/units/tank.glb',
    yaw: Math.PI / 2,          // faces -x natively
    fit: 'length', size: () => TUNING.tankLength,
    walk: 'TankArmature|Tank_Forward', idle: null,
    tintMaterial: 'Main',
  },
  // Evacuation civilians: the Quaternius soldier with every weapon and the
  // shoulder pads hidden, shirts tinted from CIVILIAN_COLOURS.
  civilian: {
    url: './assets/units/soldier.glb',
    yaw: 0,                    // faces +z natively
    fit: 'height', size: () => TUNING.civilianHeight,
    walk: 'CharacterArmature|Run', idle: 'CharacterArmature|Wave',
    tintMaterial: 'Character_Main',
    keepMeshes: ['Body', 'Head'],
  },
};

export const TANK_COLOURS = [0x4f7cff, 0xf5a524, 0xe5484d, 0xa35cf0, 0x2fbf71, 0xffffff];
const CIVILIAN_COLOURS = [0xe8d44d, 0xe07a5f, 0x81b29a, 0xf2cc8f, 0x9d8df1, 0x5fa8d3, 0xf28482, 0xcdb4db];
export const colourHex = (slot) => '#' + TANK_COLOURS[slot % TANK_COLOURS.length].toString(16).padStart(6, '0');

const sources = {};
export async function loadUnitModels() {
  await Promise.all(Object.entries(MODELS).map(async ([role, m]) => {
    try { sources[role] = await loadGLB(m.url); }
    catch (e) { console.warn(`[units] ${role} model failed, using placeholder`, e); }
  }));
}

function placeholder(role, colour) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: role === 'kaiju' ? 0x3e9c4a : colour });
  if (role === 'kaiju') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), mat);
    body.position.y = 0.7; g.add(body);
  } else if (role === 'tank') {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.6), mat);
    hull.position.y = 0.12; g.add(hull);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat);
    body.position.y = 0.15; g.add(body);
  }
  return g;
}

// A drawn unit: `object` is positioned/rotated by game state.
export function createUnit(role, slot, isMine) {
  const colour = role === 'kaiju' ? 0x3e9c4a
    : role === 'civilian' ? CIVILIAN_COLOURS[Math.abs(slot) % CIVILIAN_COLOURS.length]
    : TANK_COLOURS[Math.max(0, slot) % TANK_COLOURS.length];
  const outer = new THREE.Group();
  const m = MODELS[role];
  const src = sources[role];
  let mixer = null;
  const actions = {};
  const flashMats = [];

  if (src) {
    const model = SkeletonUtils.clone(src.scene);
    if (m.keepMeshes) {
      model.traverse(o => {
        if (o.isMesh && !m.keepMeshes.includes(o.name) && !m.keepMeshes.includes(o.parent?.name)) o.visible = false;
      });
    }
    // measure in native orientation (bones posed, skinning applied)
    model.updateMatrixWorld(true);
    model.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
    const box = new THREE.Box3();
    model.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o, true); });
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const length = Math.abs(Math.sin(m.yaw)) > 0.5 ? size.x : size.z;
    const s = m.size() / (m.fit === 'height' ? size.y : length);
    model.position.set(-centre.x, -box.min.y, -centre.z);
    const scaled = new THREE.Group();
    scaled.add(model);
    scaled.scale.setScalar(s);
    const yawed = new THREE.Group();
    yawed.add(scaled);
    yawed.rotation.y = m.yaw;
    outer.add(yawed);

    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = TUNING.shadows && role !== 'civilian';
      o.frustumCulled = false; // skinned meshes cull badly after rescale
      if (m.tintMaterial && o.material?.name === m.tintMaterial) {
        o.material = o.material.clone();
        o.material.color.set(colour);
      }
      if (m.flash) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0xff2a1a);
        o.material.emissiveIntensity = 0;
        flashMats.push(o.material);
      }
    });

    mixer = new THREE.AnimationMixer(model);
    for (const clip of src.animations) actions[clip.name] = mixer.clipAction(clip);
  } else {
    outer.add(placeholder(role, colour));
  }

  // Ring under your own unit so you can find yourself.
  if (isMine) {
    const big = role === 'kaiju';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(big ? 0.55 : 0.36, big ? 0.68 : 0.46, 40),
      new THREE.MeshBasicMaterial({ color: big ? 0x7dff8a : colour, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    outer.add(ring);
  }

  let current = null, oneShotLeft = 0, flash = 0, dead = false;
  function play(name, once = false) {
    if (!mixer || current === name) return;
    const next = name ? actions[name] : null;
    if (current && actions[current]) actions[current].fadeOut(0.15);
    if (next) {
      next.reset();
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      next.fadeIn(0.15).play();
    }
    current = name;
  }
  play(m.idle);

  return {
    object: outer,
    role,
    // moving/firing drive the looped animation; one-shots (attack) override briefly
    update(dt, moving, firing = false) {
      if (!dead) {
        oneShotLeft = Math.max(0, oneShotLeft - dt);
        if (oneShotLeft <= 0) play(firing && m.shoot ? m.shoot : moving ? m.walk : m.idle);
      }
      mixer?.update(dt);
      if (flashMats.length) {
        flash = Math.max(0, flash - dt * 6);
        for (const mat of flashMats) mat.emissiveIntensity = flash;
      }
    },
    attack() {
      if (!m.attack || !actions[m.attack]) return;
      current = null; play(m.attack, true);
      oneShotLeft = actions[m.attack].getClip().duration * 0.8;
    },
    hit(amount = 1) { flash = Math.min(1.2, flash + 0.5 * amount); },
    die() {
      dead = true;
      if (m.death && actions[m.death]) { current = null; play(m.death, true); }
    },
    revive() { dead = false; current = null; mixer?.stopAllAction(); play(m.idle); },
    get dead() { return dead; },
  };
}
