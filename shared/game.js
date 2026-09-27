// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — THE RULES
//  All game logic, shared by the server (authoritative) and the
//  offline sandbox. It works on a "state" object whose shape is the
//  same whether it's a Colyseus schema or a plain JS object; `make`
//  supplies the constructors for players and soldiers.
//  Every number comes from shared/tuning.js.
// ─────────────────────────────────────────────────────────────
import { TUNING, kaijuSpeedFor, kaijuMaxHpFor } from './tuning.js';
import { parseCity, SPAWNS } from './map.js';
import { stepUnit, tileWalkable } from './sim.js';

const T = TUNING;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Plain-object factories (tests + offline sandbox). The server passes schema ones.
export const plainMake = {
  player: () => ({ role: '', slot: -1, mobile: false, x: 0, z: 0, rot: 0, moving: false,
    alive: true, respawnIn: 0, boostIn: 0, boosting: false, strikeIn: 0, soldiers: [] }),
  soldier: () => ({ x: 0, z: 0, rot: 0, alive: true, firing: false }),
  state: () => ({ phase: 'waiting', clock: 0, winner: '', kaijuHp: 0, kaijuMaxHp: 0,
    kaijuScore: 0, kaijuSpeed: 0, players: new Map(), buildingHp: [] }),
};

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
  const trails = new Map();        // tank id → recent path points, newest first
  const timers = new Map();        // id → { fire, root, soldierFire[] } (server-only, not synced)
  const streets = [];
  for (let z = 0; z < city.depth; z++) for (let x = 0; x < city.width; x++)
    if (city.tiles[z][x] === '#') streets.push({ x, z });

  // Buildings: HP per building id (parks get 0 and are never targets).
  const maxHpOf = (b) => b.kind === 'park' ? 0 : T.buildingHp[b.kind];
  if (!state.buildingHp.length) for (const b of city.buildings) state.buildingHp.push(maxHpOf(b));
  const destroyed = (id) => city.buildings[id].kind !== 'park' && state.buildingHp[id] <= 0;

  const kaiju = () => { for (const p of state.players.values()) if (p.role === 'kaiju') return p; return null; };
  const tanks = () => [...state.players.values()].filter(p => p.role === 'tank');
  const idOf = (player) => { for (const [id, p] of state.players) if (p === player) return id; };
  const timer = (id) => {
    if (!timers.has(id)) timers.set(id, { fire: 0, root: 0, soldierFire: new Array(T.soldiersPerTank).fill(0) });
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
    p.alive = true; p.respawnIn = 0; p.boosting = false;
    trails.set(id, [{ x: p.x, z: p.z }]);
    while (p.soldiers.length) p.soldiers.pop();
    for (let i = 0; i < T.soldiersPerTank; i++) {
      const s = make.soldier();
      s.x = p.x; s.z = p.z; s.rot = 0; s.alive = true; s.firing = false;
      p.soldiers.push(s);
    }
  }

  function placeKaiju(p) {
    p.x = SPAWNS.kaiju.x; p.z = SPAWNS.kaiju.z; p.rot = 0; p.moving = false; p.alive = true;
  }

  // ── Joining / leaving ──────────────────────────────────────
  function join(id, opts = {}) {
    const wantsKaiju = opts.role === 'kaiju', wantsTank = opts.role === 'tank';
    const mobile = !!opts.mobile;
    let role;
    if (mobile) role = 'tank';                               // phones always drive tanks
    else if (!kaiju() && !wantsTank) role = 'kaiju';
    else if (wantsKaiju && !kaiju()) role = 'kaiju';
    else role = 'tank';

    const p = make.player();
    p.role = role; p.mobile = mobile;
    p.alive = true; p.respawnIn = 0; p.boostIn = 0; p.boosting = false; p.strikeIn = 0;
    if (role === 'kaiju') {
      p.slot = -1;
      placeKaiju(p);
    } else {
      const used = new Set(tanks().map(t => t.slot));
      let slot = 0; while (used.has(slot)) slot++;
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
    inputs.delete(id); trails.delete(id); timers.delete(id); actions.delete(id);
    rescale();
  }

  const input = (id, v) => {
    const x = Number(v?.x), z = Number(v?.z);
    inputs.set(id, { x: Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0,
                     z: Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0 });
  };
  const action = (id) => actions.add(id);

  // ── Round flow ─────────────────────────────────────────────
  function resetRound() {
    for (const b of city.buildings) state.buildingHp[b.id] = maxHpOf(b);
    state.kaijuScore = 0; state.winner = '';
    for (const [id, p] of state.players) {
      if (p.role === 'kaiju') placeKaiju(p);
      else placeTank(p, id, SPAWNS.tanks[p.slot % SPAWNS.tanks.length]);
      p.boostIn = 0; p.strikeIn = 0;
      timers.delete(id);
    }
    state.phase = 'waiting';
    rescale();
  }

  function endRound(winner) {
    state.phase = 'ended'; state.winner = winner; state.clock = T.endScreenSeconds;
    emit('end', { winner, score: state.kaijuScore });
  }

  // ── Combat pieces ──────────────────────────────────────────
  function strikeTarget(k) {
    const tx = Math.round(k.x), tz = Math.round(k.z);
    const fx = Math.sin(k.rot), fz = Math.cos(k.rot);
    const facing = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    const dirs = [facing, [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const id = city.owner[tz + dz]?.[tx + dx];
      if (id === undefined || id < 0) continue;
      if (city.buildings[id].kind === 'park' || state.buildingHp[id] <= 0) continue;
      return id;
    }
    return -1;
  }

  function kaijuStrike(k, kid) {
    if (k.strikeIn > 0) return;
    const bid = strikeTarget(k);
    k.strikeIn = T.strikeCooldown;
    timer(kid).root = T.strikeRoot;
    if (bid < 0) { emit('strike', { bid: -1, x: k.x, z: k.z }); return; }
    const hp = Math.max(0, state.buildingHp[bid] - T.strikeDamage);
    state.buildingHp[bid] = hp;
    const b = city.buildings[bid];
    // turn to face the building being hit
    k.rot = Math.atan2(b.cx - k.x, b.cz - k.z);
    emit('strike', { bid, hp, x: k.x, z: k.z });
    if (hp <= 0) {
      const pts = T.buildingPoints[b.kind];
      state.kaijuScore += pts;
      emit('destroyed', { bid, points: pts });
    }
  }

  function damageKaiju(amount) {
    state.kaijuHp = Math.max(0, state.kaijuHp - amount);
    if (state.kaijuHp <= 0 && state.phase === 'playing') endRound('tanks');
  }

  function killTank(p, id) {
    p.alive = false; p.moving = false; p.boosting = false;
    p.respawnIn = T.tankRespawnSeconds;
    for (const s of p.soldiers) s.alive = false;   // squad respawns with the tank
    state.kaijuScore += T.pointsTankKill;
    emit('tankDown', { id, x: p.x, z: p.z, points: T.pointsTankKill });
  }

  // Soldiers walk the tank's recent path, in pairs behind it.
  function recordTrail(id, p) {
    const tr = trails.get(id) || [{ x: p.x, z: p.z }];
    if (dist(tr[0], p) >= 0.08) { tr.unshift({ x: p.x, z: p.z }); if (tr.length > 80) tr.pop(); }
    else { tr[0].x = p.x; tr[0].z = p.z; }
    trails.set(id, tr);
    return tr;
  }
  function trailPoint(tr, back) {
    // walk `back` tiles along the trail; returns point + local direction
    let left = back;
    for (let i = 0; i < tr.length - 1; i++) {
      const a = tr[i], b = tr[i + 1], seg = dist(a, b);
      if (seg >= left) {
        const t = left / seg;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: a.x - b.x, dz: a.z - b.z };
      }
      left -= seg;
    }
    const last = tr[tr.length - 1], prev = tr[tr.length - 2] || last;
    return { x: last.x, z: last.z, dx: prev.x - last.x, dz: prev.z - last.z };
  }
  function moveSoldiers(p, id, dt, k) {
    const tr = recordTrail(id, p);
    const maxStep = T.tankSpeed * T.boostMultiplier * 1.3 * dt;
    p.soldiers.forEach((s, i) => {
      if (!s.alive) return;
      const row = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
      const pt = trailPoint(tr, T.soldierSpacing * row);
      const len = Math.hypot(pt.dx, pt.dz) || 1;
      // perpendicular offset, but only where that spot is still street
      let tx = pt.x + (-pt.dz / len) * T.soldierSpread * side;
      let tz = pt.z + (pt.dx / len) * T.soldierSpread * side;
      if (!tileWalkable(city, 'tank', Math.round(tx), Math.round(tz))) { tx = pt.x; tz = pt.z; }
      const d = Math.hypot(tx - s.x, tz - s.z);
      if (d > 0.001) {
        const step = Math.min(d, maxStep);
        s.x += (tx - s.x) / d * step; s.z += (tz - s.z) / d * step;
        if (d > 0.02) s.rot = Math.atan2(tx - s.x, tz - s.z);
      }
      s.firing = !!(k && state.phase === 'playing' && dist(s, k) <= T.soldierRange);
      if (s.firing) s.rot = Math.atan2(k.x - s.x, k.z - s.z);
    });
  }

  // ── Tick ───────────────────────────────────────────────────
  function tick(dt) {
    const k = kaiju();
    const tankList = tanks();

    // Phase clock
    if (state.phase === 'waiting') {
      if (k && tankList.length) { state.phase = 'countdown'; state.clock = T.countdownSeconds; emit('countdown', {}); }
    } else if (state.phase === 'countdown') {
      if (!k || !tankList.length) state.phase = 'waiting';
      else if ((state.clock -= dt) <= 0) {
        state.phase = 'playing'; state.clock = T.matchSeconds; state.kaijuHp = state.kaijuMaxHp;
        emit('start', {});
      }
    } else if (state.phase === 'playing') {
      if ((state.clock -= dt) <= 0) { state.clock = 0; endRound('kaiju'); }
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
        const inp = t.root > 0 || state.phase === 'ended' ? null : inputs.get(id);
        p.moving = stepUnit(city, p, inp, dt, state.kaijuSpeed, T.kaijuRadius, destroyed);
      } else {
        p.boostIn = Math.max(0, p.boostIn - dt);
        if (!p.alive) {
          if (state.phase === 'playing' || state.phase === 'ended') {
            if ((p.respawnIn -= dt) <= 0) { placeTank(p, id, pickRespawn()); emit('respawn', { id }); }
          }
          continue;
        }
        if (actions.has(id) && p.boostIn <= 0 && state.phase !== 'ended') {
          p.boostIn = T.boostCooldown; t.boostLeft = T.boostSeconds; p.boosting = true;
          emit('boost', { id });
        }
        t.boostLeft = Math.max(0, (t.boostLeft || 0) - dt);
        p.boosting = t.boostLeft > 0;
        const speed = T.tankSpeed * (p.boosting ? T.boostMultiplier : 1);
        const inp = state.phase === 'ended' ? null : inputs.get(id);
        p.moving = stepUnit(city, p, inp, dt, speed, T.tankRadius, destroyed);
        moveSoldiers(p, id, dt, k);
      }
    }
    actions.clear();
    if (!live || !k) return;

    // Stomps: the kaiju walking into a tank or a soldier kills it.
    for (const p of tankList) {
      if (!p.alive) continue;
      const id = idOf(p);
      if (dist(k, p) < T.kaijuRadius + T.tankRadius + T.stompPad) { killTank(p, id); continue; }
      p.soldiers.forEach((s, i) => {
        if (s.alive && dist(k, s) < T.kaijuRadius + T.soldierRadius + T.stompPad) {
          s.alive = false; s.firing = false;
          state.kaijuScore += T.pointsSoldierKill;
          emit('soldierDown', { id, i, x: s.x, z: s.z, points: T.pointsSoldierKill });
        }
      });
    }

    // Auto-fire: turrets lock on when the kaiju is in range.
    for (const p of tankList) {
      if (!p.alive || state.phase !== 'playing') continue;
      const id = idOf(p), t = timer(id);
      t.fire = Math.max(0, t.fire - dt);
      if (t.fire <= 0 && dist(p, k) <= T.tankRange) {
        t.fire = T.tankFireInterval;
        emit('shot', { id, kind: 'tank' });
        damageKaiju(T.tankDamage);
      }
      p.soldiers.forEach((s, i) => {
        t.soldierFire[i] = Math.max(0, t.soldierFire[i] - dt);
        if (s.alive && s.firing && t.soldierFire[i] <= 0 && state.phase === 'playing') {
          t.soldierFire[i] = T.soldierFireInterval * (0.85 + rng() * 0.3); // stagger volleys
          emit('shot', { id, kind: 'soldier', i });
          damageKaiju(T.soldierDamage);
        }
      });
    }
  }

  // Move a unit instantly (tests / dev). Tanks bring their squad along.
  function teleport(id, x, z) {
    const p = state.players.get(id);
    if (!p) return;
    if (p.role === 'tank') { const alive = p.alive; placeTank(p, id, { x, z }); p.alive = alive; }
    else { p.x = x; p.z = z; }
  }

  rescale();
  return { city, join, leave, input, action, tick, destroyed, pickRespawn, teleport };
}
