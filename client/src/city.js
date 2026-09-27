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

// One InstancedMesh per mesh inside `src`, placed at each matrix.
function instanced(src, placements, { cast = false, receive = false } = {}) {
  const group = new THREE.Group();
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const m = new THREE.Matrix4();
  src.traverse(o => {
    if (!o.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
    placements.forEach((p, i) => im.setMatrixAt(i, m.multiplyMatrices(p, local)));
    im.castShadow = cast && TUNING.shadows; im.receiveShadow = receive && TUNING.shadows;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
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

  // Roads and lot slabs never change, so each tile model is drawn as one
  // InstancedMesh (a handful of draw calls instead of ~600).
  const jobs = [];
  const roadPlacements = new Map(); // model → [Matrix4]
  const lots = [], parks = [];
  const tmp = new THREE.Object3D();
  for (let z = 0; z < city.depth; z++) {
    for (let x = 0; x < city.width; x++) {
      if (isRoad(x, z)) {
        const mask = (isRoad(x, z - 1) ? N : 0) | (isRoad(x + 1, z) ? E : 0) |
                     (isRoad(x, z + 1) ? S : 0) | (isRoad(x - 1, z) ? W : 0);
        const { model, rot } = roadFor(mask);
        tmp.position.set(x, 0, z); tmp.rotation.set(0, rot, 0); tmp.updateMatrix();
        if (!roadPlacements.has(model)) roadPlacements.set(model, []);
        roadPlacements.get(model).push(tmp.matrix.clone());
      } else {
        const kind = city.buildings[city.owner[z][x]]?.kind;
        (kind === 'park' ? parks : lots).push([x, z]);
      }
    }
  }
  for (const [model, mats] of roadPlacements) {
    jobs.push(load(A(model)).then(src => root.add(instanced(src, mats, { receive: true }))));
  }
  for (const [cells, mat] of [[lots, lotMat], [parks, parkMat]]) {
    const im = new THREE.InstancedMesh(lotGeo, mat, cells.length);
    cells.forEach(([x, z], i) => { tmp.position.set(x, 0, z); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix); });
    im.receiveShadow = TUNING.shadows;
    root.add(im);
  }

  const buildingObjects = new Map(); // building id → Object3D (damaged / faded individually)
  const trees = new Map();
  for (const b of city.buildings) {
    if (b.kind === 'park') {
      for (const [x, z] of b.cells) {
        const which = (x * 7 + z * 13) % 2 ? 'suburbs/tree-large' : 'suburbs/tree-small';
        for (const [ox, oz] of [[-0.25, -0.2], [0.22, 0.25], [0.2, -0.28]]) {
          tmp.position.set(x + ox, 0, z + oz); tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1.3); tmp.updateMatrix();
          if (!trees.has(which)) trees.set(which, []);
          trees.get(which).push(tmp.matrix.clone());
        }
        tmp.scale.setScalar(1);
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

  for (const [which, mats] of trees) jobs.push(load(A(which)).then(src => root.add(instanced(src, mats, { cast: true, receive: true }))));

  // A missing model shouldn't stop the game from loading; log it and carry on.
  const failed = (await Promise.allSettled(jobs)).filter(r => r.status === 'rejected');
  if (failed.length) console.warn(`[city] ${failed.length} model(s) failed to load`, failed[0].reason);
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
