// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — BOTS
//  Simple computer players for testing. They "press keys" through the
//  same game.input / game.action / game.block calls as real players,
//  so they follow every rule in shared/game.js.
//
//  Bot tank:  drives to a spot in firing range with a clear line of sight
//             to the kaiju, backs off when it gets close (dropping roadblocks).
//             Repair happens on its own when it passes damaged buildings.
//  Bot kaiju: walks to the nearest building and smashes it; chases any
//             tank that comes close; smashes roadblocks in its way.
//             King of the Hill: prefers buildings inside the hill.
//             Evacuation: hunts civilians it can reach quickly.
// ─────────────────────────────────────────────────────────────
import { TUNING as T } from './tuning.js';
import { bfs as pathBfs, steer, DIRS } from './path.js';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createBots(game, state) {
  const city = game.city;
  const brains = new Map(); // id → { path, goalKey, replanIn }
  let count = 0;

  const bfs = (role, sx, sz, isGoal, maxNodes = 900, passRoadblocks = false) =>
    pathBfs(city, role, sx, sz, isGoal, { maxNodes, destroyed: game.destroyed, blocked: passRoadblocks ? null : game.blocked });

  function kaijuOf() { for (const p of state.players.values()) if (p.role === 'kaiju') return p; return null; }

  function thinkTank(id, p, b, dt) {
    const k = kaijuOf();
    if (!p.alive || !k || state.phase !== 'playing') { game.input(id, { x: 0, z: 0 }); return; }
    const d = dist(p, k);
    const sx = Math.round(p.x), sz = Math.round(p.z);
    const sees = game.canSee(p, k);
    let mode = d < 2.8 ? 'flee' : (d > T.tankRange - 0.8 || !sees) ? 'approach' : 'hold';
    if (mode === 'hold') { game.input(id, { x: 0, z: 0 }); b.path = null; return; }

    b.replanIn -= dt;
    if (!b.path || b.mode !== mode || b.replanIn <= 0) {
      b.mode = mode; b.replanIn = 0.5;
      if (mode === 'approach') {
        b.path = bfs('tank', sx, sz, (x, z) => {
          const dd = Math.hypot(x - k.x, z - k.z);
          return dd >= 3.5 && dd <= T.tankRange - 1 && game.canSee({ x, z }, k);
        }, 2000);
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
    }
    if (state.mode === 'evac') {
      let cd = 7;
      state.civilians?.forEach(c => { const dd = dist(p, c); if (dd < cd && dd < preyD + 2) { cd = dd; prey = c; } });
    }
    b.replanIn -= dt;
    if (prey) {
      if (p.boostIn <= 0 && dist(p, prey) > 1.5) game.boost(id);   // charge
      if (b.replanIn <= 0 || b.mode !== 'chase') {
        b.mode = 'chase'; b.replanIn = 0.3;
        const px = Math.round(prey.x), pz = Math.round(prey.z);
        b.path = bfs('kaiju', sx, sz, (x, z) => x === px && z === pz, 900, true);
      }
    } else if (b.replanIn <= 0 || b.mode !== 'smash' || !b.path) {
      b.mode = 'smash'; b.replanIn = 1.0;
      // nearest tile that has a standing building next to it (inside the hill first, in KOTH)
      const target = (inHill) => bfs('kaiju', sx, sz, (x, z) => DIRS.some(([dx, dz]) => {
        const id2 = city.owner[z + dz]?.[x + dx];
        if (id2 === undefined || id2 < 0) return false;
        const bb = city.buildings[id2];
        if (bb.kind === 'park' || state.buildingHp[id2] <= 0) return false;
        return !inHill || Math.hypot(bb.cx - state.hillX, bb.cz - state.hillZ) <= T.hillRadius;
      }), 2000, true);
      b.path = (state.mode === 'koth' && target(true)) || target(false);
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
