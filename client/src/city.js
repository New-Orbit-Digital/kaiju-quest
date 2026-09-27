// Builds the 3D city from shared/map.js using the Kenney City Kits.
import * as THREE from 'three';
import { parseCity } from '../../shared/map.js';
import { TUNING } from '../../shared/tuning.js';
import { modelForBuilding, ROAD_MODELS, TREE_MODELS } from './cityplan.js';
import { loadGLB } from './assets.js';

const cache = new Map();
function load(url) {
  if (!cache.has(url)) cache.set(url, loadGLB(url).then(g => g.scene));
  return cache.get(url);
}
const A = (p) => `./assets/city/${p}.glb`;

// Road tiles: native open sides (checked with a top-down render, north = -z).
const N = 1, E = 2, S = 4, W = 8;
const ROADS = [
  { model: 'roads/road-crossroad',    mask: N | E | S | W },
  { model: 'roads/road-intersection', mask: E | W | S },
  { model: 'roads/road-straight',     mask: E | W },
  { model: 'roads/road-bend',         mask: W | S },
  { model: 'roads/road-end',          mask: E },
];
// rotation.y = +90° turns E→N, N→W, W→S, S→E
const rot90 = (m) => ((m & E) ? N : 0) | ((m & N) ? W : 0) | ((m & W) ? S : 0) | ((m & S) ? E : 0);
const bits = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

function roadFor(mask) {
  if (bits(mask) <= 1) mask = mask || E; // dead end / isolated
  for (const r of ROADS) {
    let m = r.mask;
    for (let k = 0; k < 4; k++) {
      if (m === mask) return { model: r.model, rot: k * Math.PI / 2 };
      m = rot90(m);
    }
  }
  return { model: 'roads/road-crossroad', rot: 0 };
}

// Fit a model into a lot: recentre footprint, sit on y=0, scale to fit.
function fitToLot(obj, lotSize) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = (lotSize * TUNING.buildingFootprint) / Math.max(size.x, size.z);
  const inner = new THREE.Group();
  obj.position.set(-centre.x, -box.min.y, -centre.z);
  inner.add(obj);
  inner.scale.setScalar(s);
  return inner;
}

function shadowsOn(obj) {
  obj.traverse(o => { if (o.isMesh) { o.castShadow = TUNING.shadows; o.receiveShadow = TUNING.shadows; } });
}

export async function buildCity(scene) {
  const city = parseCity();
  const root = new THREE.Group();
  root.name = 'city';
  scene.add(root);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(city.width + 40, city.depth + 40),
    new THREE.MeshStandardMaterial({ color: 0x6f8f5a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((city.width - 1) / 2, -0.01, (city.depth - 1) / 2);
  ground.receiveShadow = TUNING.shadows;
  root.add(ground);

  const isRoad = (x, z) => city.tiles[z]?.[x] === '#';
  const lotMat = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 1 });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x5f9a4a, roughness: 1 });
  const lotGeo = new THREE.BoxGeometry(1, 0.02, 1);

  const jobs = [];
  for (let z = 0; z < city.depth; z++) {
    for (let x = 0; x < city.width; x++) {
      if (isRoad(x, z)) {
        const mask = (isRoad(x, z - 1) ? N : 0) | (isRoad(x + 1, z) ? E : 0) |
                     (isRoad(x, z + 1) ? S : 0) | (isRoad(x - 1, z) ? W : 0);
        const { model, rot } = roadFor(mask);
        jobs.push(load(A(model)).then(src => {
          const o = src.clone();
          o.position.set(x, 0, z);
          o.rotation.y = rot;
          o.traverse(m => { if (m.isMesh) m.receiveShadow = TUNING.shadows; });
          root.add(o);
        }));
      } else {
        const id = city.owner[z][x];
        const kind = city.buildings[id]?.kind;
        const slab = new THREE.Mesh(lotGeo, kind === 'park' ? parkMat : lotMat);
        slab.position.set(x, 0.0, z);
        slab.receiveShadow = TUNING.shadows;
        root.add(slab);
      }
    }
  }

  const buildingObjects = new Map(); // building id → Object3D (P02 damages these)
  for (const b of city.buildings) {
    if (b.kind === 'park') {
      for (const [x, z] of b.cells) {
        const which = (x * 7 + z * 13) % 2 ? 'suburbs/tree-large' : 'suburbs/tree-small';
        jobs.push(load(A(which)).then(src => {
          for (const [ox, oz] of [[-0.25, -0.2], [0.22, 0.25], [0.2, -0.28]]) {
            const t = src.clone();
            t.position.set(x + ox, 0, z + oz);
            t.scale.setScalar(1.3);
            shadowsOn(t);
            root.add(t);
          }
        }));
      }
      continue;
    }
    const model = modelForBuilding(b);
    // Face the front (+z in the Kenney models) toward a neighbouring street.
    const faces = [];
    for (const [cx, cz] of b.cells) {
      if (isRoad(cx, cz + 1)) faces.push(0);             // street to the south
      if (isRoad(cx + 1, cz)) faces.push(Math.PI / 2);   // east
      if (isRoad(cx, cz - 1)) faces.push(Math.PI);       // north
      if (isRoad(cx - 1, cz)) faces.push(-Math.PI / 2);  // west
    }
    const rot = faces.length ? faces[b.id % faces.length] : 0;
    jobs.push(load(A(model)).then(src => {
      const o = fitToLot(src.clone(), b.size);
      const g = new THREE.Group();
      g.add(o);
      g.position.set(b.cx, 0.01, b.cz);
      g.rotation.y = rot;
      g.userData.buildingId = b.id;
      shadowsOn(g);
      // own materials so this building can fade without fading its twins
      g.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; } });
      g.updateMatrixWorld(true);
      g.userData.box = new THREE.Box3().setFromObject(g);
      g.userData.fade = 1;
      root.add(g);
      buildingObjects.set(b.id, g);
    }));
  }

  await Promise.all(jobs);
  return { city, root, buildingObjects };
}

// Fade any building standing between the camera and a unit, so nobody
// loses sight of the kaiju or the tanks behind a block of flats.
const ray = new THREE.Ray();
const fwd = new THREE.Vector3();
const hit = new THREE.Vector3();
export function fadeOccluders(buildingObjects, camera, unitPoints, dt) {
  camera.getWorldDirection(fwd);
  const blocking = new Set();
  for (const p of unitPoints) {
    for (const h of [0.15, 0.6, 1.1]) {
      ray.origin.set(p.x, h, p.z).addScaledVector(fwd, -100);
      ray.direction.copy(fwd);
      const dist = 100 - 0.05;
      for (const [id, g] of buildingObjects) {
        if (blocking.has(id)) continue;
        if (ray.intersectBox(g.userData.box, hit) && hit.distanceTo(ray.origin) < dist) blocking.add(id);
      }
    }
  }
  const k = Math.min(1, dt * 10);
  for (const [id, g] of buildingObjects) {
    const want = blocking.has(id) ? TUNING.occluderOpacity : 1;
    if (Math.abs(g.userData.fade - want) < 0.005 && g.userData.fade === want) continue;
    g.userData.fade += (want - g.userData.fade) * k;
    if (Math.abs(g.userData.fade - want) < 0.01) g.userData.fade = want;
    const f = g.userData.fade;
    g.traverse(m => {
      if (!m.isMesh) return;
      m.material.opacity = f;
      m.material.depthWrite = f > 0.99;
      m.castShadow = f > 0.99 && TUNING.shadows;
    });
  }
}
