// Phone-control checks in the offline sandbox (no server needed): an emulated
// Pixel 7 plays the kaiju against bot tanks.
//  • tapping a building walks the kaiju there and smashes it to rubble
//  • the floating stick maps screen-diagonal drags onto the right street
//  • Evacuation: civilian paths are drawn as one merged network
// Screenshots go to docs/shots/.
import { chromium, devices } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const PORT = 2598;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
mkdirSync('docs/shots', { recursive: true });
if (!process.argv.includes('--no-build')) execSync('npm run build --prefix client', { stdio: 'ignore' });
const server = spawn('node', ['server/src/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await sleep(1500);
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) ok = false; };
async function until(cond, maxMs = 15000) { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < maxMs) await sleep(60); }
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await p.goto(`http://localhost:${PORT}/?offline&mobile`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__kq?.room?.state?.players?.size >= 2 && window.__kq.city, null, { timeout: 90000 });
  await until(() => p.evaluate(() => window.__kq.room.state.phase === 'playing'), 30000);
  const me = () => p.evaluate(() => { const r = window.__kq.room; const m = r.state.players.get(r.sessionId); return { role: m.role, x: m.x, z: m.z, route: m.route, routeBid: m.routeBid, windup: m.windup }; });
  const onScreen = (x, y, z) => p.evaluate(([x, y, z]) => {
    const v = new window.__kq.camera.position.constructor(x, y, z).project(window.__kq.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }, [x, y, z]);
  check((await me()).role === 'kaiju', 'phone drives the kaiju');
  check(!(await p.locator('#kq-smash').count()) && await p.locator('#kq-kboost').isVisible(), 'phone kaiju: BOOST button, no SMASH button');

  // ── floating stick: screen-diagonal drags snap onto the streets ──
  const drag = async (dx, dy) => {
    const cx = 260, cy = 220;
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + dx, cy + dy, { steps: 3 });
    await sleep(150);
    const v = await p.evaluate(() => window.__kq.moveVector());
    const shown = await p.evaluate(() => !document.getElementById('kq-stick').hidden);
    await p.mouse.up();
    return { v, shown };
  };
  const dr = await drag(45, 45), ul = await drag(-45, -45), ur = await drag(45, -45), dl = await drag(-40, 50);
  check(dr.shown, 'the stick appears where the thumb lands');
  check(dr.v.x === 1 && dr.v.z === 0, `drag down-right → east street (${JSON.stringify(dr.v)})`);
  check(ul.v.x === -1 && ul.v.z === 0, `drag up-left → west street (${JSON.stringify(ul.v)})`);
  check(ur.v.x === 0 && ur.v.z === -1, `drag up-right → north street (${JSON.stringify(ur.v)})`);
  check(dl.v.x === 0 && dl.v.z === 1, `drag down-left (off the diagonal) → south street (${JSON.stringify(dl.v)})`);
  // follows the thumb: a long drag moves the stick's base
  await p.mouse.move(260, 220); await p.mouse.down(); await p.mouse.move(420, 220, { steps: 4 });
  await sleep(100);
  const baseLeft = await p.evaluate(() => parseFloat(document.querySelector('#kq-stick b').style.left));
  await p.mouse.up();
  check(baseLeft > 260 - 60 + 50, `a long drag pulls the stick along (base left ${baseLeft.toFixed(0)}px)`);

  // ── tap a building: walk there and smash it to rubble ──
  const m0 = await me();
  const target = await p.evaluate(([kx, kz]) => {
    const { city, room } = window.__kq; const hp = room.state.buildingHp;
    let best = null, bestD = Infinity;
    for (const b of city.buildings) {
      if (b.kind === 'park' || hp[b.id] <= 0 || b.size !== 1) continue;
      const d = Math.hypot(b.cx - kx, b.cz - kz);
      if (d > 3 && d < bestD) { bestD = d; best = { id: b.id, x: b.cx, z: b.cz, kind: b.kind }; }
    }
    return best;
  }, [m0.x, m0.z]);
  const pt = await onScreen(target.x, 0.3, target.z);
  await p.mouse.click(pt.x, pt.y);
  await until(async () => (await me()).routeBid === target.id, 8000);
  const m1 = await me();
  check(m1.routeBid === target.id, `tap on a ${target.kind} building targets it (routeBid ${m1.routeBid})`);
  await sleep(300);
  await p.screenshot({ path: 'docs/shots/pm-tap-route.png' });
  await until(() => p.evaluate((id) => window.__kq.room.state.buildingHp[id] <= 0, target.id), 45000);
  check(await p.evaluate((id) => window.__kq.room.state.buildingHp[id] <= 0, target.id), 'the kaiju walked up and smashed it to rubble');
  await p.screenshot({ path: 'docs/shots/pm-tap-smashed.png' });

  // ── Evacuation: merged civilian paths ──
  await p.evaluate(() => window.__kq.room.send('mode', { mode: 'evac' }));
  await until(() => p.evaluate(() => window.__kq.room.state.phase === 'playing' && window.__kq.room.state.civilians.size >= 4), 60000);
  await sleep(1500);
  const net = await p.evaluate(() => {
    const st = window.__kq.room.state; let edges = 0, withPath = 0;
    st.civilians.forEach(c => { if (c.path) { withPath++; edges += c.path.split(';').length - 1; } });
    return { civs: st.civilians.size, withPath, edges, drawn: window.__kq.civPaths.strips.mesh.count, visible: window.__kq.civPaths.strips.mesh.visible };
  });
  check(net.withPath === net.civs && net.visible && net.drawn > 0, `civilian paths drawn: ${net.civs} civilians, ${net.drawn} strips on the ground`);
  check(net.drawn < net.edges, `overlapping paths merge: ${net.drawn} strips for ${net.edges} path steps`);
  await p.screenshot({ path: 'docs/shots/pm-evac-paths.png' });
  // zoomed out, to see the whole merged network
  await p.evaluate(() => { const c = window.__kq.camera; c.zoom = 0.42; c.updateProjectionMatrix(); });
  await sleep(1500);
  await p.screenshot({ path: 'docs/shots/pm-evac-paths-wide.png' });
  await p.evaluate(() => { const c = window.__kq.camera; c.zoom = 1; c.updateProjectionMatrix(); });
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) { console.error(e); ok = false; }
finally { await browser.close(); server.kill(); }
process.exit(ok ? 0 : 1);
