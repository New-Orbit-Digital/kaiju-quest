import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, plainMake, inKaijuView, MODES } from '../../shared/game.js';
import { TUNING as T, kaijuMaxHpFor, kaijuSpeedFor, boostMultiplierAt, scaled } from '../../shared/tuning.js';
import { tileWalkable } from '../../shared/sim.js';
import { createBots } from '../../shared/bots.js';
import { SPAWNS, EXITS } from '../../shared/map.js';

// Helper: a game with a kaiju + n tanks (or n+1 kaiju in King of the Hill),
// already in the 'playing' phase.
function setup(nTanks = 1, opts = {}) {
  const state = plainMake.state();
  const events = [];
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = createGame({ state, emit: (type, e) => events.push({ type, ...e }), rng });
  if (opts.mode) g.setMode(null, opts.mode);
  g.join('K', { role: 'kaiju' });
  for (let i = 0; i < nTanks; i++) g.join(`T${i}`, { role: 'tank', mobile: opts.mobile });
  const run = (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.05) g.tick(0.05); };
  if (!opts.noStart) { for (const id of state.players.keys()) g.setReady(id, true); run(T.countdownSeconds + 0.1); }
  const place = (p, x, z) => { p.x = x; p.z = z; };
  return { g, state, events, run, place, K: state.players.get('K'), T0: state.players.get('T0') };
}
const pointsNow = (state) => ({ k: state.kaijuScore, t: state.tankScore });

// ── Lobby & seats ──────────────────────────────────────────────
test('round starts after the countdown, with kaiju HP and speed from the SCALING table', () => {
  const { state, K } = setup(3);
  assert.equal(state.phase, 'playing');
  assert.equal(state.mode, 'race');
  assert.equal(K.maxHp, scaled('kaijuHp', 3));
  assert.equal(K.hp, K.maxHp);
  assert.ok(Math.abs(state.kaijuSpeed - T.kaijuSpeed * scaled('kaijuSpeed', 3)) < 1e-9);
});

test('SCALING: one column per tank count; 0 tanks uses the 1-tank column', () => {
  for (const [key, col] of Object.entries(T.scaling)) assert.equal(col.length, T.maxTanks, key);
  assert.equal(scaled('kaijuHp', 0), T.scaling.kaijuHp[0]);
  assert.equal(scaled('kaijuHp', 99), T.scaling.kaijuHp[T.maxTanks - 1]);
  assert.equal(kaijuMaxHpFor(2), T.scaling.kaijuHp[1]);
  assert.ok(kaijuSpeedFor(6) > kaijuSpeedFor(1));
});

test('lobby: no countdown without both a kaiju and a tank', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('K', {}); g.setReady('K', true);
  for (let i = 0; i < 100; i++) g.tick(0.05);
  assert.equal(state.phase, 'lobby');
});

test('lobby: the round starts only when every active player is ready', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('K', { name: 'Justin' }); g.join('A', { name: 'Ana' }); g.join('B', { name: 'Bo' });
  assert.equal(state.players.get('K').name, 'Justin');
  g.setReady('K', true); g.setReady('A', true);
  for (let i = 0; i < 20; i++) g.tick(0.05);
  assert.equal(state.phase, 'lobby', 'B is not ready');
  g.setReady('B', true); g.tick(0.05);
  assert.equal(state.phase, 'countdown');
  g.setReady('A', false); g.tick(0.05);
  assert.equal(state.phase, 'lobby', 'un-ready cancels the countdown');
});

test('lobby: AFK players do not block the start; an AFK kaiju seat can be taken', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('K', {}); g.join('A', {}); g.join('Ghost', {});
  const run = (sec) => { for (let t = 0; t < sec; t += 0.05) { g.input('K', { x: 0.01, z: 0 }); g.input('A', { x: 0.01, z: 0 }); g.tick(0.05); } };
  run(T.afkSeconds + 0.5);
  assert.equal(state.players.get('Ghost').afk, true);
  g.setReady('K', true); g.setReady('A', true); g.tick(0.05);
  assert.equal(state.phase, 'countdown', 'ghost ignored');
  const s2 = plainMake.state(); const g2 = createGame({ state: s2 });
  g2.join('OldK', {}); g2.join('T', {});
  for (let t = 0; t < T.afkSeconds + 0.5; t += 0.05) { g2.input('T', { x: 0.01, z: 0 }); g2.tick(0.05); }
  assert.equal(g2.setRole('T', 'kaiju'), true);
  assert.equal(s2.players.get('T').role, 'kaiju');
  assert.equal(s2.players.get('OldK').role, 'tank');
});

test('lobby: roles swap only when the seat is free; phones can be the kaiju; names are cleaned', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('K', { name: '  <b>Ka iju</b>  ' }); g.join('A', {}); g.join('P', { mobile: true });
  assert.equal(state.players.get('K').name, 'bKa ijub');
  assert.equal(g.setRole('A', 'kaiju'), false, 'active kaiju keeps the seat');
  assert.equal(g.setRole('K', 'tank'), true);
  assert.equal(g.setRole('P', 'kaiju'), true, 'a phone can take a free kaiju seat');
  assert.equal(state.players.get('P').role, 'kaiju');
  g.setName('A', 'Ana'); assert.equal(state.players.get('A').name, 'Ana');
  // a phone joining first becomes the kaiju too
  const s2 = plainMake.state(); const g2 = createGame({ state: s2 });
  assert.equal(g2.join('P', { mobile: true }), 'kaiju');
});

test('picking KAIJU on join takes the seat from an idle kaiju, not an active one', () => {
  const { g, state, run } = setup(1);
  g.input('K', { x: 1, z: 0 }); g.tick(0.05);
  assert.equal(g.join('D', { role: 'kaiju' }), 'tank', 'active kaiju keeps the seat');
  g.leave('D');
  g.input('K', { x: 0, z: 0 });
  run(T.afkSeconds + 0.5);
  assert.equal(g.join('D', { role: 'kaiju' }), 'kaiju');
  assert.equal(state.players.get('K').role, 'tank', 'idle kaiju became a tank');
});

// ── Kaiju ─────────────────────────────────────────────────────
test('SPACE smash: building damage stays; destroyed → rubble + kaiju points', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  place(T0, 24, 24);
  place(K, 1, 3); K.rot = 0;           // street tile; house at (1,4) to the south
  const bid = g.city.owner[4][1];
  const hp0 = state.buildingHp[bid];
  g.action('K'); g.tick(0.05);
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage);
  g.action('K'); g.tick(0.05);
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage, 'cooldown');
  g.input('K', { x: 1, z: 0 }); run(1); g.input('K', { x: -1, z: 0 }); run(1.2); g.input('K', { x: 0, z: 0 });
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage, 'damage stays');
  place(K, 1, 3); K.rot = 0;
  for (let i = 0; i < Math.ceil(hp0 / T.strikeDamage) - 1; i++) { run(T.strikeCooldown + 0.05); g.action('K'); g.tick(0.05); }
  assert.equal(state.buildingHp[bid], 0);
  assert.equal(state.kaijuScore, T.buildingPoints.house);
  assert.ok(events.some(e => e.type === 'destroyed' && e.bid === bid && e.id === 'K'));
  assert.equal(tileWalkable(g.city, 'kaiju', 1, 4, g.destroyed), true);
  assert.equal(tileWalkable(g.city, 'tank', 1, 4, g.destroyed), false);
});

test('strikeRange: 1 reaches only the building beside the kaiju; 1.5 reaches diagonals', () => {
  const { g, state, K, T0, place } = setup(1);
  place(T0, 24, 24); place(K, 12, 12);   // crossroad beside downtown towers
  const total = () => state.buildingHp.reduce((a, b) => a + b, 0);
  const before = total();
  g.action('K'); g.tick(0.05);
  assert.equal(total(), before, 'nothing within 1 tile of a crossroad centre');
  T.strikeRange = 1.5;
  g.tick(T.strikeCooldown + 0.05); g.action('K'); g.tick(0.05);
  assert.equal(total(), before - T.strikeDamage);
  T.strikeRange = 1;
});

test('strike roots the kaiju briefly', () => {
  const { g, run, K, T0, place } = setup(1);
  place(T0, 24, 24); place(K, 1, 3);
  g.input('K', { x: 1, z: 0 });
  g.action('K'); g.tick(0.05);
  const x0 = K.x;
  run(T.strikeRoot - 0.1);
  assert.equal(K.x, x0, 'rooted');
  run(0.5);
  assert.ok(K.x > x0, 'moves again after the root');
});

test('kaiju boost: surges to boostPeak quickly, eases back to 1× by boostSeconds, then cools down', () => {
  const { g, run, K, T0, place } = setup(1);
  place(T0, 30, 30); place(K, 1, 9);
  g.input('K', { x: 1, z: 0 });            // east along row 9 (a long straight)
  run(0.5);
  const x0 = K.x;
  g.boost('K'); g.tick(0.05);
  assert.equal(K.boosting, true);
  assert.equal(K.boostIn, T.boostCooldown);
  run(0.95);
  const boosted = K.x - x0, normal = kaijuSpeedFor(1);
  assert.ok(boosted > normal * 2, `1 s of boost covered ${boosted.toFixed(2)} tiles vs ${normal.toFixed(2)} walking`);
  assert.ok(Math.abs(boostMultiplierAt(T.boostRampSeconds) - T.boostPeak) < 1e-9);
  assert.equal(boostMultiplierAt(T.boostSeconds), 1);
  assert.ok(boostMultiplierAt(1) > boostMultiplierAt(2), 'eases down');
  run(T.boostSeconds);
  assert.equal(K.boosting, false);
  g.boost('K'); g.tick(0.05);
  assert.equal(K.boosting, false, 'still cooling down');
});

// ── Tanks ─────────────────────────────────────────────────────
test('tanks have no boost: action does nothing for a tank', () => {
  const { g, T0, K, place } = setup(1);
  place(K, 30, 30); place(T0, 0, 3);
  g.action('T0'); g.tick(0.05);
  assert.equal(T0.boosting, false);
  assert.equal(T0.boostIn, 0);
});

test('tank auto-fires only in range, for tankDamage a shot', () => {
  const { run, K, T0, place } = setup(1);
  place(K, 12, 12); place(T0, 24, 24);
  run(3);
  assert.equal(K.hp, K.maxHp);
  place(T0, 12, 12 + T.tankRange - 1);   // in range, same column (street)
  run(T.tankFireInterval * 0.5);
  assert.equal(K.maxHp - K.hp, T.tankDamage);
});

test('line of sight: a building between tank and kaiju takes the shell, no damage', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  place(K, 2, 3); place(T0, 2, 6);   // the NW house block (rows 4-5) is between them
  assert.equal(g.canSee(T0, K), false);
  run(T.tankFireInterval * 2);
  assert.equal(K.hp, K.maxHp, 'no damage through a building');
  const blockedShot = events.find(e => e.type === 'shot' && e.blocked);
  assert.ok(blockedShot && blockedShot.z > 3.5 && blockedShot.z < 5.5, 'shell stops at the building');
  place(T0, 5, 3);
  assert.equal(g.canSee(T0, K), true);
  run(T.tankFireInterval + 0.05);
  assert.ok(K.hp < K.maxHp);
  state.buildingHp[g.city.owner[4][2]] = 0; state.buildingHp[g.city.owner[5][2]] = 0;
  place(T0, 2, 6);
  assert.equal(g.canSee(T0, K), true, 'rubble does not block');
});

test('repair: restores damaged buildings at the scaled rate and scores tank points; rubble stays', () => {
  const { g, state, run, K, T0, place } = setup(1);
  place(K, 30, 30);
  const house = g.city.owner[4][1], house2 = g.city.owner[4][2];
  state.buildingHp[house] = 5; state.buildingHp[house2] = 0;
  place(T0, 1, 3);
  run(1);
  const rate = T.repairPerSecond * scaled('repairRate', 1);
  assert.ok(Math.abs(state.buildingHp[house] - (5 + rate)) < 0.4, `repaired to ${state.buildingHp[house]}`);
  assert.ok(Math.abs(state.tankScore - rate * T.repairPoints) < 0.4, `tank points ${state.tankScore}`);
  run(20);
  assert.equal(state.buildingHp[house], T.buildingHp.house, 'capped at full HP');
  assert.ok(Math.abs(state.tankScore - (T.buildingHp.house - 5) * T.repairPoints) < 1e-6, 'points only for HP actually repaired');
  assert.equal(state.buildingHp[house2], 0, 'destroyed buildings are not repaired');
});

test('repairing flag is set only while a tank is fixing a building', () => {
  const { g, state, K, T0, place } = setup(1);
  place(K, 30, 30); place(T0, 1, 3);
  const bid = g.city.owner[4][1];
  g.tick(0.05);
  assert.equal(T0.repairing, false);
  state.buildingHp[bid] = 5; g.tick(0.05);
  assert.equal(T0.repairing, true);
  state.buildingHp[bid] = T.buildingHp.house; g.tick(0.05);
  assert.equal(T0.repairing, false);
});

test('roadblocks: drop in front of the tank across the road, block only the kaiju, 2 smashes, cooldown', () => {
  const { g, state, run, K, T0, place } = setup(1);
  place(K, 24, 12); place(T0, 6, 3);
  g.input('T0', { x: 1, z: 0 }); g.tick(0.05); g.input('T0', { x: 0, z: 0 });   // face east
  const tx = Math.round(T0.x) + 1;
  g.block('T0'); g.tick(0.05);
  assert.ok(state.roadblocks.has(`${tx},3`), 'dropped on the tile in front (east)');
  assert.equal(state.roadblocks.get(`${tx},3`).rot, Math.PI / 2, 'barrier turned across the east–west road');
  g.block('T0'); g.tick(0.05);
  assert.equal(state.roadblocks.size, 1, 'cooldown');
  place(T0, 24, 24);                         // out of the kaiju's way
  place(K, tx - 2, 3); K.rot = Math.PI / 2;
  g.input('K', { x: 1, z: 0 }); run(1.5); g.input('K', { x: 0, z: 0 });
  assert.ok(K.x < tx - 0.5, `kaiju blocked at x=${K.x.toFixed(2)}`);
  const kx = K.x; place(K, 24, 12);          // step the kaiju aside while the tank drives through
  place(T0, tx + 1, 3);
  g.input('T0', { x: -1, z: 0 }); run(0.8); g.input('T0', { x: 0, z: 0 });
  assert.ok(T0.x < tx, 'tank passed through its own roadblock');
  place(T0, 24, 24); place(K, kx, 3);
  T.strikeRange = 1.5;
  for (let i = 0; i < T.roadblockHits; i++) { run(T.strikeCooldown + 0.05); K.rot = Math.PI / 2; g.action('K'); g.tick(0.05); }
  T.strikeRange = 1;
  assert.equal(state.roadblocks.size, 0, 'broken after 2 smashes');
});

test('roadblocks: a tank keeps at most roadblockMaxPerTank; round reset clears them', () => {
  const { g, state, run, K, T0, place } = setup(1);
  place(K, 24, 24);
  for (let i = 0; i < T.roadblockMaxPerTank + 1; i++) {
    place(T0, 3 + i * 3, 3); T0.rot = Math.PI / 2; T0.blockIn = 0;
    g.block('T0'); g.tick(0.05);
  }
  assert.equal(state.roadblocks.size, T.roadblockMaxPerTank);
  state.clock = 0.05; run(0.1); run(T.endScreenSeconds + 0.1);
  assert.equal(state.roadblocks.size, 0);
});

test('stomp: the kaiju crushes a tank for SCALING points; it respawns later, away and out of view', () => {
  const { state, events, run, K, T0, place } = setup(1);
  place(K, 12, 12); place(T0, 12, 12.3);
  run(0.05);
  assert.equal(T0.alive, false);
  assert.equal(state.kaijuScore, scaled('tankCrushPoints', 1));
  run(scaled('tankRespawn', 1) - 0.3);
  assert.equal(T0.alive, false, 'still out');
  run(0.5);
  assert.equal(T0.alive, true);
  assert.ok(Math.hypot(T0.x - K.x, T0.z - K.z) >= T.respawnMinDistance);
  assert.equal(inKaijuView(K, T0), false);
  assert.ok(events.some(e => e.type === 'respawn'));
});

// ── Points race ───────────────────────────────────────────────
test('points race: killing the kaiju scores for the tanks, doubles repair for a while, and it respawns', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  K.hp = 1; place(K, 12, 12); place(T0, 12, 15);
  run(T.tankFireInterval * 0.5);
  assert.equal(K.alive, false);
  assert.equal(state.phase, 'playing', 'the round goes on');
  assert.equal(state.tankScore, scaled('kaijuKillPoints', 1));
  assert.ok(state.healIn > 0);
  // repair runs × deathRepairBoost while healIn lasts
  const house = g.city.owner[4][1]; state.buildingHp[house] = 5; place(T0, 1, 3);
  const before = state.tankScore;
  run(1);
  const rate = T.repairPerSecond * scaled('repairRate', 1) * T.deathRepairBoost;
  assert.ok(Math.abs(state.buildingHp[house] - (5 + rate)) < 0.8, `boosted repair to ${state.buildingHp[house]}`);
  assert.ok(state.tankScore > before);
  // the dead kaiju can't smash or stomp, and comes back after kaijuRespawn with full health
  run(scaled('kaijuRespawn', 1));
  assert.equal(K.alive, true);
  assert.equal(K.hp, K.maxHp);
  assert.ok(events.some(e => e.type === 'kaijuDown') && events.some(e => e.type === 'kaijuUp'));
});

test('points race: the higher score wins at the buzzer; equal scores tie', () => {
  const a = setup(1);
  a.place(a.T0, 24, 24); a.place(a.K, 12, 12);
  a.state.kaijuScore = 50; a.state.tankScore = 40; a.state.clock = 0.1; a.run(0.2);
  assert.equal(a.state.phase, 'ended'); assert.equal(a.state.winner, 'kaiju');
  const b = setup(1);
  b.place(b.T0, 24, 24); b.place(b.K, 12, 12);
  b.state.kaijuScore = 10; b.state.tankScore = 90; b.state.clock = 0.1; b.run(0.2);
  assert.equal(b.state.winner, 'tanks');
  const c = setup(1);
  c.place(c.T0, 24, 24); c.place(c.K, 12, 12);
  c.state.clock = 0.1; c.run(0.2);
  assert.equal(c.state.winner, 'tie');
});

test('bonus crate: appears fair to both sides, drifts toward the kaiju faster with more tanks, and tilts scoring', () => {
  const { g, state, events, run, K, place } = setup(3);
  const tanks = [0, 1, 2].map(i => state.players.get(`T${i}`));
  place(K, 15, 20); tanks.forEach((t, i) => place(t, 0 + i * 15, 0));
  assert.equal(state.crateOn, false);
  run(T.crateFirstSeconds + 0.1);
  assert.equal(state.crateOn, true, 'first crate after crateFirstSeconds');
  const c0 = { x: state.crateX, z: state.crateZ };
  assert.ok(Math.hypot(c0.x - K.x, c0.z - K.z) >= T.crateMinDistance - 1e-9);
  // drift: toward the kaiju at SCALING crateDrift (3 tanks)
  const d0 = Math.hypot(state.crateX - K.x, state.crateZ - K.z);
  run(3);
  const d1 = Math.hypot(state.crateX - K.x, state.crateZ - K.z);
  assert.ok(d1 < d0, `crate drifted closer (${d0.toFixed(2)} → ${d1.toFixed(2)})`);
  const moved = Math.hypot(state.crateX - c0.x, state.crateZ - c0.z);
  assert.ok(moved <= scaled('crateDrift', 3) * 3 + 0.2 && moved > scaled('crateDrift', 3) * 3 * 0.5, `moved ${moved.toFixed(2)}`);
  // the kaiju grabs it → kaiju side scores × crateFavor, tanks × crateOppose
  place(K, state.crateX, state.crateZ); run(0.05);
  assert.equal(state.crateOn, false);
  assert.equal(state.bonus, 'kaiju');
  assert.ok(events.some(e => e.type === 'crate' && e.side === 'kaiju'));
  const house = g.city.owner[4][1];
  state.buildingHp[house] = T.strikeDamage; place(K, 1, 3); K.rot = 0; K.strikeIn = 0;
  const p0 = pointsNow(state);
  g.action('K'); g.tick(0.05);
  assert.equal(state.kaijuScore - p0.k, T.buildingPoints.house * T.crateFavor);
  run(T.crateBonusSeconds);
  assert.equal(state.bonus, '', 'tilt wears off');
  assert.ok(state.crateIn > 0 && state.crateIn <= T.crateRespawnSeconds, 'next crate is on its way');
});

test('bonus crate: does not drift with a single tank (SCALING crateDrift starts at 0)', () => {
  const { state, run, K, T0, place } = setup(1);
  place(K, 15, 20); place(T0, 0, 0);
  run(T.crateFirstSeconds + 0.1);
  const c0 = { x: state.crateX, z: state.crateZ };
  run(3);
  assert.equal(scaled('crateDrift', 1), 0);
  assert.deepEqual({ x: state.crateX, z: state.crateZ }, c0);
});

test('next round resets buildings, scores and positions', () => {
  const { g, state, run, K, T0, place } = setup(1);
  const bid = g.city.owner[4][1];
  state.buildingHp[bid] = 0; state.kaijuScore = 99; state.tankScore = 12; place(T0, 24, 24);
  state.clock = 0.05; run(0.1);
  assert.equal(state.phase, 'ended');
  run(T.endScreenSeconds + T.countdownSeconds + 0.2);
  assert.equal(state.phase, 'playing');
  assert.equal(state.buildingHp[bid], T.buildingHp.house);
  assert.equal(state.kaijuScore, 0); assert.equal(state.tankScore, 0);
  assert.equal(K.x, SPAWNS.kaiju.x); assert.equal(K.z, SPAWNS.kaiju.z);
});

test('a tank joining mid-round adds kaiju HP and speed per the SCALING table', () => {
  const { g, state, K } = setup(1);
  K.hp -= 30;
  g.join('T1', { role: 'tank' });
  assert.equal(K.maxHp, scaled('kaijuHp', 2));
  assert.equal(K.hp, scaled('kaijuHp', 2) - 30);
  assert.ok(Math.abs(state.kaijuSpeed - kaijuSpeedFor(2)) < 1e-9);
  const t1 = state.players.get('T1');
  assert.ok(Math.hypot(t1.x - K.x, t1.z - K.z) >= T.respawnMinDistance, 'joins away from the kaiju');
});

// ── Modes ─────────────────────────────────────────────────────
test('modes: Points race is the default; picked in the lobby or on the end screen only', () => {
  assert.deepEqual(MODES, ['race', 'koth', 'evac']);
  const state = plainMake.state();
  const g = createGame({ state });
  assert.equal(state.mode, 'race');
  g.join('K', { role: 'kaiju' });
  assert.equal(g.setMode('K', 'nope'), false);
  const a = setup(1);
  assert.equal(a.g.setMode('K', 'evac'), false, 'not mid-round');
  a.state.clock = 0.05; a.run(0.1);
  assert.equal(a.g.setMode('K', 'evac'), true, 'allowed on the end screen');
});

test('king of the hill: everyone becomes a tinted kaiju; switching back leaves one kaiju', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('A', { name: 'A' }); g.join('B', { name: 'B' }); g.join('C', { name: 'C', mobile: true });
  assert.deepEqual([...state.players.values()].map(p => p.role), ['kaiju', 'tank', 'tank']);
  g.setMode('A', 'koth');
  const ps = [...state.players.values()];
  assert.ok(ps.every(p => p.role === 'kaiju' && p.maxHp === T.kothHp), 'all kaiju, incl. the phone');
  assert.deepEqual(ps.map(p => p.slot).sort(), [0, 1, 2], 'each its own colour');
  assert.equal(g.join('D', { role: 'tank' }), 'kaiju', 'late joiners are kaiju too');
  g.setMode('A', 'race');
  assert.deepEqual([...state.players.values()].map(p => p.role), ['kaiju', 'tank', 'tank', 'tank']);
});

test('king of the hill: kaiju smash each other, knock-outs score, top score wins', () => {
  const { g, state, events, run, K, place } = setup(1, { mode: 'koth' });
  const R = state.players.get('T0');
  assert.equal(R.role, 'kaiju');
  place(K, 12, 3); place(R, 13, 3); K.rot = Math.PI / 2;
  for (let i = 0; i < Math.ceil(T.kothHp / T.kothHitDamage); i++) { K.strikeIn = 0; g.action('K'); g.tick(0.05); }
  assert.equal(R.alive, false, 'knocked out');
  assert.equal(K.score, T.kothKillPoints);
  run(T.kothRespawn + 0.1);
  assert.equal(R.alive, true); assert.equal(R.hp, T.kothHp);
  assert.ok(events.some(e => e.type === 'strike' && e.hitKaiju === 'T0'));
  state.clock = 0.05; run(0.1);
  assert.equal(state.winner, 'K');
});

test('king of the hill: the hill moves on its timer and multiplies smash points inside it', () => {
  const { g, state, events, run, K, place } = setup(1, { mode: 'koth' });
  place(state.players.get('T0'), 30, 30);
  const first = { x: state.hillX, z: state.hillZ };
  assert.ok(events.some(e => e.type === 'hill'));
  const around = g.city.buildings.filter(b => b.kind !== 'park' && Math.hypot(b.cx - first.x, b.cz - first.z) <= T.hillRadius);
  assert.ok(around.length >= T.hillMinBuildings, `${around.length} buildings in the hill`);
  const house = around.find(b => b.size === 1 && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dz]) => g.city.tiles[b.z + dz]?.[b.x + dx] === '#'));
  state.buildingHp[house.id] = T.strikeDamage;
  const [sx, sz] = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx, dz]) => [house.x + dx, house.z + dz]).find(([x, z]) => g.city.tiles[z]?.[x] === '#');
  place(K, sx, sz); K.rot = Math.atan2(house.x - sx, house.z - sz);
  g.action('K'); g.tick(0.05);
  assert.equal(state.buildingHp[house.id], 0);
  assert.equal(K.score, T.buildingPoints[house.kind] * T.hillMultiplier);
  run(T.hillMoveSeconds + 0.1);
  assert.ok(state.hillX !== first.x || state.hillZ !== first.z, 'zone moved');
});

test('king of the hill: needs two players to start', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.setMode(null, 'koth');
  g.join('A', {}); g.setReady('A', true);
  for (let i = 0; i < 40; i++) g.tick(0.05);
  assert.equal(state.phase, 'lobby');
  g.join('B', {}); g.setReady('B', true); g.tick(0.05);
  assert.equal(state.phase, 'countdown');
});

test('evacuation: a fixed crowd walks to the exits; first side past half wins', () => {
  const { g, state, events, run, K, T0, place } = setup(1, { mode: 'evac' });
  place(K, 30, 30); place(T0, 12, 20);
  run(40);
  assert.ok(state.evacuated > 0, `evacuated ${state.evacuated}`);
  assert.ok(events.some(e => e.type === 'escaped'));
  state.civilians.forEach(c => assert.ok(['#', 'g'].includes(g.city.tiles[Math.round(c.z)][Math.round(c.x)]), 'civilians stay on streets / parks'));
  state.evacuated = Math.floor(T.evacPool / 2);
  let id, c; for (const [i, cv] of state.civilians) { id = i; c = cv; break; }
  if (!c) { run(T.civilianSpawnSeconds + 0.1); [[id, c]] = [...state.civilians]; }
  const e = EXITS[0]; c.x = e.x; c.z = e.z;
  g.tick(0.05);
  assert.equal(state.phase, 'ended'); assert.equal(state.winner, 'tanks');
});

test('evacuation: stomps count for the kaiju; roadblocks are sturdier and unlimited', () => {
  const { g, state, run, K, T0, place } = setup(1, { mode: 'evac' });
  place(T0, 0, 30);
  g.tick(0.05);
  const [, c] = [...state.civilians][0];
  place(K, Math.round(c.x), Math.round(c.z));
  g.tick(0.05);
  assert.equal(state.stomped, 1);
  place(K, 30, 30);
  for (let i = 0; i < T.roadblockMaxPerTank + 2; i++) {
    place(T0, 3 + i * 3, 3); T0.rot = Math.PI / 2; T0.blockIn = 0;
    g.block('T0'); g.tick(0.05);
  }
  assert.equal(state.roadblocks.size, T.roadblockMaxPerTank + 2, 'no cap');
  assert.ok([...state.roadblocks.values()].every(rb => rb.hits === T.evacRoadblockHits));
});

test('evacuation: the round never ends early from the crowd before half has gone one way', () => {
  const { state, run, K, T0, place } = setup(1, { mode: 'evac' });
  place(K, 30, 30); place(T0, 0, 0);
  state.stomped = Math.floor(T.evacPool / 2); run(0.05);
  assert.equal(state.phase, 'playing', 'exactly half is not a win');
});

// ── Bots ──────────────────────────────────────────────────────
test('bots: a bot kaiju smashes buildings and bot tanks close in and fire', () => {
  const state = plainMake.state();
  let seed = 7; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const events = [];
  const g = createGame({ state, rng, emit: (type, e) => events.push({ type, ...e }) });
  const bots = createBots(g, state);
  assert.ok(bots.add('kaiju'));
  assert.equal(bots.add('kaiju'), null, 'only one kaiju');
  bots.add('tank'); bots.add('tank');
  for (let t = 0; t < 70; t += 0.05) { bots.tick(0.05); g.tick(0.05); }
  assert.ok(events.some(e => e.type === 'start'), 'bots ready up on their own');
  const strikes = events.filter(e => e.type === 'strike' && e.bid >= 0).length;
  const shots = events.filter(e => e.type === 'shot' && !e.blocked).length;
  assert.ok(strikes >= 5, `bot kaiju smashed ${strikes} times`);
  assert.ok(shots >= 5, `bot tanks fired ${shots} times`);
});

test('bots: in King of the Hill every bot is a kaiju', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.setMode(null, 'koth');
  const bots = createBots(g, state);
  bots.add('tank'); bots.add('kaiju'); bots.add('tank');
  assert.deepEqual([...state.players.values()].map(p => p.role), ['kaiju', 'kaiju', 'kaiju']);
  for (let t = 0; t < 20; t += 0.05) { bots.tick(0.05); g.tick(0.05); }
  assert.equal(state.phase, 'playing');
});

test('bots: a person picking KAIJU takes the seat from a bot kaiju', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  const bots = createBots(g, state);
  const bk = bots.add('kaiju');
  g.join('me', { role: 'tank', name: 'Me' });
  assert.equal(g.setRole('me', 'kaiju'), true);
  assert.equal(state.players.get(bk).role, 'tank');
});

test('bots: a bot kaiju walks up to a roadblock in its way and smashes through it', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  const bots = createBots(g, state, () => 0.5);
  const kid = bots.add('kaiju'); const tid = bots.add('tank');
  for (let t = 0; t < T.countdownSeconds + 0.2; t += 0.05) { bots.tick(0.05, tid); g.tick(0.05); }
  const K = state.players.get(kid), Tk = state.players.get(tid);
  // the kaiju chases a tank along row 3; a roadblock sits between them
  K.x = 2; K.z = 3; Tk.x = 5.6; Tk.z = 3;
  state.roadblocks.set('4,3', { x: 4, z: 3, hits: T.roadblockHits, slot: 0, rot: Math.PI / 2 });
  for (let t = 0; t < 6 && state.roadblocks.size; t += 0.05) { bots.tick(0.05, tid); g.tick(0.05); }
  assert.equal(state.roadblocks.size, 0, 'bot kaiju smashed the roadblock');
});

test('bots: tanks spread out instead of stacking on one spot', () => {
  const state = plainMake.state();
  let seed = 3; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = createGame({ state, rng });
  const bots = createBots(g, state, rng);
  bots.add('kaiju'); const ids = [bots.add('tank'), bots.add('tank'), bots.add('tank')];
  for (let t = 0; t < T.countdownSeconds + 0.2; t += 0.05) { bots.tick(0.05); g.tick(0.05); }
  const ts = ids.map(i => state.players.get(i));
  ts.forEach(t => { t.x = 0; t.z = 20; });   // all on one tile
  let stacked = 0, samples = 0;
  for (let t = 0; t < 30; t += 0.05) {
    bots.tick(0.05); g.tick(0.05);
    if (t > 10 && Math.round(t * 20) % 20 === 0) {
      samples++;
      const alive = ts.filter(x => x.alive);
      if (alive.length >= 2 && alive.every(a => alive.every(b => Math.hypot(a.x - b.x, a.z - b.z) < 0.6))) stacked++;
    }
  }
  assert.ok(stacked < samples / 2, `stacked in ${stacked}/${samples} samples`);
});

test('king of the hill: round time and winning score scale with the number of players', () => {
  const { g, state, run, K, place } = setup(2, { mode: 'koth' });
  const players = state.players.size;
  assert.equal(players, 3);
  assert.ok(Math.abs(state.clock - (T.kothSecondsPerPlayer * players - 0.1)) < 0.2, `clock ${state.clock}`);
  assert.equal(state.target, T.kothPointsPerPlayer * players);
  // reaching the target ends the round at once
  K.score = state.target - T.buildingPoints.house;
  const house = g.city.owner[4][1];
  state.buildingHp[house] = T.strikeDamage;
  for (const id of ['T0', 'T1']) place(state.players.get(id), 30, 30);
  state.hillX = 30; state.hillZ = 30; state.hillIn = 99;   // keep the zone away from this house
  place(K, 1, 3); K.rot = 0; K.strikeIn = 0;
  g.action('K'); g.tick(0.05);
  assert.equal(state.phase, 'ended');
  assert.equal(state.winner, 'K');
});

test('king of the hill: the zone respawns next to whoever is furthest behind', () => {
  const { g, state, events, run, K, place } = setup(1, { mode: 'koth' });
  const R = state.players.get('T0');
  K.score = 200; R.score = 10;          // R is behind
  place(K, 30, 0); place(R, 0, 30);     // opposite corners
  state.hillIn = 0.01; run(0.05);
  const dR = Math.hypot(state.hillX - R.x, state.hillZ - R.z), dK = Math.hypot(state.hillX - K.x, state.hillZ - K.z);
  assert.ok(dR < dK, `zone near the trailing player (${dR.toFixed(1)} vs ${dK.toFixed(1)})`);
  assert.equal(events.filter(e => e.type === 'hill').pop().near, 'T0');
  K.score = 0;                           // now K is behind
  state.hillIn = 0.01; run(0.05);
  assert.ok(Math.hypot(state.hillX - K.x, state.hillZ - K.z) < Math.hypot(state.hillX - R.x, state.hillZ - R.z));
});
