// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — BOTS
//  Simple computer players for testing. They "press keys" through the
//  same game.input / game.action / game.block calls as real players,
//  so they follow every rule in shared/game.js.
//
//  Bot tank:  drives into firing range of the kaiju, backs off when it
//             gets close (boosting and dropping roadblocks as it flees).
//             Repair happens on its own when it passes damaged buildings.
//  Bot kaiju: walks to the nearest building and smashes it; chases any
//             tank or soldier that comes close; smashes roadblocks in its way.
// ─────────────────────────────────────────────────────────────
import { TUNING as T } from './tuning.js';
import { tileWalkable } from './sim.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createBots(game, state) {
  const city = game.city;
  const brains = new Map(); // id → { path, goalKey, replanIn }
  let count = 0;

  // Breadth-first search over walkable tiles from (sx,sz) until isGoal(tx,tz).
  // passRoadblocks lets the kaiju plan through roadblocks (it smashes them).
  function bfs(role, sx, sz, isGoal, maxNodes = 900, passRoadblocks = false) {
    const key = (x, z) => z * city.width + x;
    const prev = new Map([[key(sx, sz), -1]]);
    const queue = [[sx, sz]];
    for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
      const [x, z] = queue[qi];
      if (isGoal(x, z)) {
        const path = [];
        let k = key(x, z);
        while (k !== -1) { path.unshift({ x: k % city.width, z: Math.floor(k / city.width) }); k = prev.get(k); }
        return path;
      }
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz, nk = key(nx, nz);
        if (prev.has(nk)) continue;
        const ok = tileWalkable(city, role, nx, nz, game.destroyed, passRoadblocks ? null : game.blocked);
        if (!ok) continue;
        prev.set(nk, key(x, z));
        queue.push([nx, nz]);
      }
    }
    return null;
  }

  // Steer toward the next tile on the path (street-aligned, lane assist does the rest).
  function steer(p, path) {
    const here = { x: Math.round(p.x), z: Math.round(p.z) };
    while (path.length > 1 && path[0].x === here.x && path[0].z === here.z) path.shift();
    const next = path[0];
    if (!next) return { x: 0, z: 0 };
    const dx = next.x - p.x, dz = next.z - p.z;
    if (Math.abs(dx) < 0.08 && Math.abs(dz) < 0.08) { path.shift(); return { x: 0, z: 0 }; }
    // move along one axis at a time so corners are taken cleanly
    if (Math.abs(dx) > Math.abs(dz)) return { x: Math.sign(dx), z: Math.abs(dz) > 0.25 ? Math.sign(dz) * 0.3 : 0 };
    return { x: Math.abs(dx) > 0.25 ? Math.sign(dx) * 0.3 : 0, z: Math.sign(dz) };
  }

  function kaijuOf() { for (const p of state.players.values()) if (p.role === 'kaiju') return p; return null; }

  function thinkTank(id, p, b, dt) {
    const k = kaijuOf();
    if (!p.alive || !k || state.phase !== 'playing') { game.input(id, { x: 0, z: 0 }); return; }
    const d = dist(p, k);
    const sx = Math.round(p.x), sz = Math.round(p.z);
    let mode = d < 2.8 ? 'flee' : d > T.tankRange - 0.8 ? 'approach' : 'hold';
    if (mode === 'hold') { game.input(id, { x: 0, z: 0 }); b.path = null; return; }

    b.replanIn -= dt;
    if (!b.path || b.mode !== mode || b.replanIn <= 0) {
      b.mode = mode; b.replanIn = 0.5;
      if (mode === 'approach') {
        b.path = bfs('tank', sx, sz, (x, z) => {
          const dd = Math.hypot(x - k.x, z - k.z);
          return dd >= 3.5 && dd <= T.tankRange - 1;
        });
      } else {
        // flee: the reachable street tile within a few steps that is farthest from the kaiju
        let best = null, bestD = -1;
        bfs('tank', sx, sz, (x, z) => {
          const dd = Math.hypot(x - k.x, z - k.z);
          if (dd > bestD && Math.hypot(x - sx, z - sz) <= 7) { bestD = dd; best = { x, z }; }
          return false;
        }, 200);
        b.path = best ? bfs('tank', sx, sz, (x, z) => x === best.x && z === best.z) : null;
      }
    }
    game.input(id, b.path ? steer(p, b.path) : { x: 0, z: 0 });
    if (mode === 'flee') {
      if (p.boostIn <= 0) game.action(id);                  // boost away
      if (p.blockIn <= 0 && d < 2.5) game.block(id);        // roadblock behind
    }
  }

  function thinkKaiju(id, p, b, dt) {
    if (state.phase !== 'playing') { game.input(id, { x: 0, z: 0 }); return; }
    const sx = Math.round(p.x), sz = Math.round(p.z);
    // chase anything crushable nearby
    let prey = null, preyD = 4;
    for (const t of state.players.values()) {
      if (t.role !== 'tank' || !t.alive) continue;
      const dd = dist(p, t);
      if (dd < preyD) { preyD = dd; prey = t; }
      for (const s of t.soldiers) if (s.alive && dist(p, s) < preyD - 1) { preyD = dist(p, s) + 1; prey = s; }
    }
    b.replanIn -= dt;
    if (prey) {
      if (b.replanIn <= 0 || b.mode !== 'chase') {
        b.mode = 'chase'; b.replanIn = 0.3;
        const px = Math.round(prey.x), pz = Math.round(prey.z);
        b.path = bfs('kaiju', sx, sz, (x, z) => x === px && z === pz, 900, true);
      }
    } else if (b.replanIn <= 0 || b.mode !== 'smash' || !b.path) {
      b.mode = 'smash'; b.replanIn = 1.0;
      // nearest tile that has a standing building next to it
      b.path = bfs('kaiju', sx, sz, (x, z) => DIRS.some(([dx, dz]) => {
        const id2 = city.owner[z + dz]?.[x + dx];
        return id2 !== undefined && id2 >= 0 && city.buildings[id2].kind !== 'park' && state.buildingHp[id2] > 0;
      }), 900, true);
    }
    // roadblock in the way → face it and smash
    const next = b.path?.[1] || b.path?.[0];
    if (next && game.blocked(next.x, next.z)) {
      game.input(id, { x: 0, z: 0 });
      p.rot = Math.atan2(next.x - p.x, next.z - p.z);
      if (p.strikeIn <= 0) game.action(id);
      return;
    }
    const arrived = !b.path || b.path.length <= 1;
    if (b.mode === 'smash' && arrived) {
      game.input(id, { x: 0, z: 0 });
      if (p.strikeIn <= 0) game.action(id);   // strikeTarget picks the building beside it
      return;
    }
    game.input(id, b.path ? steer(p, b.path) : { x: 0, z: 0 });
  }

  return {
    // Add a bot. Returns its id, or null if there's no seat for that role.
    add(role) {
      const hasKaiju = !!kaijuOf();
      if (role === 'kaiju' && hasKaiju) return null;
      let tanks = 0; state.players.forEach(p => { if (p.role === 'tank') tanks++; });
      if (role === 'tank' && tanks >= T.maxTanks) return null;
      const id = `bot-${++count}`;
      game.join(id, { role, bot: true, name: role === 'kaiju' ? 'Bot Kaiju' : `Bot ${count}` });
      game.setReady(id, true);
      brains.set(id, { path: null, mode: '', replanIn: 0 });
      return id;
    },
    remove(id) { if (brains.delete(id)) game.leave(id); },
    has: (id) => brains.has(id),
    // Call once per tick, before game.tick(). `skip` = an id a human is driving (sandbox).
    tick(dt, skip = null) {
      for (const [id, b] of brains) {
        const p = state.players.get(id);
        if (!p) { brains.delete(id); continue; }
        if (id === skip) continue;
        if (!p.ready && (state.phase === 'lobby')) game.setReady(id, true);
        if (p.role === 'tank') thinkTank(id, p, b, dt); else thinkKaiju(id, p, b, dt);
      }
    },
  };
}
