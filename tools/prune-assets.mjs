// Keeps only the asset files the game actually uses (city plan + units).
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCity } from '../shared/map.js';
import { modelForBuilding, ROAD_MODELS, TREE_MODELS } from '../client/src/cityplan.js';
const A = 'client/public/assets';
const keep = new Set(['units/trex.glb', 'units/tank.glb', 'units/soldier.glb']);
for (const m of [...ROAD_MODELS, ...TREE_MODELS]) keep.add(`city/${m}.glb`);
for (const b of parseCity().buildings) if (b.kind !== 'park') keep.add(`city/${modelForBuilding(b)}.glb`);
for (const k of [...keep]) if (k.startsWith('city/')) keep.add(k.split('/').slice(0, 2).join('/') + '/Textures/colormap.png');
const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let removed = 0;
for (const f of walk(A)) { const k = f.slice(A.length + 1); if (!keep.has(k)) { rmSync(f); removed++; } }
console.log(`kept ${keep.size}, removed ${removed}`);
