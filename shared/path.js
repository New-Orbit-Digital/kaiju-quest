// Street pathfinding shared by bots and civilians.
import { tileWalkable } from './sim.js';

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Breadth-first search over walkable tiles from (sx,sz) until isGoal(tx,tz).
// opts: { maxNodes, destroyed, blocked, avoid(tx,tz) → true to treat a tile as closed }
export function bfs(city, role, sx, sz, isGoal, opts = {}) {
  const { maxNodes = 900, destroyed, blocked = null, avoid = null } = opts;
  const key = (x, z) => z * city.width + x;
  const prev = new Map([[key(sx, sz), -1]]);
  const queue = [[sx, sz]];
  for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
    const [x, z] = queue[qi];
    if (isGoal(x, z)) {
      const path = [];
      let k = key(x, z);
      while (k !== -1) { path.unshift({ x: k % city.width, z: Math.floor(k / city.width) }); k = prev.get(k); }
      return path;
    }
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz, nk = key(nx, nz);
      if (prev.has(nk)) continue;
      if (!tileWalkable(city, role, nx, nz, destroyed, blocked)) continue;
      if (avoid && avoid(nx, nz)) continue;
      prev.set(nk, key(x, z));
      queue.push([nx, nz]);
    }
  }
  return null;
}

// Steer toward the next tile on a path (street-aligned; lane assist does the rest).
// Consumes waypoints as they're reached.
export function steer(p, path) {
  const here = { x: Math.round(p.x), z: Math.round(p.z) };
  while (path.length > 1 && path[0].x === here.x && path[0].z === here.z) path.shift();
  const next = path[0];
  if (!next) return { x: 0, z: 0 };
  const dx = next.x - p.x, dz = next.z - p.z;
  if (Math.abs(dx) < 0.08 && Math.abs(dz) < 0.08) { path.shift(); return { x: 0, z: 0 }; }
  if (Math.abs(dx) > Math.abs(dz)) return { x: Math.sign(dx), z: Math.abs(dz) > 0.25 ? Math.sign(dz) * 0.3 : 0 };
  return { x: Math.abs(dx) > 0.25 ? Math.sign(dx) * 0.3 : 0, z: Math.sign(dz) };
}
