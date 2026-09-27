// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — THE RULES
//  All game logic, shared by the server (authoritative) and the
//  offline sandbox. It works on a "state" object whose shape is the
//  same whether it's a Colyseus schema or a plain JS object; `make`
//  supplies the constructors for players, roadblocks and civilians.
//
//  Modes (state.mode): 'ffa' Free for all · 'koth' King of the Hill (beta)
//  · 'evac' Evacuation (beta). See GAME MODES in tuning.js.
//  Every number comes from shared/tuning.js.
// ─────────────────────────────────────────────────────────────
import { TUNING, kaijuSpeedFor, kaijuMaxHpFor, boostMultiplierAt } from './tuning.js';
import { parseCity, SPAWNS, EXITS } from './map.js';
import { bfs, steer } from './path.js';
import { stepUnit, firstHit } from './sim.js';

const T = TUNING;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Plain-object factories (tests + offline sandbox). The server passes schema ones.
export const plainMake = {
  player: () => ({ name: '', ready: false, afk: false, role: '', slot: -1, mobile: false, x: 0, z: 0, rot: 0, moving: false,
    alive: true, respawnIn: 0, boostIn: 0, boosting: false, strikeIn: 0, blockIn: 0, bot: false, repairing: false }),
  roadblock: () => ({ x: 0, z: 0, hits: 0, slot: 0, rot: 0 }),
  civilian: () => ({ x: 0, z: 0, rot: 0, moving: false, look: 0 }),
  state: () => ({ phase: 'lobby', clock: 0, winner: '', kaijuHp: 0, kaijuMaxHp: 0,
    kaijuScore: 0, kaijuSpeed: 0, players: new Map(), buildingHp: [], roadblocks: new Map(),
    mode: '', hillX: 0, hillZ: 0, hillIn: 0, evacuated: 0, civilians: new Map() }),
};

// Player names: printable, trimmed, max 16 characters.
export const MODES = ['ffa', 'koth', 'evac'];
export const MODE_NAMES = { ffa: 'Free for all', koth: 'King of the Hill', evac: 'Evacuation' };
export const BETA_MODES = new Set(['koth', 'evac']);

export function cleanName(n) {
  return String(n ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

// Is a ground point inside what the kaiju's camera shows? (tiles; assumes a
// 16:9 screen plus a margin so respawns never pop in at the edge)
export function inKaijuView(kaiju, p, margin = 1.5) {
  const az = T.cameraAzimuthDeg * Math.PI / 180, el = T.cameraElevationDeg * Math.PI / 180;
  const dx = p.x - kaiju.x, dz = p.z - kaiju.z;
  const sx = dx * Math.cos(az) - dz * Math.sin(az);                       // screen right
  const sy = (-dx * Math.sin(az) - dz * Math.cos(az)) * Math.sin(el);     // screen up
  const half = T.viewTilesKaiju / 2;
  return Math.abs(sx) < half * (16 / 9) + margin && Math.abs(sy) < half + margin;
}

export function createGame({ state, make = plainMake, emit = () => {}, rng = Math.random }) {
  const city = parseCity();
  const inputs = new Map();        // id → {x, z}
  const actions = new Set();       // ids that pressed E since last tick
  const timers = new Map();        // id → { fire, root, boostT } (server-only, not synced)
  const lastActive = new Map();    // id → game time of last key press / stick move
  let now = 0;
  const streets = [];
  for (let z = 0; z < city.depth; z++) for (let x = 0; x < city.width; x++)
    if (city.tiles[z][x] === '#') streets.push({ x, z });

  // Buildings: HP per building id (parks get 0 and are never targets).
  const maxHpOf = (b) => b.kind === 'park' ? 0 : T.buildingHp[b.kind];
  if (!state.buildingHp.length) for (const b of city.buildings) state.buildingHp.push(maxHpOf(b));
  const destroyed = (id) => city.buildings[id].kind !== 'park' && state.buildingHp[id] <= 0;
  const rbKey = (x, z) => `${x},${z}`;
  const blocked = (tx, tz) => state.roadblocks.has(rbKey(tx, tz));
  const rbOrder = new Map();       // tank id → roadblock keys, oldest first
  const blockActions = new Set();  // ids that pressed SPACE / BLOCK since last tick (tanks)
  const boostActions = new Set();  // ids that pressed SHIFT since last tick (kaiju)
  // Standing buildings stop tank shells (parks and rubble don't).
  const blocksShots = (id) => city.buildings[id].kind !== 'park' && state.buildingHp[id] > 0;
  const repairFx = new Map();      // tank id → seconds until next repair effect

  const kaiju = () => { for (const p of state.players.values()) if (p.role === 'kaiju') return p; return null; };
  const tanks = () => [...state.players.values()].filter(p => p.role === 'tank');
  const idOf = (player) => { for (const [id, p] of state.players) if (p === player) return id; };
  const timer = (id) => {
    if (!timers.has(id)) timers.set(id, { fire: 0, root: 0 });
    return timers.get(id);
  };

  // ── Scaling ────────────────────────────────────────────────
  function rescale() {
    const n = tanks().length;
    state.kaijuSpeed = kaijuSpeedFor(n);
    const newMax = kaijuMaxHpFor(n), delta = newMax - state.kaijuMaxHp;
    if (state.phase === 'playing') {
      // tank joins mid-round: kaiju gains the extra HP; tank leaves: cap at new max
      state.kaijuHp = delta > 0 ? state.kaijuHp + delta : Math.min(state.kaijuHp, newMax);
    } else {
      state.kaijuHp = newMax;
    }
    state.kaijuMaxHp = newMax;
  }

  // ── Placement ──────────────────────────────────────────────
  function pickRespawn() {
    const k = kaiju();
    if (!k) return streets[Math.floor(rng() * streets.length)];
    const ok = streets.filter(s => dist(s, k) >= T.respawnMinDistance && !inKaijuView(k, s));
    if (ok.length) return ok[Math.floor(rng() * ok.length)];
    return streets.reduce((best, s) => dist(s, k) > dist(best, k) ? s : best, streets[0]);
  }

  function placeTank(p, id, spot) {
    p.x = spot.x; p.z = spot.z; p.rot = 0; p.moving = false;
    p.alive = true; p.respawnIn = 0; p.boosting = false; p.repairing = false;
  }

  function placeKaiju(p) {
    p.x = SPAWNS.kaiju.x; p.z = SPAWNS.kaiju.z; p.rot = 0; p.moving = false; p.alive = true; p.boosting = false;
  }

  // ── Joining / leaving ──────────────────────────────────────
  function freeSlot() {
    const used = new Set(tanks().map(t => t.slot));
    let slot = 0; while (used.has(slot)) slot++;
    return slot;
  }
  const isAfk = (id) => now - (lastActive.get(id) ?? -Infinity) >= T.afkSeconds;
  const touch = (id) => { lastActive.set(id, now); const p = state.players.get(id); if (p && p.afk) p.afk = false; };

  // An AFK kaiju steps down to a tank when someone else wants the seat.
  function takeOverIdleKaiju() {
    const k = kaiju();
    if (!k) return true;
    const kid = idOf(k);
    if (!k.bot && !isAfk(kid)) return false;   // bots always give up the seat to a person
    k.role = 'tank'; k.slot = freeSlot(); k.ready = false;
    placeTank(k, kid, state.phase === 'playing' ? pickRespawn() : SPAWNS.tanks[k.slot % SPAWNS.tanks.length]);
    emit('kaijuReplaced', { id: kid });
    return true;
  }

  function join(id, opts = {}) {
    const wantsKaiju = opts.role === 'kaiju', wantsTank = opts.role === 'tank';
    const mobile = !!opts.mobile;
    if (wantsKaiju && !mobile && kaiju()) takeOverIdleKaiju();
    lastActive.set(id, now);
    const name = cleanName(opts.name) || `Player ${state.players.size + 1}`;
    let role;
    if (mobile) role = 'tank';                               // phones always drive tanks
    else if (!kaiju() && !wantsTank) role = 'kaiju';
    else if (wantsKaiju && !kaiju()) role = 'kaiju';
    else role = 'tank';

    const p = make.player();
    p.name = name; p.ready = false; p.afk = false;
    p.role = role; p.mobile = mobile;
    p.alive = true; p.respawnIn = 0; p.boostIn = 0; p.boosting = false; p.strikeIn = 0; p.blockIn = 0;
    p.bot = !!opts.bot;
    if (role === 'kaiju') {
      p.slot = -1;
      placeKaiju(p);
    } else {
      const slot = freeSlot();
      if (slot >= T.maxTanks) throw new Error('No tank seats left');
      p.slot = slot;
      state.players.set(id, p);
      placeTank(p, id, state.phase === 'playing' ? pickRespawn() : SPAWNS.tanks[slot % SPAWNS.tanks.length]);
    }
    state.players.set(id, p);
    rescale();
    return role;
  }

  function leave(id) {
    state.players.delete(id);
    inputs.delete(id); timers.delete(id); actions.delete(id); lastActive.delete(id);
    blockActions.delete(id); boostActions.delete(id); repairFx.delete(id);
    rescale();
  }

  const input = (id, v) => {
    const x = Number(v?.x), z = Number(v?.z);
    const v2 = { x: Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0,
                 z: Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0 };
    if (v2.x || v2.z) touch(id);
    inputs.set(id, v2);
  };
  const action = (id) => { actions.add(id); touch(id); };
  const block = (id) => { blockActions.add(id); touch(id); };
  const boost = (id) => { boostActions.add(id); touch(id); };

  // ── Lobby ──────────────────────────────────────────────────
  function setName(id, name) {
    const p = state.players.get(id), n = cleanName(name);
    if (p && n) p.name = n;
    touch(id);
  }
  function setReady(id, ready) {
    const p = state.players.get(id);
    if (!p || state.phase !== 'lobby' && state.phase !== 'countdown') return;
    p.ready = !!ready;
    touch(id);
  }
  // Swap sides in the lobby. KAIJU: desktop only, seat must be free or its holder AFK.
  function setRole(id, role) {
    const p = state.players.get(id);
    touch(id);
    if (!p || p.role === role || (state.phase !== 'lobby' && state.phase !== 'countdown')) return false;
    if (role === 'kaiju') {
      if (p.mobile) return false;
      if (kaiju() && !takeOverIdleKaiju()) return false;
      p.role = 'kaiju'; p.slot = -1; p.ready = false; p.repairing = false;
      placeKaiju(p);
    } else if (role === 'tank') {
      const slot = freeSlot();
      if (slot >= T.maxTanks) return false;
      p.role = 'tank'; p.slot = slot; p.ready = false;
      placeTank(p, id, SPAWNS.tanks[slot % SPAWNS.tanks.length]);
    } else return false;
    rescale();
    return true;
  }
  // Can the round start? Needs an active kaiju and tank, and every non-AFK player ready.
  function lobbyReady() {
    const k = kaiju();
    if (!k || k.afk || !k.ready) return false;
    let readyTanks = 0;
    for (const p of state.players.values()) {
      if (p.afk) continue;
      if (!p.ready) return false;
      if (p.role === 'tank') readyTanks++;
    }
    return readyTanks > 0;
  }

  // Pick the game mode: in the lobby, or on the end screen for the next round.
  // force (offline sandbox only): switch now and restart the round.
  function setMode(id, mode, force = false) {
    if (id) touch(id);
    if (!MODES.includes(mode) || mode === state.mode) return false;
    if (!force && state.phase !== 'lobby' && state.phase !== 'ended') return false;
    state.mode = mode;
    emit('mode', { mode, by: state.players.get(id)?.name || '' });
    if (force && state.phase !== 'lobby') resetRound();
    return true;
  }

  // ── Round flow ─────────────────────────────────────────────
  function clearRoadblocks() {
    for (const k of [...state.roadblocks.keys()]) state.roadblocks.delete(k);
    rbOrder.clear();
  }

  function clearCivilians() {
    for (const k of [...state.civilians.keys()]) state.civilians.delete(k);
    civ.clear();
  }

  function resetRound() {
    clearRoadblocks();
    clearCivilians();
    state.evacuated = 0;
    for (const b of city.buildings) state.buildingHp[b.id] = maxHpOf(b);
    state.kaijuScore = 0; state.winner = '';
    for (const [id, p] of state.players) {
      if (p.role === 'kaiju') placeKaiju(p);
      else placeTank(p, id, SPAWNS.tanks[p.slot % SPAWNS.tanks.length]);
      p.boostIn = 0; p.strikeIn = 0; p.blockIn = 0;
      timers.delete(id);
    }
    // Straight into the next round if both sides are still here; otherwise back to the lobby.
    if (kaiju() && tanks().length) { state.phase = 'countdown'; state.clock = T.countdownSeconds; fromLobby = false; emit('countdown', {}); }
    else { state.phase = 'lobby'; for (const p of state.players.values()) p.ready = false; }
    rescale();
  }

  let fromLobby = false;  // countdown started by ready-up (cancellable) vs. next round (not)
  function endRound(winner) {
    state.phase = 'ended'; state.winner = winner; state.clock = T.endScreenSeconds;
    emit('end', { winner, score: state.kaijuScore });
  }

  // ── Combat pieces ──────────────────────────────────────────
  // The building to hit: any building tile within strikeRange of the kaiju,
  // preferring what it's facing, then the nearest.
  function strikeTarget(k) {
    const fx = Math.sin(k.rot), fz = Math.cos(k.rot);
    const R = T.strikeRange, reach = Math.ceil(R) + 1;
    const cx = Math.round(k.x), cz = Math.round(k.z);
    let best = null, bestScore = Infinity;
    for (let tz = cz - reach; tz <= cz + reach; tz++) for (let tx = cx - reach; tx <= cx + reach; tx++) {
      let target = null;
      const rb = state.roadblocks.get(rbKey(tx, tz));
      if (rb) target = { kind: 'roadblock', key: rbKey(tx, tz), rb };
      else {
        const id = city.owner[tz]?.[tx];
        if (id === undefined || id < 0) continue;
        if (city.buildings[id].kind === 'park' || state.buildingHp[id] <= 0) continue;
        target = { kind: 'building', id };
      }
      const dx = tx - k.x, dz = tz - k.z, d = Math.hypot(dx, dz);
      if (d > R + 0.15) continue;                    // small slack for being off-centre
      const facing = (dx * fx + dz * fz) / (d || 1);  // 1 = straight ahead
      const score = d - facing * 0.6;
      if (score < bestScore) { bestScore = score; best = { ...target, tx, tz }; }
    }
    return best;
  }

  function kaijuStrike(k, kid) {
    if (k.strikeIn > 0) return;
    const target = strikeTarget(k);
    k.strikeIn = T.strikeCooldown;
    timer(kid).root = T.strikeRoot;
    if (!target) { emit('strike', { bid: -1, x: k.x, z: k.z }); return; }
    k.rot = Math.atan2(target.tx - k.x, target.tz - k.z);   // face what's being hit
    if (target.kind === 'roadblock') {
      target.rb.hits -= 1;
      emit('strike', { bid: -1, x: target.tx, z: target.tz, roadblock: true });
      if (target.rb.hits <= 0) {
        state.roadblocks.delete(target.key);
        for (const list of rbOrder.values()) { const i = list.indexOf(target.key); if (i >= 0) list.splice(i, 1); }
        emit('roadblockDown', { x: target.tx, z: target.tz });
      }
      return;
    }
    const bid = target.id;
    const hp = Math.max(0, state.buildingHp[bid] - T.strikeDamage);
    state.buildingHp[bid] = hp;
    const b = city.buildings[bid];
    emit('strike', { bid, hp, x: k.x, z: k.z });
    if (hp <= 0) {
      const inHill = state.mode === 'koth' && Math.hypot(b.cx - state.hillX, b.cz - state.hillZ) <= T.hillRadius;
      const pts = T.buildingPoints[b.kind] * (inHill ? T.hillMultiplier : 1);
      state.kaijuScore += pts;
      emit('destroyed', { bid, points: pts, hill: inHill });
    }
  }

  // Tank drops a roadblock on the street tile behind it (or its own tile).
  function dropRoadblock(p, id) {
    if (p.blockIn > 0 || !p.alive) return false;
    const k = kaiju();
    const bx = -Math.sin(p.rot), bz = -Math.cos(p.rot);
    const back = Math.abs(bx) > Math.abs(bz) ? [Math.sign(bx), 0] : [0, Math.sign(bz)];
    const here = [Math.round(p.x), Math.round(p.z)];
    const spots = [[here[0] + back[0], here[1] + back[1]], here];
    for (const [tx, tz] of spots) {
      if (city.tiles[tz]?.[tx] !== '#' || state.roadblocks.has(rbKey(tx, tz))) continue;
      if (k && Math.abs(k.x - tx) < 0.5 + T.kaijuRadius && Math.abs(k.z - tz) < 0.5 + T.kaijuRadius) continue; // not on the kaiju
      const rb = make.roadblock();
      rb.x = tx; rb.z = tz; rb.hits = T.roadblockHits; rb.slot = p.slot;
      rb.rot = back[0] !== 0 ? Math.PI / 2 : 0;   // barrier runs across the road the tank is on
      state.roadblocks.set(rbKey(tx, tz), rb);
      const list = rbOrder.get(id) || [];
      list.push(rbKey(tx, tz));
      while (list.length > T.roadblockMaxPerTank) state.roadblocks.delete(list.shift());
      rbOrder.set(id, list);
      p.blockIn = T.roadblockCooldown;
      emit('roadblock', { id, x: tx, z: tz });
      return true;
    }
    return false;
  }

  // Tanks repair damaged (not destroyed) buildings within repairRange.
  function repairNear(p, id, dt) {
    p.repairing = false;
    const r = T.repairRange, reach = Math.ceil(r) + 1;
    const cx = Math.round(p.x), cz = Math.round(p.z);
    const done = new Set();
    for (let tz = cz - reach; tz <= cz + reach; tz++) for (let tx = cx - reach; tx <= cx + reach; tx++) {
      const bid = city.owner[tz]?.[tx];
      if (bid === undefined || bid < 0 || done.has(bid)) continue;
      const b = city.buildings[bid];
      if (b.kind === 'park') continue;
      const hp = state.buildingHp[bid], max = maxHpOf(b);
      if (hp <= 0 || hp >= max) continue;
      if (Math.hypot(tx - p.x, tz - p.z) > r) continue;
      done.add(bid);
      p.repairing = true;
      state.buildingHp[bid] = Math.min(max, hp + T.repairPerSecond * dt);
      const left = (repairFx.get(id) ?? 0) - dt;
      if (left <= 0) { emit('repair', { id, bid }); repairFx.set(id, 0.6); } else repairFx.set(id, left);
    }
  }

  function damageKaiju(amount) {
    state.kaijuHp = Math.max(0, state.kaijuHp - amount);
    if (state.kaijuHp <= 0 && state.phase === 'playing') endRound('tanks');
  }

  function killTank(p, id) {
    p.alive = false; p.moving = false;
    p.respawnIn = T.tankRespawnSeconds; p.repairing = false;
    state.kaijuScore += T.pointsTankKill;
    emit('tankDown', { id, x: p.x, z: p.z, points: T.pointsTankKill });
  }

  // ── King of the Hill ───────────────────────────────────────
  // A street tile with enough standing buildings around it, away from the last hill.
  function moveHill() {
    const standing = (x, z) => {
      let n = 0;
      for (const b of city.buildings) {
        if (b.kind === 'park' || state.buildingHp[b.id] <= 0) continue;
        if (Math.hypot(b.cx - x, b.cz - z) <= T.hillRadius) n++;
      }
      return n;
    };
    const far = streets.filter(s => Math.hypot(s.x - state.hillX, s.z - state.hillZ) >= T.hillRadius * 2);
    const pool = far.length ? far : streets;
    let pick = null;
    for (let tries = 0; tries < 60 && !pick; tries++) {
      const s = pool[Math.floor(rng() * pool.length)];
      if (standing(s.x, s.z) >= T.hillMinBuildings) pick = s;
    }
    pick ||= pool[Math.floor(rng() * pool.length)];
    state.hillX = pick.x; state.hillZ = pick.z; state.hillIn = T.hillMoveSeconds;
    emit('hill', { x: pick.x, z: pick.z });
  }

  // ── Evacuation ─────────────────────────────────────────────
  const civ = new Map();   // civilian id → { path, replanIn, panic } (server-only)
  let civSeq = 0, civSpawnIn = 0;
  const onExit = (x, z) => EXITS.some(e => e.x === x && e.z === z);
  function civPath(c, k) {
    const sx = Math.round(c.x), sz = Math.round(c.z);
    const scared = k && dist(c, k) < T.civilianPanicRange;
    const avoid = scared ? (x, z) => Math.hypot(x - k.x, z - k.z) < 2.2 : null;
    return bfs(city, 'tank', sx, sz, onExit, { maxNodes: 2000, destroyed, avoid })
        || bfs(city, 'tank', sx, sz, onExit, { maxNodes: 2000, destroyed });
  }
  function spawnCivilian(k) {
    // step out of a standing building onto the street, away from the exits and the kaiju
    for (let tries = 0; tries < 40; tries++) {
      const s = streets[Math.floor(rng() * streets.length)];
      if (EXITS.some(e => Math.hypot(e.x - s.x, e.z - s.z) < 6)) continue;
      if (k && dist(s, k) < 4) continue;
      const nextTo = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
        const bid = city.owner[s.z + dz]?.[s.x + dx];
        return bid !== undefined && bid >= 0 && city.buildings[bid].kind !== 'park' && state.buildingHp[bid] > 0;
      });
      if (!nextTo) continue;
      const c = make.civilian();
      c.x = s.x; c.z = s.z; c.rot = 0; c.moving = false; c.look = Math.floor(rng() * 1000);
      const id = `c${++civSeq}`;
      state.civilians.set(id, c);
      civ.set(id, { path: civPath(c, k), replanIn: 1 + rng(), panic: false });
      return;
    }
  }
  function tickCivilians(dt, k) {
    if ((civSpawnIn -= dt) <= 0 && state.civilians.size < T.civilianMaxAlive) {
      civSpawnIn = T.civilianSpawnSeconds;
      spawnCivilian(k);
    }
    for (const [id, c] of [...state.civilians]) {
      const brain = civ.get(id);
      if (!brain) continue;
      const panic = !!(k && dist(c, k) < T.civilianPanicRange);
      brain.replanIn -= dt;
      if (!brain.path || (panic && (brain.replanIn <= 0 || !brain.panic))) {
        brain.path = civPath(c, k); brain.replanIn = 0.8;
      }
      brain.panic = panic;
      const inp = brain.path ? steer(c, brain.path) : { x: 0, z: 0 };
      const walker = { role: 'tank', x: c.x, z: c.z, rot: c.rot, moving: c.moving };
      c.moving = stepUnit(city, walker, inp, dt, T.civilianSpeed * (panic ? 1.25 : 1), T.civilianRadius, destroyed);
      c.x = walker.x; c.z = walker.z; c.rot = walker.rot;
      if (k && dist(c, k) < T.kaijuRadius + T.civilianRadius + T.stompReach) {   // stomped
        state.civilians.delete(id); civ.delete(id);
        state.kaijuScore += T.pointsCivilian;
        emit('civilianDown', { x: c.x, z: c.z, points: T.pointsCivilian });
        continue;
      }
      if (EXITS.some(e => Math.hypot(e.x - c.x, e.z - c.z) < 0.35)) {             // escaped
        state.civilians.delete(id); civ.delete(id);
        state.evacuated += 1;
        emit('escaped', { x: c.x, z: c.z, count: state.evacuated });
        if (state.evacuated >= T.evacGoal) { endRound('tanks'); return; }
      }
    }
  }

  // ── Tick ───────────────────────────────────────────────────
  function tick(dt) {
    now += dt;
    const k = kaiju();
    const tankList = tanks();

    // AFK flags (shown in the lobby; AFK players don't block the start)
    for (const [id, p] of state.players) { const a = !p.bot && isAfk(id); if (p.afk !== a) p.afk = a; }

    // Phase clock
    if (state.phase === 'lobby') {
      if (lobbyReady()) { state.phase = 'countdown'; state.clock = T.countdownSeconds; fromLobby = true; emit('countdown', {}); }
    } else if (state.phase === 'countdown') {
      if (!k || !tankList.length) { state.phase = 'lobby'; for (const p of state.players.values()) p.ready = false; }
      else if (fromLobby && !lobbyReady()) state.phase = 'lobby'; // someone un-readied
      else if ((state.clock -= dt) <= 0) {
        state.phase = 'playing'; state.clock = T.matchSeconds; state.kaijuHp = state.kaijuMaxHp;
        state.evacuated = 0; civSpawnIn = 0; clearCivilians();
        emit('start', { mode: state.mode });
        if (state.mode === 'koth') moveHill();
      }
    } else if (state.phase === 'playing') {
      if ((state.clock -= dt) <= 0) { state.clock = 0; endRound('kaiju'); }
      else if (state.mode === 'koth' && (state.hillIn -= dt) <= 0) moveHill();
    } else if (state.phase === 'ended') {
      if ((state.clock -= dt) <= 0) resetRound();
    }
    const live = state.phase === 'playing';

    // Movement (combat actions only while live; driving works while waiting)
    for (const [id, p] of state.players) {
      const t = timer(id);
      if (p.role === 'kaiju') {
        p.strikeIn = Math.max(0, p.strikeIn - dt);
        t.root = Math.max(0, t.root - dt);
        if (live && actions.has(id)) kaijuStrike(p, id);
        // boost: surge to boostPeak × speed, then ease back over boostSeconds
        p.boostIn = Math.max(0, p.boostIn - dt);
        if (boostActions.has(id) && p.boostIn <= 0 && state.phase !== 'ended') {
          p.boostIn = T.boostCooldown; t.boostT = 0; p.boosting = true;
          emit('boost', { id });
        }
        if (p.boosting && (t.boostT += dt) >= T.boostSeconds) p.boosting = false;
        const mult = p.boosting ? boostMultiplierAt(t.boostT) : 1;
        const inp = t.root > 0 || state.phase === 'ended' ? null : inputs.get(id);
        p.moving = stepUnit(city, p, inp, dt, state.kaijuSpeed * mult, T.kaijuRadius, destroyed, blocked);
      } else {
        p.blockIn = Math.max(0, p.blockIn - dt);
        if (!p.alive) {
          if (state.phase === 'playing' || state.phase === 'ended') {
            if ((p.respawnIn -= dt) <= 0) { placeTank(p, id, pickRespawn()); emit('respawn', { id }); }
          }
          continue;
        }
        const inp = state.phase === 'ended' ? null : inputs.get(id);
        p.moving = stepUnit(city, p, inp, dt, T.tankSpeed, T.tankRadius, destroyed);
        if (live && blockActions.has(id)) dropRoadblock(p, id);
        if (live) repairNear(p, id, dt); else p.repairing = false;
      }
    }
    actions.clear(); blockActions.clear(); boostActions.clear();
    if (!live || !k) return;

    if (state.mode === 'evac') { tickCivilians(dt, k); if (state.phase !== 'playing') return; }

    // Stomps: the kaiju walking into a tank kills it.
    for (const p of tankList) {
      if (!p.alive) continue;
      if (dist(k, p) < T.kaijuRadius + T.tankRadius + T.stompReach) killTank(p, idOf(p));
    }

    // Auto-fire: turrets lock on when the kaiju is in range.
    for (const p of tankList) {
      if (!p.alive || state.phase !== 'playing') continue;
      const id = idOf(p), t = timer(id);
      t.fire = Math.max(0, t.fire - dt);
      if (t.fire <= 0 && dist(p, k) <= T.tankRange) {
        t.fire = T.tankFireInterval;
        // a building in the way takes the shell instead (no damage to it or the kaiju)
        const hit = T.tankLineOfSight ? firstHit(city, blocksShots, p.x, p.z, k.x, k.z) : null;
        if (hit) { emit('shot', { id, kind: 'tank', blocked: true, x: hit.x, z: hit.z }); continue; }
        emit('shot', { id, kind: 'tank' });
        damageKaiju(T.tankDamage);
      }
    }
  }

  // Move a unit instantly (tests / dev).
  function teleport(id, x, z) {
    const p = state.players.get(id);
    if (!p) return;
    if (p.role === 'tank') { const alive = p.alive; placeTank(p, id, { x, z }); p.alive = alive; }
    else { p.x = x; p.z = z; }
  }

  if (!MODES.includes(state.mode)) state.mode = T.defaultMode;
  rescale();
  // Can a tank at a see the kaiju at b? (bots use this)
  const canSee = (a, b) => !T.tankLineOfSight || !firstHit(city, blocksShots, a.x, a.z, b.x, b.z);

  return { city, join, leave, input, action, block, boost, canSee, tick, destroyed, blocked, pickRespawn, teleport, maxHpOf,
           setName, setReady, setRole, setMode, isAfk, moveHill };
}
