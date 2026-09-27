// End-to-end check against a production build served by the game server:
// a desktop KAIJU and an emulated-phone TANK (touch joystick) play a short
// round. Checks sync, strikes, auto-fire, a stomp, phone-only markers, the
// edge arrow and the end screen, and saves screenshots to docs/shots/.
import { chromium, devices } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const PORT = 2599, ROUND = 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
mkdirSync('docs/shots', { recursive: true });

execSync('npm run build --prefix client', { stdio: 'ignore' });
const server = spawn('node', ['server/src/index.js'],
  { env: { ...process.env, PORT: String(PORT), KQ_MATCH_SECONDS: String(ROUND) }, stdio: 'ignore' });
await sleep(2000);

const browsers = [];
const launch = async () => { const b = await chromium.launch({ executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); browsers.push(b); return b; };
const errors = [], fxLog = [];
async function open(name, contextOpts, query) {
  const ctx = await (await launch()).newContext(contextOpts);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`${name}: ${m.text()}`); });
  p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`${name}: HTTP ${r.status()} ${r.url()}`); });
  await p.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__kq?.room?.state?.players?.size >= 1, null, { timeout: 90000 });
  return p;
}
const me = (p) => p.evaluate(() => { const r = window.__kq.room, s = r.state, m = s.players.get(r.sessionId);
  return { role: m.role, mobile: m.mobile, x: m.x, z: m.z, alive: m.alive, phase: s.phase, hp: s.kaijuHp, max: s.kaijuMaxHp,
           score: s.kaijuScore, n: s.players.size, soldiers: m.soldiers.length, isMobile: window.__kq.mobile }; });
const hold = async (p, key, ms) => { await p.keyboard.down(key); await sleep(ms); await p.keyboard.up(key); };
async function until(cond, maxMs = 15000) { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < maxMs) await sleep(40); }
async function holdUntil(p, key, cond) { await p.keyboard.down(key); await until(cond); await p.keyboard.up(key); }
async function stick(p, dx, dy, cond) {   // drag the on-screen joystick until cond() is true
  const box = await p.locator('#kq-stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + dx, cy + dy, { steps: 4 });
  await until(cond); await p.mouse.up();
}
const fps = (p) => p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));

let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) ok = false; };
try {
  const kaiju = await open('kaiju', { viewport: { width: 1100, height: 620 } }, '?role=kaiju');
  // Pixel 7 in landscape, DPR 1 to keep software rendering bearable
  const phone = await open('phone', { ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 }, '');
  await kaiju.evaluate(() => { window.__fx = []; window.__kq.room.onMessage('fx', (e) => window.__fx.push(e.type)); });
  await sleep(1000);
  let k = await me(kaiju), t = await me(phone);
  check(k.role === 'kaiju' && t.role === 'tank' && t.mobile && t.isMobile, `roles: desktop=${k.role}, phone=${t.role} (mobile flag ${t.mobile})`);
  check(t.soldiers === 4, `tank has a squad of ${t.soldiers}`);
  check(await phone.locator('#kq-stick').isVisible() && await phone.locator('#kq-boost').isVisible(), 'phone shows joystick + boost button');
  check(!(await kaiju.locator('#kq-stick').count()), 'desktop has no touch controls');

  await sleep(3500);  // countdown
  k = await me(kaiju);
  check(k.phase === 'playing' && k.hp === 100 && k.max === 100, `round live: phase=${k.phase}, kaiju HP ${k.hp}/${k.max}`);

  // Kaiju steps one tile north (tower to its west), then smashes it 3 times
  await holdUntil(kaiju, 'KeyW', () => kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z <= 11.05; }));
  const hp0 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  for (let i = 0; i < 3; i++) { await kaiju.keyboard.press('KeyE'); await sleep(650); }
  const hp1 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  const hit = hp0.map((h, i) => h - hp1[i]).reduce((a, b) => a + b, 0);
  check(hit === 30, `3 strikes took ${hit} building HP (expected 30)`);
  await kaiju.screenshot({ path: 'docs/shots/p02-kaiju-smash.png' });

  // Phone tank: joystick down-left on screen = south along the street → (0,3)
  await stick(phone, -45, 45, () => phone.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z >= 2.7; }));
  t = await me(phone);
  check(t.z > 2 && Math.abs(t.x) < 0.3, `joystick drove the tank down its street: (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);
  // Boost from the phone button
  await phone.locator('#kq-boost').dispatchEvent('pointerdown');
  await until(() => phone.evaluate(() => { const r = window.__kq.room; const m = r.state.players.get(r.sessionId); return m.boosting || m.boostIn > 0; }), 5000);
  const boosting = await phone.evaluate(() => { const r = window.__kq.room; const m = r.state.players.get(r.sessionId); return m.boosting || m.boostIn > 0; });
  check(boosting, 'boost button triggers boost + cooldown');

  await sleep(800);
  await phone.screenshot({ path: 'docs/shots/p02-phone-edge-arrow.png' });
  check(await phone.evaluate(() => !document.getElementById('kq-edge').hidden), 'phone: edge arrow points to the off-screen kaiju');

  // Kaiju: north up column 12 to row 3, then west toward the tank
  await holdUntil(kaiju, 'KeyW', () => kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z <= 3.05; }));
  await kaiju.keyboard.down('KeyA');
  let shotSeen = false, markerSeen = false, stomped = false;
  for (let i = 0; i < 60 && !stomped; i++) {
    await sleep(200);
    const fx = await kaiju.evaluate(() => window.__fx);
    shotSeen ||= fx.includes('shot');
    stomped = fx.includes('tankDown');
    if (shotSeen && !markerSeen && (await phone.locator('.kq-marker:not([hidden])').count()) > 0) {
      markerSeen = true;
      await phone.screenshot({ path: 'docs/shots/p02-phone-marker-firing.png' });
      await kaiju.screenshot({ path: 'docs/shots/p02-kaiju-under-fire.png' });
    }
  }
  await kaiju.keyboard.up('KeyA');
  k = await me(kaiju); t = await me(phone);
  check(shotSeen && k.hp < k.max, `tank + squad auto-fired: kaiju HP ${k.hp.toFixed(2)}/${k.max}`);
  check(markerSeen, 'phone: marker shown over the kaiju');
  check(!(await kaiju.locator('.kq-marker:not([hidden])').count()) && !(await kaiju.locator('#kq-edge:not([hidden])').count()),
    'desktop kaiju: no markers and no arrows to tanks');
  const fxAll = await kaiju.evaluate(() => window.__fx);
  check(stomped && k.score >= 50 && (!t.alive || fxAll.includes('respawn')), `kaiju stomped the tank: score ${k.score} (tankDown events: ${fxAll.filter(x => x === 'tankDown').length})`);
  await sleep(300);
  await phone.screenshot({ path: 'docs/shots/p02-phone-crushed.png' });
  await until(() => me(phone).then(m => m.alive), 12000);
  t = await me(phone); k = await me(kaiju);
  const d = Math.hypot(t.x - k.x, t.z - k.z);
  check(t.alive && d >= 12, `tank respawned ${d.toFixed(1)} tiles from the kaiju`);

  const [fk, fp] = [await fps(kaiju), await fps(phone)];
  console.log(`INFO  fps in headless software GL (not a real device): desktop ${fk}, phone ${fp}`);

  // Let the timer run out → kaiju wins, end screen shows
  await kaiju.waitForFunction(() => window.__kq.room.state.phase === 'ended', null, { timeout: (ROUND + 10) * 1000 });
  await sleep(600);
  k = await me(kaiju);
  const endText = await kaiju.locator('#kq-end').innerText();
  check(/KAIJU WINS/.test(endText), `end screen: "${endText.split('\n')[0]}"`);
  await kaiju.screenshot({ path: 'docs/shots/p02-end-screen.png' });
  await phone.screenshot({ path: 'docs/shots/p02-phone-end.png' });
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e); ok = false;
} finally {
  await Promise.all(browsers.map(b => b.close())); server.kill();
}
process.exit(ok ? 0 : 1);
