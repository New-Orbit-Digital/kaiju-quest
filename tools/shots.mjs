// Visual check: builds the client, starts the game server (which serves
// the built client), joins as kaiju and as a tank in two browsers, drives both,
// and saves screenshots to docs/shots/. Exits non-zero on failure.
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const PORT = 2599;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

execSync('npm run build --prefix client', { stdio: 'inherit' });
const server = spawn('node', ['server/src/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await sleep(2500);

// One browser per player: software GL in a single browser starves the second tab.
const browsers = [];
const launch = async () => { const b = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
}); browsers.push(b); return b; };
// the game server hosts the built client itself (same as on Render)
const url = (role) => `http://localhost:${PORT}/?role=${role}`;
const errors = [];
async function open(role) {
  const p = await (await launch()).newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => errors.push(`${role}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`${role}: ${m.text()}`); });
  p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`${role}: HTTP ${r.status()} ${r.url()}`); });
  await p.goto(url(role), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__kq?.room?.state?.players?.size >= 1, null, { timeout: 60000 });
  return p;
}
const hold = async (p, key, ms) => { await p.keyboard.down(key); await sleep(ms); await p.keyboard.up(key); };
const pos = (p) => p.evaluate(() => { const r = window.__kq.room; const me = r.state.players.get(r.sessionId); return { role: me.role, x: me.x, z: me.z, n: r.state.players.size }; });

let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) ok = false; };
try {
  const kaiju = await open('kaiju');
  const tank = await open('tank');
  await sleep(1500);
  const k0 = await pos(kaiju), t0 = await pos(tank);
  check(k0.role === 'kaiju' && t0.role === 'tank', `roles: ${k0.role} / ${t0.role}`);
  check(k0.n === 2 && t0.n === 2, `both clients see 2 players (${k0.n}, ${t0.n})`);
  await kaiju.screenshot({ path: 'docs/shots/p01-kaiju-start.png' });
  await tank.screenshot({ path: 'docs/shots/p01-tank-start.png' });

  // kaiju: W (north) then D (east); tank: S (south, down col 0) then D (east, along row 3)
  await Promise.all([hold(kaiju, 'KeyW', 900), hold(tank, 'KeyS', 900)]);
  await Promise.all([hold(kaiju, 'KeyD', 900), hold(tank, 'KeyD', 1400)]);
  await sleep(500);
  const k1 = await pos(kaiju), t1 = await pos(tank);
  check(k1.z < k0.z - 1 && k1.x > k0.x + 1, `kaiju moved north+east: (${k0.x},${k0.z}) → (${k1.x.toFixed(2)},${k1.z.toFixed(2)})`);
  check(t1.x > t0.x + 1 && t1.z > t0.z + 1, `tank moved south+east: (${t0.x},${t0.z}) → (${t1.x.toFixed(2)},${t1.z.toFixed(2)})`);
  await kaiju.screenshot({ path: 'docs/shots/p01-kaiju-moved.png' });
  await tank.screenshot({ path: 'docs/shots/p01-tank-moved.png' });

  // tank drives toward the kaiju so both appear in one frame
  await tank.evaluate(() => { window.__kq.room.send('input', { x: 0, z: 0 }); });
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e); ok = false;
} finally {
  await Promise.all(browsers.map(b => b.close())); server.kill();
}
process.exit(ok ? 0 : 1);
