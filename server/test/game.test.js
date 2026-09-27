import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, plainMake, inKaijuView, MODES } from '../../shared/game.js';
import { TUNING as T, kaijuMaxHpFor, kaijuSpeedFor, boostMultiplierAt } from '../../shared/tuning.js';
import { tileWalkable } from '../../shared/sim.js';
import { createBots } from '../../shared/bots.js';
import { SPAWNS, EXITS } from '../../shared/map.js';

// Helper: a game with a kaiju + n tanks, already in the 'playing' phase.
function setup(nTanks = 1, opts = {}) {
  const state = plainMake.state();
  const events = [];
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = createGame({ state, emit: (type, e) => events.push({ type, ...e }), rng });
  g.join('K', { role: 'kaiju' });
  for (let i = 0; i < nTanks; i++) g.join(`T${i}`, { role: 'tank', ...opts });
  if (opts.mode) g.setMode('K', opts.mode);
  const run = (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.05) g.tick(0.05); };
  if (!opts.noStart) { for (const id of state.players.keys()) g.setReady(id, true); run(T.countdownSeconds + 0.1); }
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
  // AFK kaiju: someone else can claim the seat
  const s2 = plainMake.state(); const g2 = createGame({ state: s2 });
  g2.join('OldK', {}); g2.join('T', {});
  for (let t = 0; t < T.afkSeconds + 0.5; t += 0.05) { g2.input('T', { x: 0.01, z: 0 }); g2.tick(0.05); }
  assert.equal(g2.setRole('T', 'kaiju'), true);
  assert.equal(s2.players.get('T').role, 'kaiju');
  assert.equal(s2.players.get('OldK').role, 'tank');
});

test('lobby: roles swap only when the seat is free; phones stay tanks; names are cleaned', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  g.join('K', { name: '  <b>Ka iju</b>  ' }); g.join('A', {}); g.join('P', { mobile: true });
  assert.equal(state.players.get('K').name, 'bKa ijub');
  assert.equal(g.setRole('A', 'kaiju'), false, 'active kaiju keeps the seat');
  assert.equal(g.setRole('P', 'kaiju'), false, 'phones cannot be the kaiju');
  assert.equal(g.setRole('K', 'tank'), true);
  assert.equal(g.setRole('A', 'kaiju'), true, 'free seat can be taken');
  assert.equal(state.players.get('A').role, 'kaiju');
  g.setName('A', 'Ana'); assert.equal(state.players.get('A').name, 'Ana');
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
  g.input('K', { x: 1, z: 0 }); g.tick(0.05);  // active kaiju
  assert.equal(g.join('D', { role: 'kaiju' }), 'tank', 'active kaiju keeps the seat');
  g.leave('D');
  g.input('K', { x: 0, z: 0 });
  run(T.afkSeconds + 0.5);                 // kaiju goes AFK
  assert.equal(g.join('D', { role: 'kaiju' }), 'kaiju');
  assert.equal(state.players.get('K').role, 'tank', 'idle kaiju became a tank');
  assert.equal(g.join('P', { role: 'kaiju', mobile: true }), 'tank', 'phones never take the kaiju');
});

test('repair: a tank near a damaged building restores it; destroyed ones stay rubble', () => {
  const { g, state, run, K, T0, place } = setup(1);
  place(K, 24, 12);
  const house = g.city.owner[4][1], house2 = g.city.owner[4][2];
  state.buildingHp[house] = 5; state.buildingHp[house2] = 0;
  place(T0, 1, 3);                       // street beside both houses
  run(1);
  assert.ok(Math.abs(state.buildingHp[house] - (5 + T.repairPerSecond)) < 0.3, `repaired to ${state.buildingHp[house]}`);
  run(20);
  assert.equal(state.buildingHp[house], T.buildingHp.house, 'capped at full HP');
  assert.equal(state.buildingHp[house2], 0, 'destroyed buildings are not repaired');
});

test('roadblocks: drop behind the tank, block only the kaiju, 2 smashes to break, cooldown + cap', () => {
  const { g, state, run, K, T0, place } = setup(1);
  place(K, 24, 12);
  place(T0, 6, 3);
  g.input('T0', { x: 1, z: 0 }); g.tick(0.05); g.input('T0', { x: 0, z: 0 }); // face east
  const tx = Math.round(T0.x) - 1;
  g.block('T0'); g.tick(0.05);
  assert.ok(state.roadblocks.has(`${tx},3`), 'dropped on the tile behind (west)');
  assert.equal(state.roadblocks.get(`${tx},3`).rot, Math.PI / 2, 'barrier turned across the east–west road');
  assert.equal(T0.blockIn > T.roadblockCooldown - 0.2, true);
  g.block('T0'); g.tick(0.05);
  assert.equal(state.roadblocks.size, 1, 'cooldown');
  // kaiju walking east along row 3 is stopped by it
  place(K, tx - 2, 3); K.rot = Math.PI / 2;
  g.input('K', { x: 1, z: 0 }); run(1.5); g.input('K', { x: 0, z: 0 });
  assert.ok(K.x < tx - 0.5, `kaiju blocked at x=${K.x.toFixed(2)}`);
  assert.equal(g.blocked(tx, 3), true);
  // tanks drive straight through
  const t0x = T0.x;
  g.input('T0', { x: -1, z: 0 }); run(0.8); g.input('T0', { x: 0, z: 0 });
  assert.ok(T0.x < tx, 'tank passed through its own roadblock');
  // two smashes break it
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
  run(T.tankFireInterval * 3 + 0.01);
  const lost = state.kaijuMaxHp - state.kaijuHp;
  assert.ok(lost >= T.tankDamage * 3, `lost ${lost}`);
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
  const boosted = K.x - x0, normal = kaijuSpeedFor(1) * 1.0;
  assert.ok(boosted > normal * 2, `1 s of boost covered ${boosted.toFixed(2)} tiles vs ${normal.toFixed(2)} walking`);
  assert.ok(Math.abs(boostMultiplierAt(T.boostRampSeconds) - T.boostPeak) < 1e-9);
  assert.equal(boostMultiplierAt(T.boostSeconds), 1);
  assert.ok(boostMultiplierAt(1) > boostMultiplierAt(2), 'eases down');
  run(T.boostSeconds);
  assert.equal(K.boosting, false);
  g.boost('K'); g.tick(0.05);
  assert.equal(K.boosting, false, 'still cooling down');
});

test('tanks have no boost: action does nothing for a tank', () => {
  const { g, T0, K, place } = setup(1);
  place(K, 30, 30); place(T0, 0, 3);
  g.action('T0'); g.tick(0.05);
  assert.equal(T0.boosting, false);
  assert.equal(T0.boostIn, 0);
});

test('line of sight: a building between tank and kaiju takes the shell, no damage', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  // kaiju on row 3, tank on row 6 at the same x: the NW house block (rows 4-5) is between them
  place(K, 2, 3); place(T0, 2, 6);
  assert.equal(g.canSee(T0, K), false);
  run(T.tankFireInterval * 2);
  assert.equal(state.kaijuHp, state.kaijuMaxHp, 'no damage through a building');
  const blockedShot = events.find(e => e.type === 'shot' && e.blocked);
  assert.ok(blockedShot && blockedShot.z > 3.5 && blockedShot.z < 5.5, 'shell stops at the building');
  // same street: clear shot
  place(T0, 5, 3);
  assert.equal(g.canSee(T0, K), true);
  run(T.tankFireInterval + 0.05);
  assert.ok(state.kaijuHp < state.kaijuMaxHp);
  // rubble doesn't block
  const bid = g.city.owner[4][2];
  state.buildingHp[bid] = 0; state.buildingHp[g.city.owner[5][2]] = 0;
  place(T0, 2, 6);
  assert.equal(g.canSee(T0, K), true);
});

test('stomp: kaiju kills a tank instantly for points; tank respawns away and out of view', () => {
  const { g, state, events, run, K, T0, place } = setup(1);
  place(K, 12, 12);
  place(T0, 12, 12.3);
  g.tick(0.05);
  assert.equal(T0.alive, false);
  assert.equal(state.kaijuScore, T.pointsTankKill);
  run(T.tankRespawnSeconds + 0.1);
  assert.equal(T0.alive, true);
  assert.ok(Math.hypot(T0.x - K.x, T0.z - K.z) >= T.respawnMinDistance);
  assert.equal(inKaijuView(K, T0), false);
  assert.ok(events.some(e => e.type === 'respawn'));
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
  assert.equal(K.x, SPAWNS.kaiju.x); assert.equal(K.z, SPAWNS.kaiju.z);
});

test('a tank joining mid-round adds kaiju HP and speed', () => {
  const { g, state, place } = setup(1);
  state.kaijuHp -= 30;
  g.join('T1', { role: 'tank' });
  assert.equal(state.kaijuMaxHp, 200);
  assert.equal(state.kaijuHp, 170);
  assert.ok(Math.abs(state.kaijuSpeed - kaijuSpeedFor(2)) < 1e-9);
  const t1 = state.players.get('T1');
  assert.ok(Math.hypot(t1.x - SPAWNS.kaiju.x, t1.z - SPAWNS.kaiju.z) >= T.respawnMinDistance, 'joins away from the kaiju');
});

test('bots: a bot kaiju smashes buildings and bot tanks close in and fire', () => {
  const state = plainMake.state();
  let seed = 7; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const events = [];
  const g = createGame({ state, rng, emit: (type, e) => events.push({ type, ...e }) });
  const bots = createBots(g, state);
  assert.ok(bots.add('kaiju'));
  assert.equal(bots.add('kaiju'), null, 'only one kaiju');
  bots.add('tank'); bots.add('tank');
  for (let t = 0; t < 70 && state.phase !== 'ended'; t += 0.05) { bots.tick(0.05); g.tick(0.05); }
  assert.ok(events.some(e => e.type === 'start'), 'bots ready up on their own');
  const strikes = events.filter(e => e.type === 'strike' && e.bid >= 0).length;
  const shots = events.filter(e => e.type === 'shot' && !e.blocked).length;
  assert.ok(strikes >= 5, `bot kaiju smashed ${strikes} times`);
  assert.ok(shots >= 5, `bot tanks fired ${shots} times`);
  assert.ok(state.kaijuHp < state.kaijuMaxHp);
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

test('no soldiers: tanks alone fire tankDamage per shot', () => {
  const { state, run, K, T0, place } = setup(1);
  assert.equal(T.tankDamage, 8);
  assert.equal(T0.soldiers, undefined);
  place(K, 12, 12); place(T0, 12, 15);
  run(T.tankFireInterval * 0.5);
  assert.equal(state.kaijuMaxHp - state.kaijuHp, T.tankDamage);
});

test('modes: default is free for all; picked in the lobby or on the end screen only', () => {
  const state = plainMake.state();
  const g = createGame({ state });
  assert.equal(state.mode, T.defaultMode);
  g.join('K', { role: 'kaiju' });
  assert.equal(g.setMode('K', 'koth'), true); assert.equal(state.mode, 'koth');
  assert.equal(g.setMode('K', 'nope'), false);
  const a = setup(1);
  assert.equal(a.g.setMode('K', 'evac'), false, 'not mid-round');
  a.state.clock = 0.05; a.run(0.1);
  assert.equal(a.state.phase, 'ended');
  assert.equal(a.g.setMode('K', 'evac'), true, 'allowed on the end screen');
  assert.deepEqual(MODES, ['ffa', 'koth', 'evac']);
});

test('king of the hill: the hill moves on its timer and multiplies smash points inside it', () => {
  const { g, state, events, run, K, T0, place } = setup(1, { mode: 'koth' });
  assert.equal(state.mode, 'koth');
  const first = { x: state.hillX, z: state.hillZ };
  assert.ok(events.some(e => e.type === 'hill'));
  // the hill needs standing buildings around it
  const around = g.city.buildings.filter(b => b.kind !== 'park' && Math.hypot(b.cx - first.x, b.cz - first.z) <= T.hillRadius);
  assert.ok(around.length >= T.hillMinBuildings, `${around.length} buildings in the hill`);
  // smash a house inside the hill → points × multiplier
  const house = around.find(b => b.kind === 'house') || around[0];
  state.buildingHp[house.id] = T.strikeDamage;
  const [sx, sz] = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx, dz]) => [house.x + dx, house.z + dz]).find(([x, z]) => g.city.tiles[z]?.[x] === '#');
  place(K, sx, sz); K.rot = Math.atan2(house.x - sx, house.z - sz);
  const before = state.kaijuScore;
  g.action('K'); g.tick(0.05);
  assert.equal(state.buildingHp[house.id], 0);
  assert.equal(state.kaijuScore - before, T.buildingPoints[house.kind] * T.hillMultiplier);
  place(T0, Math.abs(sx - 30) > 15 ? 30 : 0, Math.abs(sz - 30) > 15 ? 30 : 0);   // out of firing range
  run(T.hillMoveSeconds + 0.1);
  assert.ok(state.hillX !== first.x || state.hillZ !== first.z, 'hill moved');
  assert.ok(Math.hypot(state.hillX - first.x, state.hillZ - first.z) >= T.hillRadius * 2);
});

test('evacuation: civilians spawn, walk to an exit and count toward the tanks\' goal', () => {
  const { g, state, events, run, K, T0, place } = setup(1, { mode: 'evac' });
  place(K, 15, 12); place(T0, 12, 20);
  g.tick(0.05);
  assert.equal(state.civilians.size, 1, 'first civilian steps out at once');
  // park the kaiju in a corner so nobody gets stomped, then let them walk
  place(K, 30, 30);
  run(40);
  assert.ok(state.evacuated > 0, `evacuated ${state.evacuated}`);
  assert.ok(events.some(e => e.type === 'escaped'));
  state.civilians.forEach(c => assert.ok(g.city.tiles[Math.round(c.z)][Math.round(c.x)] === '#', 'civilians stay on streets'));
  // reaching the goal ends the round for the tanks
  state.evacuated = T.evacGoal - 1;
  const [id, c] = [...state.civilians][0];
  const e = EXITS[0]; c.x = e.x; c.z = e.z;
  g.tick(0.05);
  assert.equal(state.phase, 'ended'); assert.equal(state.winner, 'tanks');
});

test('evacuation: the kaiju stomps civilians for points', () => {
  const { g, state, K, T0, place } = setup(1, { mode: 'evac' });
  place(T0, 0, 30);
  g.tick(0.05);
  const [, c] = [...state.civilians][0];
  place(K, Math.round(c.x), Math.round(c.z));
  const before = state.kaijuScore, n = state.civilians.size;
  g.tick(0.05);
  assert.equal(state.kaijuScore - before, T.pointsCivilian);
  assert.ok(state.civilians.size < n + 1);
});

test('repairing flag is set only while a tank is fixing a building', () => {
  const { g, state, run, K, T0, place } = setup(1);
  place(K, 30, 30); place(T0, 1, 3);
  const bid = g.city.owner[4][1];
  g.tick(0.05);
  assert.equal(T0.repairing, false);
  state.buildingHp[bid] = 5;
  g.tick(0.05);
  assert.equal(T0.repairing, true);
  state.buildingHp[bid] = T.buildingHp.house; g.tick(0.05);
  assert.equal(T0.repairing, false);
});
