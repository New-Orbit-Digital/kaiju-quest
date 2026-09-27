// Builds client/dist-sandbox/kaiju-sandbox.html: a single-file, offline
// version of the game for a chat artifact (no server, assets embedded).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseCity } from '../shared/map.js';
import { modelForBuilding, ROAD_MODELS, TREE_MODELS } from '../client/src/cityplan.js';

const A = 'client/public/assets/';
const keys = new Set(['units/trex.glb', 'units/tank.glb', 'units/soldier.glb']);
for (const m of [...ROAD_MODELS, ...TREE_MODELS]) keys.add(`city/${m}.glb`);
for (const b of parseCity().buildings) if (b.kind !== 'park') keys.add(`city/${modelForBuilding(b)}.glb`);
for (const k of [...keys]) if (k.startsWith('city/')) keys.add(k.split('/').slice(0, 2).join('/') + '/Textures/colormap.png');
for (const f of readdirSync(A + 'sfx')) if (f.endsWith('.mp3')) keys.add(`sfx/${f}`);

const out = {};
let bytes = 0;
for (const k of [...keys].sort()) { const buf = readFileSync(A + k); bytes += buf.length; out[k] = buf.toString('base64'); }
mkdirSync('client/src/generated', { recursive: true });
writeFileSync('client/src/generated/assets-embedded.js',
  `globalThis.__KQ_OFFLINE = true;\nglobalThis.__KQ_ASSETS = ${JSON.stringify(out)};\n`);
console.log(`embedded ${keys.size} files, ${(bytes / 1e6).toFixed(2)} MB raw`);

execSync('npx vite build --config vite.sandbox.config.js', { cwd: 'client', stdio: 'inherit' });
const js = readFileSync('client/dist-sandbox/sandbox.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const shell = readFileSync('tools/sandbox-shell.html', 'utf8');
const html = shell.replace('/*__SANDBOX_JS__*/', () => js);
writeFileSync('client/dist-sandbox/kaiju-sandbox.html', html);
console.log(`kaiju-sandbox.html: ${(html.length / 1e6).toFixed(2)} MB`);
