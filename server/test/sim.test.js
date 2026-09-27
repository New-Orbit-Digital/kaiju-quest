import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCity, SPAWNS, isStreet } from '../../shared/map.js';
import { stepUnit, tileWalkable } from '../../shared/sim.js';
import { TUNING, kaijuSpeedFor, kaijuMaxHpFor } from '../../shared/tuning.js';

const city = parseCity();
const run = (unit, input, seconds, speed, r, destroyed) => {
  for (let t = 0; t < seconds; t += 0.05) stepUnit(city, unit, input, 0.05, speed, r, destroyed);
  return unit;
};

test('map parses: 25×25, towers are 2×2, every lot touches a street', () => {
  assert.equal(city.width, 25); assert.equal(city.depth, 25);
  const towers = city.buildings.filter(b => b.kind === 'tower');
  assert.equal(towers.length, 4);
  for (const t of towers) assert.equal(t.cells.length, 4);
  for (const b of city.buildings) {
    if (b.kind === 'park') continue;
    const touches = b.cells.some(([x, z]) =>
      [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dz]) => isStreet(city, x + dx, z + dz)));
    assert.ok(touches, `building ${b.id} (${b.kind}) at ${b.x},${b.z} is landlocked`);
  }
});

test('spawns are on streets', () => {
  assert.ok(isStreet(city, SPAWNS.kaiju.x, SPAWNS.kaiju.z));
  for (const s of SPAWNS.tanks) assert.ok(isStreet(city, s.x, s.z));
});

test('kaiju walks along a street', () => {
  const u = run({ role: 'kaiju', x: 12, z: 12, rot: 0 }, { x: 1, z: 0 }, 1, 3, TUNING.kaijuRadius);
  assert.ok(Math.abs(u.x - 15) < 0.01, `x=${u.x}`);
  assert.equal(u.z, 12);
});

test('buildings block the kaiju and tanks', () => {
  // from (12,3) going south: z=4 at x=12? column 12 is a street; use x=1: (1,3) south is house at (1,4)
  const k = run({ role: 'kaiju', x: 1, z: 3, rot: 0 }, { x: 0, z: 1 }, 1, 3, TUNING.kaijuRadius);
  assert.ok(k.z <= 3.11, `kaiju went into a house: z=${k.z}`);
  const t = run({ role: 'tank', x: 1, z: 3, rot: 0 }, { x: 0, z: 1 }, 1, 3, TUNING.tankRadius);
  assert.ok(t.z <= 3.26, `tank went into a house: z=${t.z}`);
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
  const u = run({ role: 'kaiju', x: 12, z: 12.3, rot: 0 }, { x: 1, z: 0 }, 1, 3, TUNING.kaijuRadius);
  assert.ok(u.x > 14, `stuck at x=${u.x}`);
  assert.ok(Math.abs(u.z - 12) < 0.01);
});

test('kaiju scaling: HP and speed grow with tank count', () => {
  assert.equal(kaijuMaxHpFor(3), 300);
  assert.ok(Math.abs(kaijuSpeedFor(3) - TUNING.kaijuSpeed * 1.15) < 1e-9);
  assert.ok(kaijuSpeedFor(2) > kaijuSpeedFor(1));
});
