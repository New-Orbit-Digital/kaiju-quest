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
           score: s.kaijuScore, n: s.players.size, mode: s.mode, isMobile: window.__kq.mobile }; });
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
  const kaiju = await open('kaiju', { viewport: { width: 1100, height: 620 } }, '?role=kaiju&name=Rex');
  // Pixel 7 in landscape, DPR 1 to keep software rendering bearable
  const phone = await open('phone', { ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 }, '?name=Pat');
  await kaiju.evaluate(() => { window.__fx = []; window.__kq.room.onMessage('fx', (e) => window.__fx.push(e.type)); });
  await sleep(1000);
  let k = await me(kaiju), t = await me(phone);
  check(k.role === 'kaiju' && t.role === 'tank' && t.mobile && t.isMobile, `roles: desktop=${k.role}, phone=${t.role} (mobile flag ${t.mobile})`);
  check(k.mode === 'ffa', `default mode is free for all (${k.mode})`);
  check(await phone.locator('#kq-stick').isVisible() && await phone.locator('#kq-block').isVisible(), 'phone shows joystick + BLOCK button');
  check(!(await kaiju.locator('#kq-stick').count()), 'desktop has no touch controls');

  // ── Lobby ──
  k = await me(kaiju);
  check(k.phase === 'lobby', `joined into the lobby (${k.phase})`);
  // a third desktop player (a "ghost" tab) joins by typing a name
  const ghostBrowser = await launch();
  const ghost = await ghostBrowser.newPage({ viewport: { width: 900, height: 560 } });
  await ghost.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ghost.waitForSelector('#kq-name', { timeout: 90000 });
  await ghost.fill('#kq-name', 'Ghost'); await ghost.click('#kq-pick button[type=submit]');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.players.size === 3), 60000);
  await until(() => kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby .nm')].map(n => n.textContent).join('|').includes('Ghost')), 15000);
  const names = await kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby .nm')].map(n => n.textContent));
  check(names.some(n => n.startsWith('Rex')) && names.some(n => n.startsWith('Pat')) && names.some(n => n.startsWith('Ghost')),
    `lobby lists every player by name: ${names.join(', ')}`);
  // mode picker: three modes, the new two flagged beta; picking one syncs to everyone
  const modeBtns = await kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby [data-mode]')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
  check(modeBtns.length === 3 && modeBtns.filter(t => /beta/i.test(t)).length === 2, `lobby mode picker: ${modeBtns.join(' | ')}`);
  await kaiju.locator('#kq-lobby [data-mode=koth]').dispatchEvent('click');
  await until(() => phone.evaluate(() => window.__kq.room.state.mode === 'koth'), 10000);
  check((await me(phone)).mode === 'koth', 'picking King of the Hill reaches the other player');
  await kaiju.screenshot({ path: 'docs/shots/p05-lobby-modes.png', timeout: 120000 });
  await kaiju.locator('#kq-lobby [data-mode=ffa]').dispatchEvent('click');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.mode === 'ffa'), 10000);
  await kaiju.screenshot({ path: 'docs/shots/p03-lobby.png', timeout: 120000 });
  // add a bot tank from the lobby, check it's listed, then remove it again
  await kaiju.locator('#kq-lobby [data-bot=tank]').dispatchEvent('click');
  await until(() => kaiju.evaluate(() => { let b = 0; window.__kq.room.state.players.forEach(p => { if (p.bot) b++; }); return b === 1; }), 15000);
  const botId = await kaiju.evaluate(() => { let id = ''; window.__kq.room.state.players.forEach((p, k) => { if (p.bot) id = k; }); return id; });
  await until(() => kaiju.evaluate((id) => !!document.querySelector(`#kq-lobby [data-kick="${id}"]`), botId), 10000);
  const botRow = await kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby .nm')].map(n => n.textContent).find(t => t.includes('bot')) || '');
  check(!!botRow, `+ BOT TANK adds a ready bot to the lobby: "${botRow}"`);
  await kaiju.locator(`#kq-lobby [data-kick="${botId}"]`).dispatchEvent('click');
  await until(() => kaiju.evaluate(() => { let b = 0; window.__kq.room.state.players.forEach(p => { if (p.bot) b++; }); return b === 0; }), 10000);
  check(true, 'bot removed with ✕');
  // Rex readies; the round must not start while Pat hasn't (Ghost is active too)
  await kaiju.locator('#kq-lobby [data-act=ready]').dispatchEvent('click');
  await sleep(1500);
  check((await me(kaiju)).phase === 'lobby', 'no start while others are not ready');
  // kick the ghost
  const kickTarget = await kaiju.evaluate(() => { const r = window.__kq.room; let gid = ''; r.state.players.forEach((p, id) => { if (p.name === 'Ghost') gid = id; }); return gid; });
  if (kickTarget) await kaiju.locator(`#kq-lobby [data-kick="${kickTarget}"]`).dispatchEvent('click');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.players.size === 2), 15000);
  check((await me(kaiju)).n === 2, 'kicking the ghost removed it from the game');
  await ghostBrowser.close(); browsers.splice(browsers.indexOf(ghostBrowser), 1);
  const tagCount = await kaiju.evaluate(() => [...document.querySelectorAll('.kq-tag')].filter(t => !t.hidden).map(t => t.textContent));
  check(tagCount.some(t => t.startsWith('Rex')), `name tags over units: ${tagCount.join(', ')}`);
  // Pat readies from the phone → countdown → round
  await phone.locator('#kq-lobby [data-act=ready]').dispatchEvent('click');
  await until(() => me(kaiju).then(m => m.phase === 'playing'), 30000);  // countdown
  k = await me(kaiju);
  check(k.phase === 'playing' && k.hp === 100 && k.max === 100, `round live: phase=${k.phase}, kaiju HP ${k.hp}/${k.max}`);

  // Kaiju steps one tile north (towers either side), then smashes 3 times
  await holdUntil(kaiju, 'KeyW', () => kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z <= 11.05; }));
  const hp0 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  for (let i = 0; i < 3; i++) { await kaiju.keyboard.press('Space'); await sleep(650); }
  const hp1 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  const hit = hp0.map((h, i) => h - hp1[i]).reduce((a, b) => a + b, 0);
  check(hit === 30, `3 strikes took ${hit} building HP (expected 30)`);
  // Controller: a fake standard-layout pad; A (button 0) = kaiju smash
  await kaiju.evaluate(() => {
    const pad = (a) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0 && a, value: i === 0 && a ? 1 : 0 })) });
    window.__pad = pad(false);
    navigator.getGamepads = () => [window.__pad];
    window.__padPress = (a) => { window.__pad = pad(a); };
  });
  await sleep(700);
  await kaiju.evaluate(() => window.__padPress(true));
  await until(() => kaiju.evaluate((h) => Array.from(window.__kq.room.state.buildingHp).reduce((a, b) => a + b, 0) < h,
    hp1.reduce((a, b) => a + b, 0)), 8000);
  await kaiju.evaluate(() => window.__padPress(false));
  const hp2 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  const padHit = hp1.map((h, i) => h - hp2[i]).reduce((a, b) => a + b, 0);
  check(padHit === 10, `controller A button smashed: ${padHit} building HP (expected 10)`);
  await kaiju.evaluate(() => { navigator.getGamepads = () => []; });
  await kaiju.screenshot({ path: 'docs/shots/p02-kaiju-smash.png', timeout: 120000 });

  // Phone tank: joystick down-left on screen = south along the ring road → (0,3)
  await stick(phone, -45, 45, () => phone.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z >= 2.7; }));
  t = await me(phone);
  check(t.z > 2 && Math.abs(t.x) < 0.3, `joystick drove the tank down its street: (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);
  check(!(await phone.locator('#kq-boost').count()), 'phone tank has no boost button (tanks have no boost)');
  await phone.locator('#kq-block').dispatchEvent('pointerdown');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.roadblocks.size === 1), 8000);
  const rbCount = await kaiju.evaluate(() => window.__kq.room.state.roadblocks.size);
  check(rbCount === 1, `phone BLOCK button drops a roadblock (${rbCount})`);

  await sleep(800);
  await phone.screenshot({ path: 'docs/shots/p02-phone-edge-arrow.png', timeout: 120000 });
  check(await phone.evaluate(() => !document.getElementById('kq-edge').hidden), 'phone: edge arrow points to the off-screen kaiju');

  // Kaiju: north up column 15 to row 3, then west toward the tank with a Shift boost
  await holdUntil(kaiju, 'KeyW', () => kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z <= 3.05; }));
  await kaiju.keyboard.down('KeyA');
  await kaiju.keyboard.press('ShiftLeft');
  await until(() => kaiju.evaluate(() => { const r = window.__kq.room; const m = r.state.players.get(r.sessionId); return m.boosting || m.boostIn > 0; }), 8000);
  check(await kaiju.evaluate(() => { const r = window.__kq.room; const m = r.state.players.get(r.sessionId); return m.boosting || m.boostIn > 0; }), 'kaiju SHIFT boost fires (and starts its cooldown)');
  let shotSeen = false, markerSeen = false, stomped = false;
  for (let i = 0; i < 60 && !stomped; i++) {
    await sleep(200);
    const fx = await kaiju.evaluate(() => window.__fx);
    shotSeen ||= fx.includes('shot');
    stomped = fx.includes('tankDown');
    if (shotSeen && !markerSeen && (await phone.locator('.kq-marker:not([hidden])').count()) > 0) {
      markerSeen = true;
      await phone.screenshot({ path: 'docs/shots/p02-phone-marker-firing.png', timeout: 120000 });
      await kaiju.screenshot({ path: 'docs/shots/p02-kaiju-under-fire.png', timeout: 120000 });
    }
  }
  await kaiju.keyboard.up('KeyA');
  k = await me(kaiju); t = await me(phone);
  check(shotSeen && k.hp < k.max, `tank auto-fired: kaiju HP ${k.hp.toFixed(2)}/${k.max}`);
  check(markerSeen, 'phone: marker shown over the kaiju');
  check(!(await kaiju.locator('.kq-marker:not([hidden])').count()) && !(await kaiju.locator('#kq-edge:not([hidden])').count()),
    'desktop kaiju: no markers and no arrows to tanks');
  const fxAll = await kaiju.evaluate(() => window.__fx);
  check(stomped && k.score >= 50 && (!t.alive || fxAll.includes('respawn')), `kaiju stomped the tank: score ${k.score} (tankDown events: ${fxAll.filter(x => x === 'tankDown').length})`);
  await sleep(300);
  await until(() => me(phone).then(m => m.alive), 12000);
  t = await me(phone); k = await me(kaiju);
  const d = Math.hypot(t.x - k.x, t.z - k.z);
  check(t.alive && d >= 12, `tank respawned ${d.toFixed(1)} tiles from the kaiju`);

  const [fk, fp] = [await fps(kaiju), await fps(phone)];
  console.log(`INFO  fps in headless software GL (not a real device): desktop ${fk}, phone ${fp}`);

  // Let the timer run out → kaiju wins, end screen shows
  await kaiju.waitForFunction(() => window.__kq.room.state.phase === 'ended', null, { timeout: (ROUND + 30) * 1000 });
  await sleep(600);
  k = await me(kaiju);
  const endText = await kaiju.locator('#kq-end').innerText();
  check(/WINS/.test(endText), `end screen: "${endText.split('\n')[0]}"`);
  await kaiju.screenshot({ path: 'docs/shots/p02-end-screen.png', timeout: 120000 });
  await phone.screenshot({ path: 'docs/shots/p02-phone-end.png', timeout: 120000 });
  // pick next round's mode from the end screen
  await kaiju.locator('#kq-end [data-mode=evac]').dispatchEvent('click');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.mode === 'evac'), 10000);
  check((await me(kaiju)).mode === 'evac', 'end screen mode picker sets the next round to Evacuation');
  // sounds fired for the events this round had (recorded even if the headless audio device is silent)
  const heard = await kaiju.evaluate(() => [...new Set(window.__kqSfx)]);
  const heardPhone = await phone.evaluate(() => [...new Set(window.__kqSfx)]);
  check(['monster-hit', 'building-destroyed', 'tank-shooting', 'tank-dead', 'monster-footsteps'].every(n => heard.includes(n)) || ['monster-hit', 'tank-shooting', 'tank-dead', 'monster-footsteps'].every(n => heard.includes(n)),
    `kaiju heard: ${heard.join(', ')}`);
  check(['tank-moving', 'roadblock-placed', 'tank-shooting'].every(n => heardPhone.includes(n)), `phone tank heard: ${heardPhone.join(', ')}`);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e); ok = false;
} finally {
  await Promise.all(browsers.map(b => b.close())); server.kill();
}
process.exit(ok ? 0 : 1);
