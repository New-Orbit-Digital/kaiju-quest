// Movement + collision shared by server (authoritative) and tests.
// Tile (x, z) covers [x-0.5, x+0.5] × [z-0.5, z+0.5]; tile centres are integers.
import { TUNING } from './tuning.js';

// Can a unit of `role` stand on tile (tx, tz)?
// destroyed(id) → true if that building is rubble (kaiju may walk rubble, tanks may not).
// blocked(tx, tz) → true if a roadblock sits on that street tile (kaiju only).
export function tileWalkable(city, role, tx, tz, destroyed = () => false, blocked = null) {
  if (tz < 0 || tz >= city.depth || tx < 0 || tx >= city.width) return false;
  if (city.tiles[tz][tx] === '#') return !(role === 'kaiju' && blocked && blocked(tx, tz));
  const id = city.owner[tz][tx];
  if (id < 0) return false;
  const b = city.buildings[id];
  if (b.kind === 'park') return true;          // parks: anyone can push through the trees (slowly)
  return role === 'kaiju' && destroyed(id);
}

// Speed factor for the ground under (x, z): parks (trees) slow everyone down.
export function terrainSpeed(city, x, z) {
  const id = city.owner[Math.round(z)]?.[Math.round(x)];
  return id !== undefined && id >= 0 && city.buildings[id].kind === 'park' ? TUNING.parkSpeed : 1;
}

// Collision shape of a blocked tile: the tile square, pulled back by
// TUNING.streetWiden on every side that faces a walkable tile. That makes each
// street wider than one tile (0.1 per side = 20% wider) while blocked tiles
// that sit side by side still meet with no gap.
function blockRect(city, role, tx, tz, destroyed, blocked) {
  const w = TUNING.streetWiden || 0;
  const open = (x, z) => x >= 0 && z >= 0 && x < city.width && z < city.depth &&
    tileWalkable(city, role, x, z, destroyed, blocked);
  return {
    x0: tx - 0.5 + (open(tx - 1, tz) ? w : 0), x1: tx + 0.5 - (open(tx + 1, tz) ? w : 0),
    z0: tz - 0.5 + (open(tx, tz - 1) ? w : 0), z1: tz + 0.5 - (open(tx, tz + 1) ? w : 0),
  };
}

// Is a round unit of radius r at (x, z) clear? Round hitboxes slide around
// building corners instead of snagging on them.
export function spotClear(city, role, x, z, r, destroyed, blocked) {
  const e = 1e-6;
  const x0 = Math.round(x - r - 0.5), x1 = Math.round(x + r + 0.5);
  const z0 = Math.round(z - r - 0.5), z1 = Math.round(z + r + 0.5);
  for (let tz = z0; tz <= z1; tz++)
    for (let tx = x0; tx <= x1; tx++) {
      if (tileWalkable(city, role, tx, tz, destroyed, blocked)) continue;
      const inside = tx >= 0 && tz >= 0 && tx < city.width && tz < city.depth;
      const b = inside ? blockRect(city, role, tx, tz, destroyed, blocked)
                       : { x0: tx - 0.5, x1: tx + 0.5, z0: tz - 0.5, z1: tz + 0.5 };
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < (r - e) ** 2) return false;
    }
  return true;
}

// Advance one unit by one tick.
// unit: { role, x, z, rot, moving }   input: { x, z } world direction, length ≤ 1
export function stepUnit(city, unit, input, dt, speed, r, destroyed, blocked) {
  let ix = Number(input?.x) || 0, iz = Number(input?.z) || 0;
  const len = Math.hypot(ix, iz);
  if (len < 0.01) return false;
  if (len > 1) { ix /= len; iz /= len; }

  const step = speed * terrainSpeed(city, unit.x, unit.z) * dt;
  const role = unit.role;
  const startX = unit.x, startZ = unit.z;
  const clear = (x, z) => spotClear(city, role, x, z, r, destroyed, blocked);

  // Early turn: steering into a side street a little before reaching it keeps
  // you rolling the way you were going, then turns as soon as the opening lines
  // up (up to TUNING.cornerLookahead tiles ahead).
  let mx = ix, mz = iz;
  const probe = 0.55 + (TUNING.streetWiden || 0) - r;   // just past the lane's free space
  const axisX = Math.abs(ix) > Math.abs(iz) * 2, axisZ = Math.abs(iz) > Math.abs(ix) * 2;
  if (unit.moving && (axisX || axisZ) && TUNING.cornerLookahead > 0) {
    const fx = Math.round(Math.sin(unit.rot)), fz = Math.round(Math.cos(unit.rot));
    const perpendicular = axisX ? (fz !== 0 && fx === 0) : (fx !== 0 && fz === 0);
    if (perpendicular && !clear(unit.x + ix * probe, unit.z + iz * probe)) {
      for (let d = 0.05; d <= TUNING.cornerLookahead; d += 0.05) {
        const ax = unit.x + fx * d, az = unit.z + fz * d;
        if (!clear(ax, az)) break;                       // wall ahead, no opening
        const ox = Math.round(ax), oz = Math.round(az);  // snap to the lane centre of the side street
        const sx = axisZ ? ox : ax, sz = axisX ? oz : az;
        if (clear(sx, sz) && clear(sx + ix * probe, sz + iz * probe)) { mx = fx; mz = fz; break; }
      }
    }
  }
  const turning = mx !== ix || mz !== iz;

  // Lane assist: when driving mostly along one axis, slide toward the
  // centre of the current street lane so corners don't snag.
  const assist = TUNING.laneAssist * dt;
  const pull = (v) => {
    const c = Math.round(v), d = c - v;
    return Math.abs(d) <= assist ? c : v + Math.sign(d) * assist;
  };
  if (Math.abs(mx) > Math.abs(mz) * 2) {
    const nz = pull(unit.z);
    if (clear(unit.x, nz)) unit.z = nz;
  } else if (Math.abs(mz) > Math.abs(mx) * 2) {
    const nx = pull(unit.x);
    if (clear(nx, unit.z)) unit.x = nx;
  }

  // Axis-separated move so units slide along walls.
  const nx = unit.x + mx * step;
  if (clear(nx, unit.z)) unit.x = nx;
  const nz = unit.z + mz * step;
  if (clear(unit.x, nz)) unit.z = nz;

  // Corner nudge: pushing into a wall just beside an opening slides you
  // sideways into the opening (within TUNING.cornerNudge of its lane centre).
  if (!turning && unit.x === startX && unit.z === startZ && (axisX || axisZ)) {
    const cur = axisX ? unit.z : unit.x;
    const lanes = [Math.floor(cur), Math.ceil(cur)].sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
    for (const lane of lanes) {
      const off = lane - cur;
      if (Math.abs(off) < 1e-3 || Math.abs(off) > TUNING.cornerNudge) continue;
      const lx = axisZ ? lane : unit.x, lz = axisX ? lane : unit.z;
      if (!clear(lx + ix * probe, lz + iz * probe)) continue;   // no opening in that lane
      const s = Math.sign(off) * Math.min(Math.abs(off), step);
      const tx = axisZ ? unit.x + s : unit.x, tz = axisX ? unit.z + s : unit.z;
      if (clear(tx, tz)) { unit.x = tx; unit.z = tz; }
      break;
    }
  }

  // Face the way we're trying to go (even if pressed against a wall);
  // during an early turn, face the way we're actually rolling.
  unit.rot = Math.atan2(mx, mz);
  return unit.x !== startX || unit.z !== startZ;
}

// Line of sight for tank shells. Walks the segment a→b and returns the first
// point inside a standing building (the lot minus its sidewalk), or null if
// the line is clear. blocks(id) → true if building id stops shells.
export function firstHit(city, blocks, ax, az, bx, bz, step = 0.05) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / step));
  const m = (1 - TUNING.buildingFootprint) / 2;      // sidewalk around each building
  for (let i = 1; i < n; i++) {
    const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
    const id = city.owner[Math.round(z)]?.[Math.round(x)];
    if (id === undefined || id < 0 || !blocks(id)) continue;
    const b = city.buildings[id];
    if (x > b.x - 0.5 + m && x < b.x + b.size - 0.5 - m && z > b.z - 0.5 + m && z < b.z + b.size - 0.5 - m) return { x, z, id };
  }
  return null;
}
