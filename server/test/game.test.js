import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, plainMake, inKaijuView } from '../../shared/game.js';
import { TUNING as T, kaijuMaxHpFor, kaijuSpeedFor } from '../../shared/tuning.js';
import { tileWalkable } from '../../shared/sim.js';

// Helper: a game with a kaiju + n tanks, already in the 'playing' phase.
function setup(nTanks = 1, opts = {}) {
  const state = plainMake.state();
  const events = [];
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = createGame({ state, emit: (type, e) => events.push({ type, ...e }), rng });
  g.join('K', { role: 'kaiju' });
  for (let i = 0; i < nTanks; i++) g.join(`T${i}`, { role: 'tank', ...opts });
  const run = (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.05) g.tick(0.05); };
  if (!opts.noStart) run(T.countdownSeconds + 0.1);
  const place = (p, x, z) => g.teleport([...state.players].find(([, v]) => v === p)[0], x, z);
  return { g, state, events, run, place, K: state.players.get('K'), T0: state.players.get('T0') };
}

test('round starts after the countdown, with HP scaled to tank count', () => {
  const { state, place } = setup(3);
  assert.equal(state.phase, 'playing');
  assert.equal(state.kaijuMaxHp, kaijuMaxHpFor(3));
  assert.equal(state.kaijuHp, 300);
  assert.ok(Math.abs(state.kaijuSpeed - kaijuSpeedFor(3)) < 1e-9);
});

test('waiting: no countdown without both a kaiju and a tank', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('K', {});
  for (let i = 0; i < 100; i++) g.tick(0.05);
  assert.equal(state.phase, 'waiting');
});

test('phones always get a tank, even when first to join', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  assert.equal(g.join('P', { mobile: true, role: 'kaiju' }), 'tank');
  assert.equal(g.join('D', {}), 'kaiju');
});

test('SPACE strike: damage is permanent building HP; destroyed → rubble + points', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  place(T0, 24, 24);                 // keep the tank out of range
  place(K, 1, 3); K.rot = 0;         // street tile; house at (1,4) to the south
  const bid = g.city.owner[4][1];
  const hp0 = state.buildingHp[bid];
  g.action('K'); g.tick(0.05);
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage);
  // cooldown: an immediate second press does nothing
  g.action('K'); g.tick(0.05);
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage);
  // walk away and come back: damage stays
  g.input('K', { x: 1, z: 0 }); run(1); g.input('K', { x: -1, z: 0 }); run(1.2); g.input('K', { x: 0, z: 0 });
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage);
  place(K, 1, 3); K.rot = 0;
  const needed = Math.ceil(hp0 / T.strikeDamage) - 1;
  for (let i = 0; i < needed; i++) { run(T.strikeCooldown + 0.05); g.action('K'); g.tick(0.05); }
  assert.equal(state.buildingHp[bid], 0);
  assert.equal(state.kaijuScore, T.buildingPoints.house);
  assert.ok(events.some(e => e.type === 'destroyed' && e.bid === bid));
  assert.equal(tileWalkable(g.city, 'kaiju', 1, 4, g.destroyed), true);
  assert.equal(tileWalkable(g.city, 'tank', 1, 4, g.destroyed), false);
});

test('strikeRange: 1 reaches only the building beside the kaiju; 2 reaches further', () => {
  const { g, state, K, T0, place } = setup(1);
  place(T0, 24, 24);
  place(K, 12, 12);                   // crossroad: no building touches this tile
  const total = () => state.buildingHp.reduce((a, b) => a + b, 0);
  const before = total();
  g.action('K'); g.tick(0.05);
  assert.equal(total(), before, 'nothing within 1 tile of a crossroad centre');
  T.strikeRange = 1.5;                // diagonals: the towers around (12,12)
  g.tick(T.strikeCooldown + 0.05); g.action('K'); g.tick(0.05);
  assert.equal(total(), before - T.strikeDamage);
  T.strikeRange = 1;
});

test('picking KAIJU takes the seat from an idle kaiju, not an active one', () => {
  const { g, state, run } = setup(1);
  g.input('K', { x: 1, z: 0 });            // active kaiju
  assert.equal(g.join('D', { role: 'kaiju' }), 'tank', 'active kaiju keeps the seat');
  g.leave('D');
  g.input('K', { x: 0, z: 0 });
  run(T.kaijuIdleTakeover + 0.5);          // kaiju goes idle
  assert.equal(g.join('D', { role: 'kaiju' }), 'kaiju');
  assert.equal(state.players.get('K').role, 'tank', 'idle kaiju became a tank');
  assert.equal(g.join('P', { role: 'kaiju', mobile: true }), 'tank', 'phones never take the kaiju');
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

test('tank auto-fires only in range', () => {
  const { state, run, K, T0, place } = setup(1);
  place(K, 12, 12);
  place(T0, 24, 24);                     // far away
  run(3);
  assert.equal(state.kaijuHp, state.kaijuMaxHp);
  place(T0, 12, 12 + T.tankRange - 1);   // in range, same column (street)
  for (const s of T0.soldiers) s.alive = false;  // tank only
  run(T.tankFireInterval * 3 + 0.01);
  const lost = state.kaijuMaxHp - state.kaijuHp;
  assert.ok(lost >= T.tankDamage * 3, `lost ${lost}`);
});

test('soldiers shoot the kaiju for small damage when in range', () => {
  const { state, run, K, T0, place } = setup(1);
  place(K, 12, 12); place(T0, 24, 24);
  T0.soldiers.forEach((s) => { s.x = 12; s.z = 12 + T.soldierRange - 0.5; });
  run(T.soldierFireInterval * 1.2);
  const lost = state.kaijuMaxHp - state.kaijuHp;
  assert.ok(lost >= T.soldierDamage * 4 - 1e-9 && lost < T.tankDamage * 2, `lost ${lost}`);
});

test('boost: speed burst with a 15s cooldown', () => {
  const { g, run, T0, K, place } = setup(1);
  place(K, 24, 12); place(T0, 0, 3);
  g.input('T0', { x: 1, z: 0 });
  g.action('T0'); g.tick(0.05);
  assert.equal(T0.boosting, true);
  assert.equal(T0.boostIn, T.boostCooldown);
  run(T.boostSeconds + 0.1);
  assert.equal(T0.boosting, false);
  g.action('T0'); g.tick(0.05);
  assert.equal(T0.boosting, false, 'still cooling down');
});

test('stomp: kaiju kills tank + squad instantly for points; tank respawns away and out of view', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  place(K, 12, 12);
  place(T0, 12, 12.3);
  g.tick(0.05);
  assert.equal(T0.alive, false);
  assert.equal(state.kaijuScore, T.pointsTankKill);
  assert.ok(T0.soldiers.every(s => !s.alive));
  run(T.tankRespawnSeconds + 0.1);
  assert.equal(T0.alive, true);
  assert.ok(Math.hypot(T0.x - K.x, T0.z - K.z) >= T.respawnMinDistance);
  assert.equal(inKaijuView(K, T0), false);
  assert.ok(T0.soldiers.every(s => s.alive));
  assert.ok(events.some(e => e.type === 'respawn'));
});

test('stomp: walking into soldiers kills them for points', () => {
  const { state, g, K, T0, place } = setup(1);
  place(T0, 0, 3); place(K, 6, 3);
  const s = T0.soldiers[0];
  s.x = 6; s.z = 3.2; s.alive = true;
  g.tick(0.05);
  assert.equal(s.alive, false);
  assert.equal(state.kaijuScore, T.pointsSoldierKill);
});

test('soldiers follow their tank along the street', () => {
  const { g, run, T0, K, place } = setup(1);
  place(K, 24, 12);
  g.input('T0', { x: 0, z: 1 });      // drive south down column 0
  run(1.5);
  for (const s of T0.soldiers) {
    assert.ok(Math.hypot(s.x - T0.x, s.z - T0.z) < 1.5, 'stays close');
    assert.ok(s.z < T0.z, 'walks behind');
    assert.ok(tileWalkable(g.city, 'tank', Math.round(s.x), Math.round(s.z)), 'on the street');
  }
});

test('win conditions: kaiju HP 0 → tanks win; timer 0 → kaiju wins', () => {
  const a = setup(1);
  a.state.kaijuHp = 1; a.place(a.K, 12, 12); a.place(a.T0, 12, 15);
  a.run(T.tankFireInterval + 0.1);
  assert.equal(a.state.phase, 'ended'); assert.equal(a.state.winner, 'tanks');

  const b = setup(1);
  b.place(b.T0, 24, 24); b.place(b.K, 12, 12);
  b.state.clock = 0.1; b.run(0.2);
  assert.equal(b.state.phase, 'ended'); assert.equal(b.state.winner, 'kaiju');
});

test('next round resets buildings, score and positions', () => {
  const { g, state, run, K, T0, place } = setup(1);
  const bid = g.city.owner[4][1];
  state.buildingHp[bid] = 0; state.kaijuScore = 99; place(T0, 24, 24);
  state.clock = 0.05; run(0.1);
  assert.equal(state.phase, 'ended');
  run(T.endScreenSeconds + T.countdownSeconds + 0.2);
  assert.equal(state.phase, 'playing');
  assert.equal(state.buildingHp[bid], T.buildingHp.house);
  assert.equal(state.kaijuScore, 0);
  assert.equal(K.x, 12); assert.equal(K.z, 12);
});

test('a tank joining mid-round adds kaiju HP and speed', () => {
  const { g, state, place } = setup(1);
  state.kaijuHp -= 30;
  g.join('T1', { role: 'tank' });
  assert.equal(state.kaijuMaxHp, 200);
  assert.equal(state.kaijuHp, 170);
  assert.ok(Math.abs(state.kaijuSpeed - kaijuSpeedFor(2)) < 1e-9);
  const t1 = state.players.get('T1');
  assert.ok(Math.hypot(t1.x - 12, t1.z - 12) >= T.respawnMinDistance, 'joins away from the kaiju');
});
