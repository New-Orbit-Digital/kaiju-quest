// Movement + collision shared by server (authoritative) and tests.
// Tile (x, z) covers [x-0.5, x+0.5] × [z-0.5, z+0.5]; tile centres are integers.
import { TUNING } from './tuning.js';

// Can a unit of `role` stand on tile (tx, tz)?
// destroyed(id) → true if that building is rubble (kaiju may walk rubble, tanks may not).
export function tileWalkable(city, role, tx, tz, destroyed = () => false) {
  if (tz < 0 || tz >= city.depth || tx < 0 || tx >= city.width) return false;
  if (city.tiles[tz][tx] === '#') return true;
  const id = city.owner[tz][tx];
  if (id < 0) return false;
  const b = city.buildings[id];
  if (b.kind === 'park') return false;
  return role === 'kaiju' && destroyed(id);
}

// Is a circle-ish unit (square hitbox of half-size r) at (x, z) clear?
export function spotClear(city, role, x, z, r, destroyed) {
  const e = 1e-6;
  const x0 = Math.round(x - r + e), x1 = Math.round(x + r - e);
  const z0 = Math.round(z - r + e), z1 = Math.round(z + r - e);
  for (let tz = z0; tz <= z1; tz++)
    for (let tx = x0; tx <= x1; tx++)
      if (!tileWalkable(city, role, tx, tz, destroyed)) return false;
  return true;
}

// Advance one unit by one tick.
// unit: { role, x, z, rot }   input: { x, z } world direction, length ≤ 1
export function stepUnit(city, unit, input, dt, speed, r, destroyed) {
  let ix = Number(input?.x) || 0, iz = Number(input?.z) || 0;
  const len = Math.hypot(ix, iz);
  if (len < 0.01) return false;
  if (len > 1) { ix /= len; iz /= len; }

  const step = speed * dt;
  const role = unit.role;
  const startX = unit.x, startZ = unit.z;

  // Lane assist: when driving mostly along one axis, slide toward the
  // centre of the current street lane so corners don't snag.
  const assist = TUNING.laneAssist * dt;
  const pull = (v) => {
    const c = Math.round(v), d = c - v;
    return Math.abs(d) <= assist ? c : v + Math.sign(d) * assist;
  };
  if (Math.abs(ix) > Math.abs(iz) * 2) {
    const nz = pull(unit.z);
    if (spotClear(city, role, unit.x, nz, r, destroyed)) unit.z = nz;
  } else if (Math.abs(iz) > Math.abs(ix) * 2) {
    const nx = pull(unit.x);
    if (spotClear(city, role, nx, unit.z, r, destroyed)) unit.x = nx;
  }

  // Axis-separated move so units slide along walls.
  const nx = unit.x + ix * step;
  if (spotClear(city, role, nx, unit.z, r, destroyed)) unit.x = nx;
  const nz = unit.z + iz * step;
  if (spotClear(city, role, unit.x, nz, r, destroyed)) unit.z = nz;

  // Face the way we're trying to go (even if pressed against a wall).
  unit.rot = Math.atan2(ix, iz);
  return unit.x !== startX || unit.z !== startZ;
}
