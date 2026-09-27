// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — THE RULES
//  All game logic, shared by the server (authoritative) and the
//  offline sandbox. It works on a "state" object whose shape is the
//  same whether it's a Colyseus schema or a plain JS object; `make`
//  supplies the constructors for players, roadblocks and civilians.
//  Every number comes from shared/tuning.js.
//
//  Modes (state.mode):
//   'race'  Points race — one kaiju vs tanks. Kaiju scores destruction and
//           crushed tanks; tanks score repairs and kaiju kills. The kaiju
//           respawns when killed. A neutral crate tilts scoring. Highest
//           score at the buzzer wins.
//   'koth'  King of the Hill (beta) — everyone is a kaiju. Smash buildings
//           (×3 inside the moving hill) and each other. Highest score wins.
//   'evac'  Evacuation (beta) — kaiju vs tanks over a fixed crowd of
//           civilians. First side past half the crowd (stomped vs escaped)
//           wins. Roadblocks are sturdy and unlimited.
// ─────────────────────────────────────────────────────────────
import { TUNING, kaijuSpeedFor, kaijuMaxHpFor, boostMultiplierAt, scaled } from './tuning.js';
import { parseCity, SPAWNS, EXITS } from './map.js';
import { bfs, steer } from './path.js';
import { stepUnit, firstHit } from './sim.js';

const T = TUNING;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const MODES = ['race', 'koth', 'evac'];
export const MODE_NAMES = { race: 'Points race', koth: 'King of the Hill', evac: 'Evacuation' };
export const BETA_MODES = new Set(['koth', 'evac']);
export const KAIJU_SEATS = 1 + TUNING.maxTanks;   // King of the Hill: everyone is a kaiju

// Plain-object factories (tests + offline sandbox). The server passes schema ones.
export const plainMake = {
  player: () => ({ name: '', ready: false, afk: false, role: '', slot: -1, mobile: false, x: 0, z: 0, rot: 0, moving: false,
    alive: true, respawnIn: 0, boostIn: 0, boosting: false, strikeIn: 0, blockIn: 0, bot: false, repairing: false,
    hp: 0, maxHp: 0, score: 0 }),
  roadblock: () => ({ x: 0, z: 0, hits: 0, slot: 0, rot: 0 }),
  civilian: () => ({ x: 0, z: 0, rot: 0, moving: false, look: 0 }),
  state: () => ({ phase: 'lobby', clock: 0, winner: '', kaijuScore: 0, tankScore: 0, kaijuSpeed: 0,
    players: new Map(), buildingHp: [], roadblocks: new Map(),
    mode: '', hillX: 0, hillZ: 0, hillIn: 0,
    evacuated: 0, stomped: 0, civilians: new Map(),
    bonus: '', bonusIn: 0, healIn: 0, crateOn: false, crateX: 0, crateZ: 0, crateIn: 0 }),
};

// Player names: printable, trimmed, max 16 characters.
export function cleanName(n) {
  return String(n ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

// Is a ground point inside what a kaiju's camera shows? (tiles; assumes a
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
  const actions = new Set();       // ids that pressed SPACE (kaiju smash) since last tick
  const blockActions = new Set();  // ids that pressed SPACE / BLOCK since last tick (tanks)
  const boostActions = new Set();  // ids that pressed SHIFT since last tick (kaiju)
  const timers = new Map();        // id → { fire, root, boostT } (server-only, not synced)
  const lastActive = new Map();    // id → game time of last key press / stick move
  const rbOrder = new Map();       // tank id → roadblock keys, oldest first
  const repairFx = new Map();      // tank id → seconds until next repair effect
  let now = 0, fromLobby = false;
  const streets = [];
  for (let z = 0; z < city.depth; z++) for (let x = 0; x < city.width; x++)
    if (city.tiles[z][x] === '#') streets.push({ x, z });

  // Buildings: HP per building id (parks get 0 and are never targets).
  const maxHpOf = (b) => b.kind === 'park' ? 0 : T.buildingHp[b.kind];
  if (!state.buildingHp.length) for (const b of city.buildings) state.buildingHp.push(maxHpOf(b));
  const destroyed = (id) => city.buildings[id].kind !== 'park' && state.buildingHp[id] <= 0;
  const rbKey = (x, z) => `${x},${z}`;
  const blocked = (tx, tz) => state.roadblocks.has(rbKey(tx, tz));
  // Standing buildings stop tank shells (parks and rubble don't).
  const blocksShots = (id) => city.buildings[id].kind !== 'park' && state.buildingHp[id] > 0;

  const koth = () => state.mode === 'koth';
  const kaijus = () => [...state.players.values()].filter(p => p.role === 'kaiju');
  const kaiju = () => { for (const p of state.players.values()) if (p.role === 'kaiju') return p; return null; };
  const tanks = () => [...state.players.values()].filter(p => p.role === 'tank');
  const idOf = (player) => { for (const [id, p] of state.players) if (p === player) return id; };
  const timer = (id) => { if (!timers.has(id)) timers.set(id, { fire: 0, root: 0, boostT: 0 }); return timers.get(id); };
  const n = () => tanks().length;

  // ── Scoring ────────────────────────────────────────────────
  // Crate tilt: the side holding the bonus scores × crateFavor, the other × crateOppose.
  const tilt = (side) => !state.bonus ? 1 : state.bonus === side ? T.crateFavor : T.crateOppose;
  function kaijuPoints(p, pts) {
    if (koth()) { p.score += pts; return pts; }
    const got = pts * tilt('kaiju');
    state.kaijuScore += got; p.score += got;
    return got;
  }
  function tankPoints(p, pts) {
    const got = pts * tilt('tanks');
    state.tankScore += got; if (p) p.score += got;
    return got;
  }

  // ── Scaling ────────────────────────────────────────────────
  function rescale() {
    const count = n();
    state.kaijuSpeed = koth() ? T.kaijuSpeed : kaijuSpeedFor(count);
    for (const k of kaijus()) {
      const newMax = koth() ? T.kothHp : kaijuMaxHpFor(count);
      const delta = newMax - k.maxHp;
      if (state.phase === 'playing' && k.maxHp) {
        // a tank joins mid-round: the kaiju gains the extra HP; one leaves: cap at the new max
        k.hp = delta > 0 ? k.hp + delta : Math.min(k.hp, newMax);
      } else k.hp = newMax;
      k.maxHp = newMax;
    }
  }

  // ── Placement ──────────────────────────────────────────────
  const pick = (list) => list[Math.floor(rng() * list.length)];
  // Tank respawn: away from every kaiju and out of their view.
  function pickRespawn() {
    const ks = kaijus().filter(k => k.alive);
    if (!ks.length) return pick(streets);
    const ok = streets.filter(s => ks.every(k => dist(s, k) >= T.respawnMinDistance && !inKaijuView(k, s)));
    if (ok.length) return pick(ok);
    return streets.reduce((best, s) => Math.min(...ks.map(k => dist(s, k))) > Math.min(...ks.map(k => dist(best, k))) ? s : best, streets[0]);
  }
  // Kaiju respawn: the street spot farthest from its enemies (a few random tries).
  function kaijuRespawnSpot(p) {
    const foes = koth() ? kaijus().filter(k => k !== p && k.alive) : tanks().filter(t => t.alive);
    if (!foes.length) return SPAWNS.kaiju;
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const s = pick(streets);
      const d = Math.min(...foes.map(f => dist(s, f)));
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }
  const startSpots = [SPAWNS.kaiju, ...SPAWNS.tanks];
  function kaijuStartSpot(p) { return koth() ? startSpots[Math.max(0, p.slot) % startSpots.length] : SPAWNS.kaiju; }

  function placeTank(p, id, spot) {
    p.x = spot.x; p.z = spot.z; p.rot = 0; p.moving = false;
    p.alive = true; p.respawnIn = 0; p.boosting = false; p.repairing = false;
  }
  function placeKaiju(p, spot = kaijuStartSpot(p)) {
    p.x = spot.x; p.z = spot.z; p.rot = 0; p.moving = false; p.alive = true; p.respawnIn = 0;
    p.boosting = false; p.repairing = false; p.hp = p.maxHp;
  }

  // ── Seats ──────────────────────────────────────────────────
  function freeSlot(role) {
    const used = new Set([...state.players.values()].filter(p => p.role === role).map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    return slot;
  }
  const isAfk = (id) => now - (lastActive.get(id) ?? -Infinity) >= T.afkSeconds;
  const touch = (id) => { lastActive.set(id, now); const p = state.players.get(id); if (p && p.afk) p.afk = false; };

  function makeTank(p, id) {
    p.role = 'tank'; p.slot = freeSlot('tank'); p.hp = 0; p.maxHp = 0;
    placeTank(p, id, state.phase === 'playing' ? pickRespawn() : SPAWNS.tanks[p.slot % SPAWNS.tanks.length]);
  }
  function makeKaiju(p) {
    p.role = 'kaiju'; p.slot = koth() ? freeSlot('kaiju') : -1; p.repairing = false;
    p.maxHp = koth() ? T.kothHp : kaijuMaxHpFor(n());
    placeKaiju(p, state.phase === 'playing' ? kaijuRespawnSpot(p) : kaijuStartSpot(p));
  }

  // An AFK (or bot) kaiju steps down to a tank when someone else wants the seat.
  function takeOverIdleKaiju() {
    const k = kaiju();
    if (!k) return true;
    const kid = idOf(k);
    if (!k.bot && !isAfk(kid)) return false;
    k.ready = false;
    makeTank(k, kid);
    emit('kaijuReplaced', { id: kid });
    return true;
  }

  function join(id, opts = {}) {
    const wantsKaiju = opts.role === 'kaiju', wantsTank = opts.role === 'tank';
    if (!koth() && wantsKaiju && kaiju()) takeOverIdleKaiju();
    lastActive.set(id, now);
    const p = make.player();
    p.name = cleanName(opts.name) || `Player ${state.players.size + 1}`;
    p.ready = false; p.afk = false; p.mobile = !!opts.mobile; p.bot = !!opts.bot;
    p.alive = true; p.respawnIn = 0; p.boostIn = 0; p.boosting = false; p.strikeIn = 0; p.blockIn = 0; p.score = 0;
    state.players.set(id, p);
    const asKaiju = koth() || (!kaiju() && !wantsTank);
    if (asKaiju) makeKaiju(p);
    else {
      if (n() >= T.maxTanks) { state.players.delete(id); throw new Error('No tank seats left'); }
      makeTank(p, id);
    }
    rescale();
    return p.role;
  }

  function leave(id) {
    state.players.delete(id);
    for (const m of [inputs, timers, lastActive, repairFx, rbOrder]) m.delete(id);
    for (const s of [actions, blockActions, boostActions]) s.delete(id);
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
  const inLobby = () => state.phase === 'lobby' || state.phase === 'countdown';
  function setName(id, name) {
    const p = state.players.get(id), nm = cleanName(name);
    if (p && nm) p.name = nm;
    touch(id);
  }
  function setReady(id, ready) {
    const p = state.players.get(id);
    if (!p || !inLobby()) return;
    p.ready = !!ready;
    touch(id);
  }
  // Swap sides in the lobby (not in King of the Hill, where everyone is a kaiju).
  function setRole(id, role) {
    const p = state.players.get(id);
    touch(id);
    if (!p || koth() || p.role === role || !inLobby()) return false;
    if (role === 'kaiju') {
      if (kaiju() && !takeOverIdleKaiju()) return false;
      p.ready = false; makeKaiju(p);
    } else if (role === 'tank') {
      if (n() >= T.maxTanks) return false;
      p.ready = false; makeTank(p, id);
    } else return false;
    rescale();
    return true;
  }
  // Can the round start? Every non-AFK player ready, plus the seats the mode needs.
  function seatsFilled() {
    if (koth()) return kaijus().length >= 2;
    return !!kaiju() && n() > 0;
  }
  function lobbyReady() {
    if (!seatsFilled()) return false;
    let active = 0;
    for (const p of state.players.values()) {
      if (p.afk) continue;
      if (!p.ready) return false;
      active++;
    }
    if (!koth()) { const k = kaiju(); if (k.afk) return false; }
    return active > 0;
  }

  // Pick the game mode: in the lobby / countdown, or on the end screen for the next round.
  // Switching into or out of King of the Hill re-seats everyone.
  // force (offline sandbox only): switch now and restart the round.
  function setMode(id, mode, force = false) {
    if (id) touch(id);
    if (!MODES.includes(mode) || mode === state.mode) return false;
    if (!force && state.phase === 'playing') return false;   // lobby, countdown or end screen
    const wasKoth = koth();
    state.mode = mode;
    if (koth()) {
      for (const p of state.players.values()) p.role = '';   // free every slot, then re-seat
      for (const [pid, p] of state.players) { makeKaiju(p); inputs.delete(pid); }
    } else if (wasKoth) {
      // one kaiju stays (the first person to have joined, else the first bot); the rest drive tanks
      const list = [...state.players.entries()];
      const keep = (list.find(([, p]) => !p.bot) || list[0])?.[0];
      for (const p of state.players.values()) p.role = '';
      for (const [pid, p] of list) {
        if (pid === keep) makeKaiju(p);
        else if (n() < T.maxTanks) makeTank(p, pid);
        else makeTank(p, pid);
      }
    }
    rescale();
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
    civ.clear(); civSpawned = 0; civSpawnIn = 0;
  }
  function clearRoundState() {
    clearRoadblocks(); clearCivilians();
    for (const b of city.buildings) state.buildingHp[b.id] = maxHpOf(b);
    state.kaijuScore = 0; state.tankScore = 0; state.winner = '';
    state.evacuated = 0; state.stomped = 0;
    state.bonus = ''; state.bonusIn = 0; state.healIn = 0;
    state.crateOn = false; state.crateIn = T.crateFirstSeconds; cratePath = null;
    for (const [id, p] of state.players) {
      p.score = 0; p.boostIn = 0; p.strikeIn = 0; p.blockIn = 0;
      if (p.role === 'kaiju') placeKaiju(p); else placeTank(p, id, SPAWNS.tanks[p.slot % SPAWNS.tanks.length]);
      timers.delete(id);
    }
  }

  function resetRound() {
    clearRoundState();
    rescale();
    // Straight into the next round if the seats are still filled; otherwise back to the lobby.
    if (seatsFilled()) { state.phase = 'countdown'; state.clock = T.countdownSeconds; fromLobby = false; emit('countdown', {}); }
    else { state.phase = 'lobby'; for (const p of state.players.values()) p.ready = false; }
  }

  function startRound() {
    clearRoundState();
    rescale();
    for (const k of kaijus()) k.hp = k.maxHp;
    state.phase = 'playing'; state.clock = T.matchSeconds;
    emit('start', { mode: state.mode });
    if (koth()) moveHill();
  }

  // Who wins at the buzzer (or when Evacuation's crowd is decided).
  function decideWinner() {
    if (koth()) {
      let best = null, bestScore = -Infinity, tie = false;
      for (const [id, p] of state.players) {
        if (p.score > bestScore) { best = id; bestScore = p.score; tie = false; }
        else if (p.score === bestScore) tie = true;
      }
      return tie ? 'tie' : best || 'tie';
    }
    const [k, t] = state.mode === 'evac' ? [state.stomped, state.evacuated] : [state.kaijuScore, state.tankScore];
    const a = Math.floor(k), b = Math.floor(t);
    return a > b ? 'kaiju' : b > a ? 'tanks' : 'tie';
  }
  function endRound(winner = decideWinner()) {
    state.phase = 'ended'; state.winner = winner; state.clock = T.endScreenSeconds;
    state.crateOn = false; state.bonus = ''; state.bonusIn = 0;
    emit('end', { winner, kaiju: state.kaijuScore, tanks: state.tankScore });
  }

  // ── Kaiju smash ────────────────────────────────────────────
  // The target: another kaiju in reach (King of the Hill), else any building or
  // roadblock tile within strikeRange, preferring what it's facing, then the nearest.
  function strikeTarget(k) {
    const fx = Math.sin(k.rot), fz = Math.cos(k.rot);
    let best = null, bestScore = Infinity;
    const consider = (target, dx, dz, reach) => {
      const d = Math.hypot(dx, dz);
      if (d > reach) return;
      const facing = (dx * fx + dz * fz) / (d || 1);   // 1 = straight ahead
      const score = d - facing * 0.6;
      if (score < bestScore) { bestScore = score; best = target; }
    };
    if (koth()) {
      for (const [id, o] of state.players) {
        if (o === k || !o.alive || o.role !== 'kaiju') continue;
        consider({ kind: 'kaiju', id, o, tx: o.x, tz: o.z }, o.x - k.x, o.z - k.z, T.kothHitRange);
      }
      if (best) return best;
    }
    const R = T.strikeRange, reach = Math.ceil(R) + 1;
    const cx = Math.round(k.x), cz = Math.round(k.z);
    for (let tz = cz - reach; tz <= cz + reach; tz++) for (let tx = cx - reach; tx <= cx + reach; tx++) {
      let target = null;
      const rb = state.roadblocks.get(rbKey(tx, tz));
      if (rb) target = { kind: 'roadblock', key: rbKey(tx, tz), rb, tx, tz };
      else {
        const id = city.owner[tz]?.[tx];
        if (id === undefined || id < 0) continue;
        if (city.buildings[id].kind === 'park' || state.buildingHp[id] <= 0) continue;
        target = { kind: 'building', id, tx, tz };
      }
      consider(target, tx - k.x, tz - k.z, R + 0.15);   // small slack for being off-centre
    }
    return best;
  }

  function kaijuStrike(k, kid) {
    if (k.strikeIn > 0 || !k.alive) return;
    const target = strikeTarget(k);
    k.strikeIn = T.strikeCooldown;
    timer(kid).root = T.strikeRoot;
    if (!target) { emit('strike', { id: kid, bid: -1, x: k.x, z: k.z }); return; }
    k.rot = Math.atan2(target.tx - k.x, target.tz - k.z);   // face what's being hit
    if (target.kind === 'kaiju') {
      const o = target.o;
      o.hp = Math.max(0, o.hp - T.kothHitDamage);
      emit('strike', { id: kid, bid: -1, x: o.x, z: o.z, hitKaiju: target.id });
      if (o.hp <= 0) {
        kaijuPoints(k, T.kothKillPoints);
        downKaiju(o, target.id, kid, T.kothRespawn);
      }
      return;
    }
    if (target.kind === 'roadblock') {
      target.rb.hits -= 1;
      emit('strike', { id: kid, bid: -1, x: target.tx, z: target.tz, roadblock: true });
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
    emit('strike', { id: kid, bid, hp, x: k.x, z: k.z });
    if (hp <= 0) {
      const inHill = koth() && Math.hypot(b.cx - state.hillX, b.cz - state.hillZ) <= T.hillRadius;
      const pts = kaijuPoints(k, T.buildingPoints[b.kind] * (inHill ? T.hillMultiplier : 1));
      emit('destroyed', { id: kid, bid, points: pts, hill: inHill });
    }
  }

  // ── Kaiju down / respawn ───────────────────────────────────
  function downKaiju(k, kid, byId, respawn) {
    k.alive = false; k.moving = false; k.boosting = false; k.hp = 0;
    k.respawnIn = respawn;
    emit('kaijuDown', { id: kid, by: byId, x: k.x, z: k.z });
  }
  function damageKaiju(k, kid, amount, byTank) {
    if (!k.alive) return;
    k.hp = Math.max(0, k.hp - amount);
    if (k.hp > 0) return;
    if (state.mode === 'race') {
      const pts = tankPoints(byTank, scaled('kaijuKillPoints', n()));
      state.healIn = T.deathRepairSeconds;
      emit('kaijuKill', { points: pts });
    }
    downKaiju(k, kid, byTank ? idOf(byTank) : '', scaled('kaijuRespawn', n()));
  }

  // ── Tanks ──────────────────────────────────────────────────
  // Drop a roadblock on the street tile behind the tank (or its own tile),
  // turned to run across the road.
  function dropRoadblock(p, id) {
    if (p.blockIn > 0 || !p.alive) return false;
    const bx = -Math.sin(p.rot), bz = -Math.cos(p.rot);
    const back = Math.abs(bx) > Math.abs(bz) ? [Math.sign(bx), 0] : [0, Math.sign(bz)];
    const here = [Math.round(p.x), Math.round(p.z)];
    const evac = state.mode === 'evac';
    for (const [tx, tz] of [[here[0] + back[0], here[1] + back[1]], here]) {
      if (city.tiles[tz]?.[tx] !== '#' || state.roadblocks.has(rbKey(tx, tz))) continue;
      if (kaijus().some(k => k.alive && Math.abs(k.x - tx) < 0.5 + T.kaijuRadius && Math.abs(k.z - tz) < 0.5 + T.kaijuRadius)) continue;
      const rb = make.roadblock();
      rb.x = tx; rb.z = tz; rb.slot = p.slot;
      rb.hits = evac ? T.evacRoadblockHits : T.roadblockHits;
      rb.rot = back[0] !== 0 ? Math.PI / 2 : 0;
      state.roadblocks.set(rbKey(tx, tz), rb);
      const list = rbOrder.get(id) || [];
      list.push(rbKey(tx, tz));
      const cap = evac ? T.evacRoadblockCap : T.roadblockMaxPerTank;
      while (cap > 0 && list.length > cap) state.roadblocks.delete(list.shift());
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
    const rate = T.repairPerSecond * scaled('repairRate', n()) * (state.healIn > 0 ? T.deathRepairBoost : 1);
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
      const add = Math.min(max - hp, rate * dt);
      state.buildingHp[bid] = hp + add;
      if (state.mode === 'race') tankPoints(p, add * T.repairPoints);
      const left = (repairFx.get(id) ?? 0) - dt;
      if (left <= 0) { emit('repair', { id, bid }); repairFx.set(id, 0.6); } else repairFx.set(id, left);
    }
  }

  function killTank(p, id, k, kid) {
    p.alive = false; p.moving = false; p.repairing = false;
    p.respawnIn = scaled('tankRespawn', n());
    const pts = state.mode === 'race' ? kaijuPoints(k, scaled('tankCrushPoints', n())) : 0;
    emit('tankDown', { id, by: kid, x: p.x, z: p.z, points: pts });
  }

  // ── Bonus crate (Points race) ──────────────────────────────
  let cratePath = null, crateReplan = 0;
  function spawnCrate() {
    const k = kaiju(), ts = tanks().filter(t => t.alive);
    let pool = streets.filter(s => (!k || dist(s, k) >= T.crateMinDistance) && ts.every(t => dist(s, t) >= T.crateMinDistance));
    if (!pool.length) pool = streets;
    // roughly as far from the kaiju as from the nearest tank, so neither side can sit on it
    const fair = (s) => !k || !ts.length ? 0 : Math.abs(dist(s, k) - Math.min(...ts.map(t => dist(s, t))));
    pool = [...pool].sort((a, b) => fair(a) - fair(b)).slice(0, 12);
    const s = pick(pool);
    state.crateX = s.x; state.crateZ = s.z; state.crateOn = true; cratePath = null;
    emit('crateSpawn', { x: s.x, z: s.z });
  }
  function tickCrate(dt) {
    if (state.bonusIn > 0 && (state.bonusIn -= dt) <= 0) { state.bonusIn = 0; state.bonus = ''; emit('bonusEnd', {}); }
    if (!state.crateOn) {
      if ((state.crateIn -= dt) <= 0) spawnCrate();
      return;
    }
    // drift toward the kaiju along the streets (faster with more tanks)
    const k = kaiju(), speed = scaled('crateDrift', n());
    if (k && k.alive && speed > 0) {
      if ((crateReplan -= dt) <= 0 || !cratePath) {
        crateReplan = 1;
        const kx = Math.round(k.x), kz = Math.round(k.z);
        cratePath = bfs(city, 'tank', Math.round(state.crateX), Math.round(state.crateZ), (x, z) => x === kx && z === kz,
          { maxNodes: 2000, destroyed });
      }
      const next = cratePath?.[1] || cratePath?.[0];
      if (next) {
        const dx = next.x - state.crateX, dz = next.z - state.crateZ, d = Math.hypot(dx, dz);
        const step = Math.min(d, speed * dt);
        if (d > 1e-6) { state.crateX += dx / d * step; state.crateZ += dz / d * step; }
        if (d - step < 0.02 && cratePath.length > 1) cratePath.shift();
      }
    }
    // grabbed: the first unit to touch it tilts scoring to its side
    for (const [id, p] of state.players) {
      if (!p.alive) continue;
      const reach = (p.role === 'kaiju' ? T.kaijuRadius : T.tankRadius) + 0.35;
      if (Math.hypot(p.x - state.crateX, p.z - state.crateZ) > reach) continue;
      const side = p.role === 'kaiju' ? 'kaiju' : 'tanks';
      state.bonus = side; state.bonusIn = T.crateBonusSeconds;
      state.crateOn = false; state.crateIn = T.crateRespawnSeconds;
      emit('crate', { id, side, x: state.crateX, z: state.crateZ });
      break;
    }
  }

  // ── King of the Hill ───────────────────────────────────────
  // A street tile with enough standing buildings around it, away from the last hill.
  function moveHill() {
    const standing = (x, z) => {
      let c = 0;
      for (const b of city.buildings) {
        if (b.kind === 'park' || state.buildingHp[b.id] <= 0) continue;
        if (Math.hypot(b.cx - x, b.cz - z) <= T.hillRadius) c++;
      }
      return c;
    };
    const far = streets.filter(s => Math.hypot(s.x - state.hillX, s.z - state.hillZ) >= T.hillRadius * 2);
    const pool = far.length ? far : streets;
    let spot = null;
    for (let tries = 0; tries < 60 && !spot; tries++) {
      const s = pick(pool);
      if (standing(s.x, s.z) >= T.hillMinBuildings) spot = s;
    }
    spot ||= pick(pool);
    state.hillX = spot.x; state.hillZ = spot.z; state.hillIn = T.hillMoveSeconds;
    emit('hill', { x: spot.x, z: spot.z });
  }

  // ── Evacuation ─────────────────────────────────────────────
  const civ = new Map();   // civilian id → { path, replanIn, panic } (server-only)
  let civSeq = 0, civSpawnIn = 0, civSpawned = 0;
  const onExit = (x, z) => EXITS.some(e => e.x === x && e.z === z);
  function civPath(c, k) {
    const sx = Math.round(c.x), sz = Math.round(c.z);
    const scared = k && k.alive && dist(c, k) < T.civilianPanicRange;
    const avoid = scared ? (x, z) => Math.hypot(x - k.x, z - k.z) < 2.2 : null;
    return bfs(city, 'tank', sx, sz, onExit, { maxNodes: 2000, destroyed, avoid })
        || bfs(city, 'tank', sx, sz, onExit, { maxNodes: 2000, destroyed });
  }
  function spawnCivilian(k) {
    // step out of a standing building onto the street, away from the exits and the kaiju
    for (let tries = 0; tries < 40; tries++) {
      const s = pick(streets);
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
      civSpawned++;
      return;
    }
  }
  function tickCivilians(dt, k) {
    if (civSpawned < T.evacPool && (civSpawnIn -= dt) <= 0 && state.civilians.size < T.civilianMaxAlive) {
      civSpawnIn = T.civilianSpawnSeconds;
      spawnCivilian(k);
    }
    const half = T.evacPool / 2;
    for (const [id, c] of [...state.civilians]) {
      const brain = civ.get(id);
      if (!brain) continue;
      const panic = !!(k && k.alive && dist(c, k) < T.civilianPanicRange);
      brain.replanIn -= dt;
      if (!brain.path || (panic && (brain.replanIn <= 0 || !brain.panic))) { brain.path = civPath(c, k); brain.replanIn = 0.8; }
      brain.panic = panic;
      const inp = brain.path ? steer(c, brain.path) : { x: 0, z: 0 };
      const walker = { role: 'tank', x: c.x, z: c.z, rot: c.rot, moving: c.moving };
      c.moving = stepUnit(city, walker, inp, dt, T.civilianSpeed * (panic ? 1.25 : 1), T.civilianRadius, destroyed);
      c.x = walker.x; c.z = walker.z; c.rot = walker.rot;
      if (k && k.alive && dist(c, k) < T.kaijuRadius + T.civilianRadius + T.stompReach) {   // stomped
        state.civilians.delete(id); civ.delete(id);
        state.stomped += 1; k.score += 1;
        emit('civilianDown', { x: c.x, z: c.z, count: state.stomped });
      } else if (EXITS.some(e => Math.hypot(e.x - c.x, e.z - c.z) < 0.35)) {             // escaped
        state.civilians.delete(id); civ.delete(id);
        state.evacuated += 1;
        emit('escaped', { x: c.x, z: c.z, count: state.evacuated });
      }
    }
    // first side past half the crowd wins; if everyone is accounted for, the bigger side
    if (state.stomped > half || state.evacuated > half) return endRound();
    if (civSpawned >= T.evacPool && !state.civilians.size) return endRound();
  }

  // ── Tick ───────────────────────────────────────────────────
  function tick(dt) {
    now += dt;

    // AFK flags (shown in the lobby; AFK players don't block the start)
    for (const [id, p] of state.players) { const a = !p.bot && isAfk(id); if (p.afk !== a) p.afk = a; }

    // Phase clock
    if (state.phase === 'lobby') {
      if (lobbyReady()) { state.phase = 'countdown'; state.clock = T.countdownSeconds; fromLobby = true; emit('countdown', {}); }
    } else if (state.phase === 'countdown') {
      if (!seatsFilled()) { state.phase = 'lobby'; for (const p of state.players.values()) p.ready = false; }
      else if (fromLobby && !lobbyReady()) state.phase = 'lobby';   // someone un-readied
      else if ((state.clock -= dt) <= 0) startRound();
    } else if (state.phase === 'playing') {
      if ((state.clock -= dt) <= 0) { state.clock = 0; endRound(); }
      else if (koth() && (state.hillIn -= dt) <= 0) moveHill();
    } else if (state.phase === 'ended') {
      if ((state.clock -= dt) <= 0) resetRound();
    }
    const live = state.phase === 'playing';
    if (state.healIn > 0) state.healIn = Math.max(0, state.healIn - dt);

    // Movement (combat actions only while live; driving works while waiting)
    for (const [id, p] of state.players) {
      const t = timer(id);
      if (p.role === 'kaiju') {
        p.strikeIn = Math.max(0, p.strikeIn - dt);
        p.boostIn = Math.max(0, p.boostIn - dt);
        t.root = Math.max(0, t.root - dt);
        if (!p.alive) {
          if (live && (p.respawnIn -= dt) <= 0) { placeKaiju(p, kaijuRespawnSpot(p)); emit('kaijuUp', { id }); }
          continue;
        }
        if (live && actions.has(id)) kaijuStrike(p, id);
        // boost: surge to boostPeak × speed, then ease back over boostSeconds
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
          if (live || state.phase === 'ended') {
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
    if (!live) return;

    const k = kaiju();
    if (state.mode === 'race') tickCrate(dt);
    if (state.mode === 'evac') { tickCivilians(dt, k); if (state.phase !== 'playing') return; }
    if (koth() || !k) return;

    // Stomps: the kaiju walking into a tank kills it.
    const kid = idOf(k);
    for (const p of tanks()) {
      if (!p.alive || !k.alive) continue;
      if (dist(k, p) < T.kaijuRadius + T.tankRadius + T.stompReach) killTank(p, idOf(p), k, kid);
    }

    // Auto-fire: turrets lock on when the kaiju is in range and in sight.
    for (const p of tanks()) {
      if (!p.alive) continue;
      const id = idOf(p), t = timer(id);
      t.fire = Math.max(0, t.fire - dt);
      if (!k.alive || t.fire > 0 || dist(p, k) > T.tankRange) continue;
      t.fire = T.tankFireInterval;
      // a building in the way takes the shell instead (no damage to it or the kaiju)
      const hit = T.tankLineOfSight ? firstHit(city, blocksShots, p.x, p.z, k.x, k.z) : null;
      if (hit) { emit('shot', { id, kind: 'tank', blocked: true, x: hit.x, z: hit.z }); continue; }
      emit('shot', { id, kind: 'tank', target: kid });
      damageKaiju(k, kid, T.tankDamage, p);
    }
  }

  // Move a unit instantly (tests / dev).
  function teleport(id, x, z) {
    const p = state.players.get(id);
    if (!p) return;
    p.x = x; p.z = z;
  }
  // Can a tank at a see a kaiju at b? (bots use this)
  const canSee = (a, b) => !T.tankLineOfSight || !firstHit(city, blocksShots, a.x, a.z, b.x, b.z);

  if (!MODES.includes(state.mode)) state.mode = T.defaultMode;
  rescale();
  return { city, join, leave, input, action, block, boost, canSee, tick, destroyed, blocked, pickRespawn, teleport, maxHpOf,
           setName, setReady, setRole, setMode, isAfk, moveHill, spawnCrate, kaijus };
}
