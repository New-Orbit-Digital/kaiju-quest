// Ground markings: the Evacuation civilians' merged path network, your own
// tap-to-move route (destination + smash target), and the push-to-smash wind-up.
import * as THREE from 'three';
import { decodePath } from '../../shared/game.js';

// Flat strips along tile edges (centre to centre), drawn once per edge however
// many paths use it, so overlapping routes merge into one network instead of
// stacking. Opaque (no alpha) so strips meeting at a corner never double up.
function createStrips(scene, { color, width, y, max = 1200 }) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1;
  scene.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let lastKey = '';
  return {
    mesh,
    // edges: [{ a:{x,z}, b:{x,z}, w? }] (w = width multiplier)
    set(edges, key) {
      if (key === lastKey) return;
      lastKey = key;
      let i = 0;
      for (const e of edges) {
        if (i >= max) break;
        const w = width * (e.w || 1);
        const horiz = e.a.z === e.b.z;
        p.set((e.a.x + e.b.x) / 2, y, (e.a.z + e.b.z) / 2);
        q.setFromAxisAngle(up, horiz ? 0 : Math.PI / 2);
        s.set(1 + w, 1, w);     // overshoot by the width so corners close up
        m.compose(p, q, s);
        mesh.setMatrixAt(i++, m);
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
    },
    set visible(v) { mesh.visible = v; },
  };
}

// The rest of a path from wherever the walker is now.
function remaining(path, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i].x - x, path[i].z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return path.slice(best);
}
const edgeKey = (a, b) => (a.x < b.x || (a.x === b.x && a.z < b.z)) ? `${a.x},${a.z}|${b.x},${b.z}` : `${b.x},${b.z}|${a.x},${a.z}`;

export function createCivilianPaths(scene) {
  const strips = createStrips(scene, { color: 0x86d99a, width: 0.1, y: 0.036 });
  const cache = new Map();   // path string → decoded
  return {
    strips,
    sync(state, civilianViews) {
      const on = state?.mode === 'evac' && state.phase === 'playing' && state.civilians?.size;
      strips.visible = !!on;
      if (!on) { strips.set([], ''); return; }
      const edges = new Map();
      state.civilians.forEach((c, id) => {
        if (!c.path) return;
        let path = cache.get(c.path);
        if (!path) { path = decodePath(c.path); cache.set(c.path, path); if (cache.size > 400) cache.clear(); }
        const pos = civilianViews.get(id)?.display || c;
        const rest = remaining(path, pos.x, pos.z);
        for (let i = 1; i < rest.length; i++) {
          const k = edgeKey(rest[i - 1], rest[i]);
          const e = edges.get(k);
          if (e) e.n++; else edges.set(k, { a: rest[i - 1], b: rest[i], n: 1 });
        }
      });
      // a busier edge draws a little wider, so merged routes read as one trunk
      const list = [...edges.values()];
      for (const e of list) e.w = 1 + Math.min(3, e.n - 1) * 0.35;
      strips.set(list, [...edges.keys()].sort().join(' ') + list.map(e => e.n).join(''));
    },
  };
}

export function createRouteMarks(scene, city) {
  const strips = createStrips(scene, { color: 0xf2f5f8, width: 0.12, y: 0.042, max: 400 });
  // destination: a ring on the last tile
  const dest = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 28),
    new THREE.MeshBasicMaterial({ color: 0xf2f5f8, transparent: true, opacity: 0.9, depthWrite: false }));
  dest.rotation.x = -Math.PI / 2; dest.visible = false; scene.add(dest);
  // smash target: a square outline around the building's lot, pulsing
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    new THREE.LineBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9 }));
  outline.visible = false; scene.add(outline);
  // push-to-smash wind-up: a square that fills on the tile being pushed
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.45, depthWrite: false }));
  fill.visible = false; scene.add(fill);
  let t = 0, lastRoute = '';
  let path = [];
  return {
    sync(me, display, dt) {
      t += dt;
      const alive = me && me.alive;
      // route line + destination
      if (!alive || !me.route) { strips.set([], ''); dest.visible = false; lastRoute = ''; path = []; }
      else {
        if (me.route !== lastRoute) { lastRoute = me.route; path = decodePath(me.route); }
        const rest = remaining(path, display.x, display.z);
        const edges = [];
        for (let i = 1; i < rest.length; i++) edges.push({ a: rest[i - 1], b: rest[i] });
        strips.set(edges, edges.map(e => edgeKey(e.a, e.b)).join(' '));
        const end = path[path.length - 1];
        dest.visible = me.routeBid < 0 && !!end;
        if (end) { dest.position.set(end.x, 0.03, end.z); dest.scale.setScalar(1 + 0.12 * Math.sin(t * 5)); }
      }
      // the building a tap route will smash
      const b = alive && me.routeBid >= 0 ? city.buildings[me.routeBid] : null;
      outline.visible = !!b;
      if (b) {
        outline.position.set(b.x + (b.size - 1) / 2, 0.05, b.z + (b.size - 1) / 2);
        outline.scale.set(b.size * 0.98, 1, b.size * 0.98);
        outline.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 4));
      }
      // wind-up on the pushed tile (grows to a full tile, then stays lit while smashing)
      const w = alive && me.role === 'kaiju' ? me.windup || 0 : 0;
      fill.visible = w > 0.02;
      if (fill.visible) {
        fill.position.set(me.aimX, 0.06, me.aimZ);
        const s = 0.3 + 0.62 * w;
        fill.scale.set(s, 1, s);
        fill.material.opacity = w >= 1 ? 0.35 + 0.25 * Math.abs(Math.sin(t * 10)) : 0.45;
      }
    },
  };
}
