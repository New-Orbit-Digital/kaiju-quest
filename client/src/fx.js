// Short-lived effects (tracers, blasts, dust) and building damage/rubble.
import * as THREE from 'three';

const live = []; // { obj, life, max, update(t) }

export function initFx(scene) {
  function add(obj, life, update) { scene.add(obj); live.push({ obj, life, max: life, update }); }

  const tracerMat = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });

  return {
    tracer(from, to, color = 0xffd66b) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)]);
      const line = new THREE.Line(geo, tracerMat(color));
      add(line, 0.12, (t) => { line.material.opacity = t; });
    },

    blast(x, z, size = 1, color = 0xff8a2a) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3 * size, 12, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      ball.position.set(x, 0.25 * size, z);
      add(ball, 0.55, (t) => { ball.scale.setScalar(1 + (1 - t) * 2.2); ball.material.opacity = t * 0.9; });
      this.dust(x, z, 0.6 * size, 0x3a3a3a);
    },

    dust(x, z, size = 1, color = 0xb8b1a3) {
      for (let i = 0; i < 6; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.18 * size, 8, 6),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
        const a = (i / 6) * Math.PI * 2, r = 0.25 * size;
        puff.position.set(x + Math.cos(a) * r, 0.15 * size, z + Math.sin(a) * r);
        const vy = 0.4 + Math.random() * 0.4;
        add(puff, 0.9, (t, dt) => {
          puff.position.y += vy * dt; puff.scale.setScalar(1 + (1 - t) * 1.8); puff.material.opacity = t * 0.7;
        });
      }
    },

    // green "+" sparks rising from a building being repaired
    repair(x, z, size = 1) {
      for (let i = 0; i < 4; i++) {
        const spark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06),
          new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 1, depthWrite: false }));
        spark.position.set(x + (Math.random() - 0.5) * 0.6 * size, 0.3 + Math.random() * 0.6 * size, z + (Math.random() - 0.5) * 0.6 * size);
        add(spark, 0.8, (t, dt) => { spark.position.y += 0.6 * dt; spark.material.opacity = t; spark.rotation.y += dt * 4; });
      }
    },

    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const f = live[i];
        f.life -= dt;
        if (f.life <= 0) {
          scene.remove(f.obj);
          f.obj.geometry?.dispose(); f.obj.material?.dispose();
          live.splice(i, 1);
        } else f.update(f.life / f.max, dt);
      }
    },
  };
}

// ── Buildings: darken with damage, shake on hits, rubble when destroyed ──
const RUBBLE_COLOURS = {
  house: [0x8f8a80, 0x6b6660, 0x3f8f5a, 0xa39a8a],
  commercial: [0x8a8f98, 0x5e646e, 0x7da3c4, 0xa7a9ad],
  industrial: [0x7c7a74, 0x5a5854, 0xc9a23a, 0x9a978f],
  tower: [0x7d8590, 0x4e5560, 0x6d9bc6, 0xb0b4ba],
};

function makeRubble(b) {
  const g = new THREE.Group();
  const palette = RUBBLE_COLOURS[b.kind] || RUBBLE_COLOURS.house;
  const size = b.size;
  let seed = b.id * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(size * 0.9, 0.04, size * 0.9),
    new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 1 }));
  slab.position.y = 0.02; slab.receiveShadow = true; g.add(slab);
  const n = 10 * size * size;
  for (let i = 0; i < n; i++) {
    const w = (0.08 + rnd() * 0.22) * size, h = 0.04 + rnd() * 0.16 * size;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.6 + rnd())),
      new THREE.MeshStandardMaterial({ color: palette[Math.floor(rnd() * palette.length)], roughness: 1 }));
    chunk.position.set((rnd() - 0.5) * size * 0.8, 0.04 + h / 2, (rnd() - 0.5) * size * 0.8);
    chunk.rotation.set((rnd() - 0.5) * 0.6, rnd() * Math.PI, (rnd() - 0.5) * 0.6);
    chunk.castShadow = true; chunk.receiveShadow = true;
    g.add(chunk);
  }
  g.position.set(b.cx, 0, b.cz);
  return g;
}

export function createBuildingDamage(scene, city, buildingObjects) {
  const known = new Map();   // id → last hp seen
  const shakes = new Map();  // id → seconds left
  const rubble = new Map();  // id → group
  const maxHp = new Map();

  // remember original colours so damage can darken and a new round can restore
  for (const [id, g] of buildingObjects) {
    g.traverse(m => { if (m.isMesh) m.userData.baseColor = m.material.color.clone(); });
  }

  function apply(id, hp) {
    const g = buildingObjects.get(id), b = city.buildings[id];
    if (!g) return;
    if (!maxHp.has(id) || hp > maxHp.get(id)) maxHp.set(id, Math.max(hp, maxHp.get(id) || 0));
    const frac = maxHp.get(id) ? hp / maxHp.get(id) : 1;
    g.visible = hp > 0;
    const k = 0.45 + 0.55 * frac;
    g.traverse(m => { if (m.isMesh && m.userData.baseColor) m.material.color.copy(m.userData.baseColor).multiplyScalar(k); });
    if (hp <= 0 && !rubble.has(id)) { const r = makeRubble(b); scene.add(r); rubble.set(id, r); }
    if (hp > 0 && rubble.has(id)) { scene.remove(rubble.get(id)); rubble.delete(id); }
  }

  return {
    // hpList: array-like of building HP from game state
    sync(hpList, dt) {
      const n = hpList?.length || 0;
      for (let id = 0; id < n; id++) {
        const hp = hpList[id];
        if (known.get(id) !== hp) {
          if (known.has(id) && hp < known.get(id) && hp > 0) shakes.set(id, 0.25);
          known.set(id, hp);
          apply(id, hp);
        }
      }
      for (const [id, left] of shakes) {
        const g = buildingObjects.get(id);
        const inner = g?.children[0];
        if (!inner) { shakes.delete(id); continue; }
        const t = left - dt;
        if (t <= 0) { inner.position.x = 0; inner.position.z = 0; shakes.delete(id); continue; }
        inner.position.x = Math.sin(t * 90) * 0.04 * t / 0.25;
        inner.position.z = Math.cos(t * 70) * 0.03 * t / 0.25;
        shakes.set(id, t);
      }
    },
  };
}

// ── Roadblocks: striped barriers, drawn from game state ──
const STRIPE = [0xe8e8e8, 0xd9412b];
function makeRoadblock(colour) {
  const g = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3b3b3b, roughness: 0.9 });
  for (const sx of [-0.36, 0.36]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.22), legMat);
    leg.position.set(sx, 0.14, 0); leg.castShadow = true; g.add(leg);
  }
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.06),
      new THREE.MeshStandardMaterial({ color: STRIPE[i % 2], roughness: 0.7 }));
    seg.position.set(-0.35 + i * 0.14, 0.26, 0); seg.castShadow = true; g.add(seg);
  }
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.07), new THREE.MeshBasicMaterial({ color: colour }));
  tag.position.set(0, 0.36, 0); g.add(tag);
  return g;
}
export function createRoadblocks(scene, colourFor) {
  const views = new Map();
  return {
    sync(map) {
      const seen = new Set();
      map?.forEach((rb, key) => {
        seen.add(key);
        let v = views.get(key);
        if (!v) {
          v = makeRoadblock(colourFor(rb.slot));
          v.position.set(rb.x, 0, rb.z);
          v.rotation.y = rb.rot || 0;   // server turns it across the road
          scene.add(v); views.set(key, v);
        }
        v.scale.y = rb.hits <= 1 ? 0.7 : 1;   // cracked after the first smash
      });
      for (const [key, v] of views) if (!seen.has(key)) { scene.remove(v); views.delete(key); }
    },
  };
}

// ── King of the Hill: a glowing ring on the ground that slides to each new spot ──
export function createHill(scene, radius) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xf5b82e, transparent: true, opacity: 0.22, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.2, radius, 64),
    new THREE.MeshBasicMaterial({ color: 0xf5b82e, transparent: true, opacity: 0.85, depthWrite: false }));
  for (const m of [disc, ring]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 2; g.add(m); }
  disc.position.y = 0.03; ring.position.y = 0.035;
  g.visible = false; scene.add(g);
  let t = 0;
  return {
    sync(state, dt) {
      const on = state?.mode === 'koth' && state.phase === 'playing';
      if (on && !g.visible) g.position.set(state.hillX, 0, state.hillZ);
      g.visible = on;
      if (!on) return;
      const k = Math.min(1, dt * 4);
      g.position.x += (state.hillX - g.position.x) * k;
      g.position.z += (state.hillZ - g.position.z) * k;
      t += dt;
      // blink in the last 3 seconds before it moves
      ring.material.opacity = state.hillIn < 3 ? 0.4 + 0.45 * Math.abs(Math.sin(t * 8)) : 0.85;
    },
    get position() { return g.position; },
  };
}

// ── Evacuation exits: green pads with an arrow pointing off the map ──
export function createExits(scene, exits, city) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.55, depthWrite: false });
  for (const e of exits) {
    const pad = new THREE.Group();
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat);
    sq.rotation.x = -Math.PI / 2; pad.add(sq);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 3), new THREE.MeshBasicMaterial({ color: 0x1f6b3a }));
    arrow.rotation.x = Math.PI / 2; arrow.position.y = 0.05; arrow.scale.y = 0.2;
    pad.add(arrow);
    // point outward, toward the nearest map edge
    const out = e.z === 0 ? [0, -1] : e.z === city.depth - 1 ? [0, 1] : e.x === 0 ? [-1, 0] : [1, 0];
    pad.rotation.y = Math.atan2(out[0], out[1]);
    pad.position.set(e.x, 0.03, e.z);
    g.add(pad);
  }
  g.visible = false; scene.add(g);
  return { sync(state) { g.visible = state?.mode === 'evac' && (state.phase === 'playing' || state.phase === 'countdown'); } };
}
