import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCity, SPAWNS, isStreet } from '../../shared/map.js';
import { stepUnit, tileWalkable, spotClear } from '../../shared/sim.js';
import { TUNING, kaijuSpeedFor, kaijuMaxHpFor } from '../../shared/tuning.js';

const city = parseCity();
const run = (unit, input, seconds, speed, r, destroyed) => {
  for (let t = 0; t < seconds; t += 0.05) stepUnit(city, unit, input, 0.05, speed, r, destroyed);
  return unit;
};

test('map parses: 31×31, towers are 2×2, every lot touches a street', () => {
  assert.equal(city.width, 31); assert.equal(city.depth, 31);
  const towers = city.buildings.filter(b => b.kind === 'tower');
  assert.equal(towers.length, 11);
  for (const t of towers) assert.equal(t.cells.length, 4);
  for (const b of city.buildings) {
    if (b.kind === 'park') continue;
    const touches = b.cells.some(([x, z]) =>
      [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dz]) => isStreet(city, x + dx, z + dz)));
    assert.ok(touches, `building ${b.id} (${b.kind}) at ${b.x},${b.z} is landlocked`);
  }
});

test('every street is connected to every other street', () => {
  const key = (x, z) => `${x},${z}`;
  const all = [];
  for (let z = 0; z < city.depth; z++) for (let x = 0; x < city.width; x++) if (isStreet(city, x, z)) all.push(key(x, z));
  const seen = new Set([key(0, 0)]), q = [[0, 0]];
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (isStreet(city, x + dx, z + dz) && !seen.has(key(x + dx, z + dz))) { seen.add(key(x + dx, z + dz)); q.push([x + dx, z + dz]); }
    }
  }
  assert.equal(seen.size, all.length);
});

test('spawns are on streets', () => {
  assert.ok(isStreet(city, SPAWNS.kaiju.x, SPAWNS.kaiju.z));
  for (const s of SPAWNS.tanks) assert.ok(isStreet(city, s.x, s.z));
});

test('kaiju walks along a street', () => {
  const u = run({ role: 'kaiju', x: 15, z: 12, rot: 0 }, { x: 1, z: 0 }, 1, 3, TUNING.kaijuRadius);
  assert.ok(Math.abs(u.x - 18) < 0.01, `x=${u.x}`);
  assert.equal(u.z, 12);
});

test('buildings block the kaiju and tanks', () => {
  // from (12,3) going south: z=4 at x=12? column 12 is a street; use x=1: (1,3) south is house at (1,4)
  const edge = 3.5 + TUNING.streetWiden; // the house lot's wall, pulled back by the widening
  const k = run({ role: 'kaiju', x: 1, z: 3, rot: 0 }, { x: 0, z: 1 }, 1, 3, TUNING.kaijuRadius);
  assert.ok(k.z <= edge - TUNING.kaijuRadius + 0.01, `kaiju went into a house: z=${k.z}`);
  const t = run({ role: 'tank', x: 1, z: 3, rot: 0 }, { x: 0, z: 1 }, 1, 3, TUNING.tankRadius);
  assert.ok(t.z <= edge - TUNING.tankRadius + 0.01, `tank went into a house: z=${t.z}`);
});

test('rubble: kaiju may cross, tanks may not', () => {
  const id = city.owner[4][1];
  const destroyed = (b) => b === id;
  assert.equal(tileWalkable(city, 'kaiju', 1, 4, destroyed), true);
  assert.equal(tileWalkable(city, 'tank', 1, 4, destroyed), false);
  const k = run({ role: 'kaiju', x: 1, z: 3, rot: 0 }, { x: 0, z: 1 }, 0.5, 3, TUNING.kaijuRadius, destroyed);
  assert.ok(k.z > 3.5, `kaiju should enter rubble: z=${k.z}`);
});

test('lane assist: an off-centre kaiju still turns a corner', () => {
  // at intersection (12,12) but 0.3 off-centre in z, heading east
  const u = run({ role: 'kaiju', x: 12, z: 12.15, rot: 0 }, { x: 1, z: 0 }, 1, 3, TUNING.kaijuRadius);
  assert.ok(u.x > 14, `stuck at x=${u.x}`);
  assert.ok(Math.abs(u.z - 12) < 0.01);
});


test('streets are wider than one tile (streetWiden)', () => {
  // a tank on row 3 can sit off-centre by more than a 1-tile street would allow
  const off = 0.5 + TUNING.streetWiden - TUNING.tankRadius - 0.02;
  assert.ok(off > 0.25);
  assert.ok(spotClear(city, 'tank', 2, 3 + off, TUNING.tankRadius));
  assert.ok(!spotClear(city, 'tank', 2, 3 + off + 0.05, TUNING.tankRadius));
});

test('early turn: steering into a side street just before it still takes the turn', () => {
  // tank rolling east on row 3; column 5 is a street going south.
  const u = { role: 'tank', x: 4.3, z: 3, rot: Math.PI / 2, moving: true };
  for (let t = 0; t < 1.5; t += 0.05) u.moving = stepUnit(city, u, { x: 0, z: 1 }, 0.05, 2, TUNING.tankRadius) || u.moving;
  assert.ok(Math.abs(u.x - 5) < 0.02, `should have turned at x=5, x=${u.x}`);
  assert.ok(u.z > 4, `should be heading south, z=${u.z}`);
});

test('corner nudge: pushing into a wall beside an opening slides into it', () => {
  // standing on row 3 at x=5.3, pushing south: column 5 is open
  const u = { role: 'tank', x: 5.3, z: 3, rot: 0, moving: false };
  run(u, { x: 0, z: 1 }, 1, 2, TUNING.tankRadius);
  assert.ok(u.z > 4, `should slip into the side street, z=${u.z}`);
});

test('no early turn into a wall with no opening nearby', () => {
  // rolling east on row 3 at x=2, steering north: x=1-4 on rows 1-2 is houses
  const u = { role: 'tank', x: 2, z: 3, rot: Math.PI / 2, moving: true };
  stepUnit(city, u, { x: 0, z: -1 }, 0.05, 2, TUNING.tankRadius);
  assert.ok(Math.abs(u.x - 2) < 1e-9, `drove on without an opening in reach, x=${u.x}`);
});

test('parks: tanks and the kaiju can cross the trees, at parkSpeed', () => {
  // downtown plaza: park tiles x13-17 on row 14; column 12 is a street
  assert.equal(tileWalkable(city, 'tank', 14, 14), true);
  assert.equal(tileWalkable(city, 'kaiju', 14, 14), true);
  const street = run({ role: 'tank', x: 12, z: 3, rot: 0 }, { x: 1, z: 0 }, 0.5, 2, TUNING.tankRadius);
  const park = run({ role: 'tank', x: 14, z: 14, rot: 0 }, { x: 1, z: 0 }, 0.5, 2, TUNING.tankRadius);
  const ratio = (park.x - 14) / (street.x - 12);
  assert.ok(Math.abs(ratio - TUNING.parkSpeed) < 0.02, `park speed ratio ${ratio.toFixed(3)}`);
  const k = run({ role: 'kaiju', x: 12, z: 14, rot: 0 }, { x: 1, z: 0 }, 4, 3, TUNING.kaijuRadius);
  assert.ok(k.x > 17, `kaiju crossed the plaza: x=${k.x.toFixed(2)}`);
});
