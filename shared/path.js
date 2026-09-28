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

// Cheapest path (Dijkstra) from (sx,sz) to (gx,gz) over walkable tiles, where
// cost(x, z) is the price of stepping onto a tile (default 1).
// opts: { destroyed, blocked, cost }
export function cheapest(city, role, sx, sz, gx, gz, opts = {}) {
  const { destroyed, blocked = null, cost = () => 1 } = opts;
  const W = city.width, key = (x, z) => z * W + x;
  const best = new Map([[key(sx, sz), 0]]), prev = new Map([[key(sx, sz), -1]]);
  const heap = [[0, sx, sz]];   // binary min-heap on cost
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, x, z] = pop();
    if (d > (best.get(key(x, z)) ?? Infinity)) continue;
    if (x === gx && z === gz) {
      const path = [];
      let k = key(x, z);
      while (k !== -1) { path.unshift({ x: k % W, z: Math.floor(k / W) }); k = prev.get(k); }
      return path;
    }
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!tileWalkable(city, role, nx, nz, destroyed, blocked)) continue;
      const nd = d + cost(nx, nz), nk = key(nx, nz);
      if (nd < (best.get(nk) ?? Infinity)) { best.set(nk, nd); prev.set(nk, key(x, z)); push([nd, nx, nz]); }
    }
  }
  return null;
}
