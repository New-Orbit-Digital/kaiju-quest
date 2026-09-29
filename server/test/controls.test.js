// Mobile controls packet: push-to-smash, tap-to-move routes, phone corner help,
// and the civilians' drawn paths (Evacuation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, plainMake, decodePath } from '../../shared/game.js';
import { TUNING as T } from '../../shared/tuning.js';
import { stepUnit } from '../../shared/sim.js';
import { EXITS } from '../../shared/map.js';

function setup(nTanks = 1, opts = {}) {
  const state = plainMake.state();
  const events = [];
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = createGame({ state, emit: (type, e) => events.push({ type, ...e }), rng });
  if (opts.mode) g.setMode(null, opts.mode);
  g.join('K', { role: 'kaiju', mobile: opts.mobile });
  for (let i = 0; i < nTanks; i++) g.join(`T${i}`, { role: 'tank', mobile: opts.mobile });
  const run = (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.05) g.tick(0.05); };
  for (const id of state.players.keys()) g.setReady(id, true);
  run(T.countdownSeconds + 0.1);
  for (const b of g.city.buildings) state.buildingHp[b.id] = g.maxHpOf(b);
  const place = (p, x, z) => { p.x = x; p.z = z; p.moving = false; };
  const K = state.players.get('K'), T0 = state.players.get('T0');
  place(T0, 0, 30);   // far from the kaiju: no repairs, no shots
  return { g, state, events, run, place, K, T0 };
}
// The tower block north of row 12 at x = 17 (map v2): row 11 is "tt#tt#tt#tt#ii" from x = 10.
const TOWER = { x: 17, z: 11 };
const bidAt = (g, x, z) => g.city.owner[z][x];
const strikes = (events) => events.filter(e => e.type === 'strike' && e.bid >= 0).length;

test('push-to-smash: a push held past smashPushDelay smashes; a shorter one does not', () => {
  const { g, state, events, run, place, K } = setup();
  const bid = bidAt(g, TOWER.x, TOWER.z), hp0 = state.buildingHp[bid];
  place(K, TOWER.x, 12);
  g.input('K', { x: 0, z: -1 });
  run(T.smashPushDelay - 0.1);
  assert.equal(state.buildingHp[bid], hp0, 'no smash before the delay');
  assert.ok(K.windup > 0 && K.windup < 1, `wind-up shows (${K.windup.toFixed(2)})`);
  g.input('K', { x: 0, z: 0 }); run(0.3);
  assert.equal(state.buildingHp[bid], hp0, 'a short push never smashes');
  assert.equal(K.windup, 0, 'wind-up resets on release');
  g.input('K', { x: 0, z: -1 });
  run(T.smashPushDelay + 0.1);
  assert.equal(state.buildingHp[bid], hp0 - T.strikeDamage, 'held push smashed once');
  run(T.strikeCooldown * 2 + 0.3);
  assert.ok(state.buildingHp[bid] <= hp0 - 3 * T.strikeDamage, 'keeps smashing at the strike cooldown while held');
});

test('push-to-smash: running a street with a 30° drift into the buildings never smashes', () => {
  const { g, state, events, run, place, K } = setup();
  const before = [...state.buildingHp];
  place(K, 10, 12);
  const a = 30 * Math.PI / 180;
  g.input('K', { x: Math.cos(a), z: -Math.sin(a) });   // east, leaning north into the towers
  const x0 = K.x, z0 = K.z;
  run(3);
  assert.ok(Math.hypot(K.x - x0, K.z - z0) > 3, `kept moving (${K.x.toFixed(2)}, ${K.z.toFixed(2)})`);
  assert.equal(strikes(events), 0, 'no smash');
  assert.deepEqual(state.buildingHp, before);
});

test('push-to-smash: a push under ~63° off the street is not a push into the building', () => {
  const { g, state, run, place, K } = setup();
  const bid = bidAt(g, TOWER.x, TOWER.z), hp0 = state.buildingHp[bid];
  // 55° off the street: mostly north, but not by 2:1
  place(K, TOWER.x, 12);
  const a = 55 * Math.PI / 180;
  g.input('K', { x: Math.cos(a), z: -Math.sin(a) });
  run(1);
  assert.equal(state.buildingHp[bid], hp0);
});

test('push-to-smash: a brief push beside an opening still nudges round the corner', () => {
  const { g, state, events, run, place, K } = setup();
  place(K, 17.72, 12);                      // the street north opens at x = 18
  g.input('K', { x: 0, z: -1 });
  run(0.6);
  assert.ok(K.z < 11.5, `turned up the side street (z=${K.z.toFixed(2)})`);
  assert.equal(strikes(events), 0, 'no smash');
});

test('push-to-smash: pushing into a roadblock smashes it', () => {
  const { g, state, run, place, K, T0 } = setup();
  place(T0, 20, 12); T0.rot = -Math.PI / 2;  // facing west: drops on (19, 12)
  g.block('T0'); g.tick(0.05);
  place(T0, 0, 30);
  assert.ok(state.roadblocks.has('19,12'));
  const hits = state.roadblocks.get('19,12').hits;
  place(K, 16, 12);
  g.input('K', { x: 1, z: 0 });
  run(2);
  assert.ok(!state.roadblocks.has('19,12') || state.roadblocks.get('19,12').hits < hits, 'roadblock took smashes');
});

test('tap-to-move: a kaiju tapping a building walks beside it and smashes it to rubble', () => {
  const { g, state, run, place, K } = setup();
  const bid = bidAt(g, TOWER.x, TOWER.z);
  place(K, 11, 12);
  assert.ok(g.moveTo('K', TOWER), 'route planned');
  assert.ok(decodePath(K.route).length >= 2, 'route is sent for drawing');
  assert.equal(K.routeBid, bid, 'target building is flagged for the highlight');
  run(2 + Math.ceil(g.maxHpOf(g.city.buildings[bid]) / T.strikeDamage) * (T.strikeCooldown + 0.05) + 1);
  assert.equal(state.buildingHp[bid], 0, 'smashed to rubble');
  assert.equal(K.route, '', 'route cleared');
  assert.equal(K.routeBid, -1);
});

test('tap-to-move: any stick input cancels the route', () => {
  const { g, run, place, K } = setup();
  place(K, 11, 12);
  g.moveTo('K', { x: 22, z: 12 });
  run(0.3);
  assert.notEqual(K.route, '');
  g.input('K', { x: 0, z: 1 });
  assert.equal(K.route, '', 'cancelled');
});

test('tap-to-move: routes go along streets and arrive; a tank tapping a building parks beside it', () => {
  const { g, state, run, place, K, T0 } = setup();
  place(K, 11, 30); place(T0, 11, 12);
  g.moveTo('T0', { x: 22, z: 12 });
  run(6);
  assert.ok(Math.abs(T0.x - 22) < 0.3 && Math.abs(T0.z - 12) < 0.3, `tank arrived (${T0.x.toFixed(2)}, ${T0.z.toFixed(2)})`);
  assert.equal(T0.route, '', 'route cleared on arrival');
  g.moveTo('T0', TOWER);
  const path = decodePath(T0.route), end = path[path.length - 1];
  assert.equal(g.city.tiles[end.z][end.x], '#', 'ends on a street tile');
  assert.ok(Math.abs(end.x - TOWER.x) + Math.abs(end.z - TOWER.z) <= 2, 'beside the tower block');
  run(5);
  assert.equal(state.buildingHp[bidAt(g, TOWER.x, TOWER.z)], g.maxHpOf(g.city.buildings[bidAt(g, TOWER.x, TOWER.z)]), 'tanks never smash');
});

test('tap-to-move: a tank tapping rubble goes to the nearest tile it can stand on', () => {
  const { g, state, place, T0 } = setup();
  const bid = bidAt(g, TOWER.x, TOWER.z);
  state.buildingHp[bid] = 0;   // rubble
  place(T0, 11, 12);
  assert.ok(g.moveTo('T0', TOWER));
  const path = decodePath(T0.route), end = path[path.length - 1];
  assert.equal(g.city.tiles[end.z][end.x], '#');
});

test('phones get more corner help (lookahead) than desktop', () => {
  const { g } = setup();
  const city = g.city;
  // rolling east on row 12, pushing north 1.4 tiles before the x = 18 opening
  // (a turn lines up once the lookahead point rounds onto the opening's tile)
  const unit = () => ({ role: 'tank', x: 16.6, z: 12, rot: Math.PI / 2, moving: true });
  const desk = unit(), phone = unit();
  for (let i = 0; i < 20; i++) {
    stepUnit(city, desk, { x: 0, z: -1 }, 0.05, 2.8, T.tankRadius, () => false);
    stepUnit(city, phone, { x: 0, z: -1 }, 0.05, 2.8, T.tankRadius, () => false, null,
      { lookahead: T.mobileCornerLookahead, nudge: T.mobileCornerNudge });
  }
  assert.ok(phone.z < 11.2, `phone turned up the side street (z=${phone.z.toFixed(2)})`);
  assert.ok(desk.z > 11.5, `desktop stopped at the wall (z=${desk.z.toFixed(2)})`);
});

test('evacuation: every civilian carries its planned path, ending at its farthest exit', () => {
  const { state, run } = setup(1, { mode: 'evac' });
  run(T.civilianSpawnSeconds * 3 + 0.5);
  assert.ok(state.civilians.size >= 2);
  for (const c of state.civilians.values()) {
    const path = decodePath(c.path);
    assert.ok(path.length >= 2, 'has a path');
    const end = path[path.length - 1];
    assert.ok(EXITS.some(e => e.x === end.x && e.z === end.z), 'ends at an exit');
  }
});

test('king of the hill: kaiju collide instead of walking through each other, and pushing into one hits it', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.setMode(null, 'koth');
  g.join('A', {}); g.join('B', {});
  for (const id of state.players.keys()) g.setReady(id, true);
  const run = (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.05) g.tick(0.05); };
  run(T.countdownSeconds + 0.1);
  assert.equal(state.phase, 'playing');
  const A = state.players.get('A'), B = state.players.get('B');
  A.x = 12; A.z = 12; B.x = 16; B.z = 12;                // same street (row 12), facing each other
  g.input('A', { x: 1, z: 0 }); g.input('B', { x: -1, z: 0 });
  let closest = Infinity;
  for (let i = 0; i < 40; i++) { g.tick(0.05); closest = Math.min(closest, Math.hypot(A.x - B.x, A.z - B.z)); }
  assert.ok(closest >= 2 * T.kaijuRadius - 1e-6, `never overlapped (closest ${closest.toFixed(3)})`);
  assert.ok(A.x < B.x, 'nobody passed through');
  assert.ok(A.hp < T.kothHp && B.hp < T.kothHp, `both pushing → both hit (A ${A.hp}, B ${B.hp})`);
  // a kaiju that's down can be walked over
  B.alive = false; B.x = A.x + 1; B.z = 12;
  const ax = A.x; run(0.6);
  assert.ok(A.x > ax + 1, 'walks over a knocked-out kaiju');
});
