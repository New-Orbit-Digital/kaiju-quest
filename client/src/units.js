// Kaiju + tank visuals (Quaternius CC0 models) with a placeholder fallback.
import * as THREE from 'three';
import { loadGLB } from './assets.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TUNING } from '../../shared/tuning.js';

// Asset calibration (not gameplay tuning): which way each model faces
// natively, how big to draw it, and which animation clips to use.
const MODELS = {
  kaiju: {
    url: './assets/units/trex.glb',
    yaw: 0,                    // model faces +z natively
    fit: 'length', size: () => TUNING.kaijuLength,
    walk: 'Armature|TRex_Walk', idle: 'Armature|TRex_Idle',
  },
  tank: {
    url: './assets/units/tank.glb',
    yaw: Math.PI / 2,          // model faces -x natively
    fit: 'length', size: () => TUNING.tankLength,
    walk: 'TankArmature|Tank_Forward', idle: null,
    tintMaterial: 'Main',
  },
};

export const TANK_COLOURS = [0x4f7cff, 0xf5a524, 0xe5484d, 0xa35cf0, 0x2fbf71, 0xffffff];

const sources = {};
export async function loadUnitModels() {
  await Promise.all(Object.entries(MODELS).map(async ([role, m]) => {
    try { sources[role] = await loadGLB(m.url); }
    catch (e) { console.warn(`[units] ${role} model failed, using placeholder`, e); }
  }));
}

function placeholder(role, colour) {
  const g = new THREE.Group();
  if (role === 'kaiju') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e9c4a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), mat);
    body.position.y = 0.7; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), mat);
    head.position.set(0, 1.5, 0.25); g.add(head);
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: colour });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.6), mat);
    hull.position.y = 0.12; g.add(hull);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.45), mat);
    gun.position.set(0, 0.28, 0.3); g.add(gun);
  }
  return g;
}

// A drawn unit: outer group is positioned/rotated by game state.
export function createUnit(role, slot, isMine) {
  const colour = role === 'tank' ? TANK_COLOURS[slot % TANK_COLOURS.length] : 0x3e9c4a;
  const outer = new THREE.Group();
  const m = MODELS[role];
  const src = sources[role];
  let mixer = null, actions = {};

  if (src) {
    const model = SkeletonUtils.clone(src.scene);
    // measure in native orientation (bones posed, skinning applied),
    // then yaw so the model faces +z
    model.updateMatrixWorld(true);
    model.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const length = Math.abs(Math.sin(m.yaw)) > 0.5 ? size.x : size.z;
    const s = m.size() / length;
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
      o.castShadow = TUNING.shadows;
      o.frustumCulled = false; // skinned meshes cull badly after rescale
      if (m.tintMaterial && o.material?.name === m.tintMaterial) {
        o.material = o.material.clone();
        o.material.color.set(colour);
      }
    });

    mixer = new THREE.AnimationMixer(model);
    for (const clip of src.animations) actions[clip.name] = mixer.clipAction(clip);
  } else {
    outer.add(placeholder(role, colour));
  }

  // Ring under your own unit so you can find yourself.
  if (isMine) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(role === 'kaiju' ? 0.55 : 0.36, role === 'kaiju' ? 0.68 : 0.46, 40),
      new THREE.MeshBasicMaterial({ color: role === 'kaiju' ? 0x7dff8a : colour, transparent: true, opacity: 0.85 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    outer.add(ring);
  }

  let current = null;
  function play(name) {
    if (!mixer || current === name) return;
    const next = name ? actions[name] : null;
    if (current && actions[current]) actions[current].fadeOut(0.2);
    if (next) next.reset().fadeIn(0.2).play();
    current = name;
  }
  play(m.idle);

  return {
    object: outer,
    update(dt, moving) {
      play(moving ? m.walk : m.idle);
      mixer?.update(dt);
    },
  };
}
