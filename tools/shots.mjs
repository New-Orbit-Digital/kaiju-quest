// End-to-end check against a production build served by the game server:
// a desktop KAIJU and an emulated-phone TANK (touch joystick) play a short
// round. Checks sync, strikes, auto-fire, a stomp, phone-only markers, the
// edge arrow and the end screen, and saves screenshots to docs/shots/.
import { chromium, devices } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { scaled } from '../shared/tuning.js';

const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const PORT = 2599, ROUND = 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
mkdirSync('docs/shots', { recursive: true });

execSync('npm run build --prefix client', { stdio: 'ignore' });
const server = spawn('node', ['server/src/index.js'],
  { env: { ...process.env, PORT: String(PORT), KQ_MATCH_SECONDS: String(ROUND), KQ_TEST: '1' }, stdio: 'ignore' });
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
  // (trees-rustling.mp3 is optional until it's added to the repo)
  p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico') && !r.url().includes('/sfx/trees-rustling')) errors.push(`${name}: HTTP ${r.status()} ${r.url()}`); });
  await p.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__kq?.room?.state?.players?.size >= 1, null, { timeout: 90000 });
  return p;
}
const me = (p) => p.evaluate(() => { const r = window.__kq.room, s = r.state, m = s.players.get(r.sessionId);
  let kj = null; s.players.forEach(p => { if (p.role === 'kaiju') kj = p; });
  return { role: m.role, mobile: m.mobile, x: m.x, z: m.z, alive: m.alive, phase: s.phase, hp: kj?.hp, max: kj?.maxHp, code: s.code,
           score: s.kaijuScore, n: s.players.size, mode: s.mode, isMobile: window.__kq.mobile }; });
const hold = async (p, key, ms) => { await p.keyboard.down(key); await sleep(ms); await p.keyboard.up(key); };
async function until(cond, maxMs = 15000) { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < maxMs) await sleep(40); }
async function holdUntil(p, key, cond) { await p.keyboard.down(key); await until(cond); await p.keyboard.up(key); }
async function stick(p, dx, dy, cond) {   // drag a floating stick from mid-left of the screen until cond() is true
  const vp = p.viewportSize();
  const cx = vp.width * 0.3, cy = vp.height * 0.55;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + dx, cy + dy, { steps: 4 });
  await until(cond); await p.mouse.up();
}
// Screen position of a ground tile (for taps)
const tileOnScreen = (p, x, z) => p.evaluate(([x, z]) => {
  const v = new window.__kq.camera.position.constructor(x, 0, z).project(window.__kq.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}, [x, z]);
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
  check(k.mode === 'race', `default mode is Save the City! (${k.mode})`);
  check(await phone.evaluate(() => document.getElementById('kq-stick').hidden) && await phone.locator('#kq-block').isVisible() && !(await phone.locator('#kq-smash').count()),
    'phone shows BLOCK; the floating stick stays hidden until a drag; no SMASH button anywhere');
  check(!(await kaiju.locator('#kq-stick').count()), 'desktop has no touch controls');

  // ── Lobby ──
  k = await me(kaiju);
  check(k.phase === 'lobby', `joined into the lobby (${k.phase})`);
  // room code + share link in the lobby
  await until(() => kaiju.evaluate(() => !!document.querySelector('#kq-lobby .room b')), 15000);
  const roomCode = await kaiju.evaluate(() => document.querySelector('#kq-lobby .room b')?.textContent);
  check(/^[A-Z]{4}$/.test(roomCode || '') && roomCode === k.code, `lobby shows the room code ${roomCode}`);
  await kaiju.locator('#kq-lobby [data-share]').dispatchEvent('click');
  await until(() => kaiju.evaluate(() => (window.__kqShared || []).length > 0), 10000);
  const shared = await kaiju.evaluate(() => window.__kqShared[0]);
  check(shared.includes(`room=${roomCode}`), `COPY LINK gives a share link: ${shared}`);
  // a third desktop player (a "ghost" tab) opens the share link and types a name
  const ghostBrowser = await launch();
  const ghost = await ghostBrowser.newPage({ viewport: { width: 900, height: 560 } });
  await ghost.goto(`http://localhost:${PORT}/?room=${roomCode}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ghost.waitForSelector('#kq-name', { timeout: 90000 });
  const joinLabel = await ghost.locator('#kq-pick button[type=submit]').innerText();
  check(joinLabel.includes(roomCode), `share link opens a "${joinLabel}" button`);
  await ghost.fill('#kq-name', 'Ghost'); await ghost.click('#kq-pick button[type=submit]');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.players.size === 3), 60000);
  await until(() => kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby .nm')].map(n => n.textContent).join('|').includes('Ghost')), 15000);
  const names = await kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby .nm')].map(n => n.textContent));
  check(names.some(n => n.startsWith('Rex')) && names.some(n => n.startsWith('Pat')) && names.some(n => n.startsWith('Ghost')),
    `lobby lists every player by name: ${names.join(', ')}`);
  // mode picker: three modes, the new two flagged beta; picking one syncs to everyone
  const modeBtns = await kaiju.evaluate(() => [...document.querySelectorAll('#kq-lobby [data-mode]')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));
  check(modeBtns.length === 3 && /Save the City/.test(modeBtns[0]) && !modeBtns.some(t => /beta/i.test(t)), `lobby mode picker: ${modeBtns.join(' | ')}`);
  await kaiju.locator('#kq-lobby [data-mode=koth]').dispatchEvent('click');
  await until(() => phone.evaluate(() => window.__kq.room.state.mode === 'koth'), 10000);
  check((await me(phone)).mode === 'koth', 'picking King of the Hill reaches the other player');
  await kaiju.screenshot({ path: 'docs/shots/p05-lobby-modes.png', timeout: 120000 });
  await kaiju.locator('#kq-lobby [data-mode=race]').dispatchEvent('click');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.mode === 'race'), 10000);
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
  // keep Pat and Ghost "active" (the slow software renderer can take longer than afkSeconds to get here)
  for (const p of [phone, ghost]) await p.evaluate(() => { const r = window.__kq.room; r.send('input', { x: 0.01, z: 0 }); r.send('input', { x: 0, z: 0 }); });
  await sleep(300);
  // Rex readies WITH A CONTROLLER: D-pad to the READY button, A to press it
  await kaiju.evaluate(() => {
    const pad = (i) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, j) => ({ pressed: j === i, value: j === i ? 1 : 0 })) });
    window.__pad = pad(-1);
    navigator.getGamepads = () => [window.__pad];
    window.__padSet = (i) => { window.__pad = pad(i); };
  });
  const frames = () => kaiju.evaluate(() => window.__kqFrame || 0);
  const padTap = async (i) => {   // hold for 2 frames, release for 2 (slow software rendering)
    await kaiju.evaluate((i) => window.__padSet(i), i);
    const f0 = await frames(); await until(async () => (await frames()) >= f0 + 2, 20000);
    await kaiju.evaluate(() => window.__padSet(-1));
    const f1 = await frames(); await until(async () => (await frames()) >= f1 + 2, 20000);
  };
  const focused = () => kaiju.evaluate(() => document.querySelector('.kq-padfocus')?.textContent || '');
  await padTap(13);   // D-pad down: highlights the first button
  for (let i = 0; i < 12; i++) {   // walk the menu like a player would
    const f = (await focused()).trim();
    if (f === 'READY') break;
    await padTap(/^PLAY (TANK|KAIJU)$/.test(f) ? 14 : /BOT/.test(f) ? 12 : 13);   // left / up / down
  }
  const onReady = (await focused()).trim();
  check(onReady === 'READY', `controller D-pad highlights lobby buttons (on "${onReady}")`);
  await padTap(0);    // A
  await until(() => kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).ready; }), 15000);
  check(await kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).ready; }), 'controller A pressed READY');
  await kaiju.evaluate(() => { navigator.getGamepads = () => []; });
  // the round must not start while Pat hasn't readied (Ghost is active too)
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
  check(k.phase === 'playing' && k.hp === scaled('kaijuHp', 1) && k.max === scaled('kaijuHp', 1), `round live: phase=${k.phase}, kaiju HP ${k.hp}/${k.max}`);

  // Kaiju steps one tile north (towers either side), then smashes 3 times
  await holdUntil(kaiju, 'KeyW', () => kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z <= 11.05; }));
  await kaiju.evaluate(() => window.__kq.room.send('debugHeal'));   // pristine city: no worn building dies mid-count
  await sleep(300);
  const hp0 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  // damage = the sum of drops only (the tanks repair the worn Save the City! city meanwhile)
  const dropped = (a, b) => a.map((h, i) => Math.max(0, h - b[i])).reduce((x, y) => x + y, 0);
  const hpNow = () => kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  // SPACE no longer smashes
  await kaiju.keyboard.press('Space'); await sleep(1500);
  check(Math.round(dropped(hp0, await hpNow())) === 0, 'SPACE does not smash any more');
  // push-to-smash: hold D (east, into the tower block) until 3 smashes have landed
  await kaiju.keyboard.down('KeyD');
  let wind = 0;
  await until(async () => { wind = Math.max(wind, await kaiju.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).windup; })); return dropped(hp0, await hpNow()) >= 29.99; }, 20000);
  await kaiju.keyboard.up('KeyD');
  await sleep(400);
  const hp1 = await kaiju.evaluate(() => Array.from(window.__kq.room.state.buildingHp));
  const hit = Math.round(dropped(hp0, hp1));
  check(hit >= 30 && hit % 10 === 0, `holding D into the towers smashed them: ${hit} building HP in 10s (wind-up seen ${wind.toFixed(2)})`);
  // Controller: A (button 0) does nothing for the kaiju; pushing the stick into the tower smashes
  await kaiju.evaluate(() => {
    const pad = (a, ax) => ({ axes: [ax, ax, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0 && a, value: i === 0 && a ? 1 : 0 })) });
    window.__pad = pad(false, 0);
    navigator.getGamepads = () => [window.__pad];
    window.__padSet2 = (a, ax) => { window.__pad = pad(a, ax); };
  });
  await sleep(700);
  await kaiju.evaluate(() => window.__padSet2(true, 0));
  await sleep(1500);
  await kaiju.evaluate(() => window.__padSet2(false, 0));
  check(Math.round(dropped(hp1, await hpNow())) === 0, 'controller A does not smash');
  await kaiju.evaluate(() => window.__padSet2(false, 0.7));   // stick down-right on screen = world +x = east, into the towers
  let padHit = 0;
  await until(async () => (padHit = Math.max(padHit, Math.round(dropped(hp1, await hpNow())))) >= 10, 20000);
  await kaiju.evaluate(() => window.__padSet2(false, 0));
  check(padHit >= 10, `controller stick pushed into the tower smashed it: ${padHit} building HP`);
  await kaiju.evaluate(() => { navigator.getGamepads = () => []; });
  await kaiju.screenshot({ path: 'docs/shots/p02-kaiju-smash.png', timeout: 120000 });

  // Phone tank: joystick down-left on screen = south along the ring road → (0,3)
  await stick(phone, -45, 45, () => phone.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).z >= 2.7; }));
  t = await me(phone);
  check(t.z > 2 && Math.abs(t.x) < 0.3, `floating stick (screen-diagonal drag) drove the tank down its street: (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);
  // tap-to-move: tap the street tile (0, 6); the route is planned, drawn and walked
  const tap = await tileOnScreen(phone, 0, 6);
  await phone.mouse.click(tap.x, tap.y);
  await until(() => phone.evaluate(() => { const r = window.__kq.room; return !!r.state.players.get(r.sessionId).route; }), 8000);
  const route = await phone.evaluate(() => { const r = window.__kq.room; return r.state.players.get(r.sessionId).route; });
  // (the camera may still be gliding when the tap lands, so allow a tile either way)
  const endTile = route.split(';').pop().split(',').map(Number);
  check(endTile[0] === 0 && Math.abs(endTile[1] - 6) <= 1, `tap near (0,6) planned a street route: ${route}`);
  await until(() => phone.evaluate(() => { const r = window.__kq.room; return !r.state.players.get(r.sessionId).route; }), 20000);
  t = await me(phone);
  check(Math.abs(t.z - endTile[1]) < 0.25 && Math.abs(t.x - endTile[0]) < 0.25, `tap-to-move arrived at the route's end: (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);
  // park it exactly at the row-3 corner (the slow renderer overshoots by a variable amount)
  await phone.evaluate(() => window.__kq.room.send('debugTeleport', { x: 0, z: 2.8 }));
  check(!(await phone.locator('#kq-boost').count()), 'phone tank has no boost button (tanks have no boost)');
  await phone.locator('#kq-block').dispatchEvent('pointerdown');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.roadblocks.size === 1), 8000);
  const rbCount = await kaiju.evaluate(() => window.__kq.room.state.roadblocks.size);
  check(rbCount === 1, `phone BLOCK button drops a roadblock (${rbCount})`);

  await sleep(800);
  await phone.screenshot({ path: 'docs/shots/p02-phone-edge-arrow.png', timeout: 120000 });
  check(await phone.evaluate(() => !document.getElementById('kq-edge').hidden), 'phone: edge arrow points to the off-screen kaiju');

  // Phone marker over the kaiju: bring the kaiju onto the phone's screen first
  await kaiju.evaluate(() => window.__kq.room.send('debugTeleport', { x: 6, z: 1 }));
  await until(async () => (await phone.locator('.kq-marker:not([hidden])').count()) > 0, 20000);
  const markerOnScreen = (await phone.locator('.kq-marker:not([hidden])').count()) > 0;
  // Kaiju: jump to row 3 (test hook; the slow software renderer makes key-held
  // distances unreliable), then walk west toward the tank with a Shift boost
  await kaiju.evaluate(() => window.__kq.room.send('debugTeleport', { x: 9, z: 3 }));
  await until(() => kaiju.evaluate(() => { const r = window.__kq.room, m = r.state.players.get(r.sessionId); return Math.abs(m.x - 9) < 0.1 && Math.abs(m.z - 3) < 0.1; }), 8000);
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
    // (any time in the chase: with a boost the stomp can land before the first shot is logged)
    if (!markerSeen && (markerOnScreen || (await phone.locator('.kq-marker:not([hidden])').count()) > 0)) {
      markerSeen = true;
      await phone.screenshot({ path: 'docs/shots/p02-phone-marker-firing.png', timeout: 120000 });
      await kaiju.screenshot({ path: 'docs/shots/p02-kaiju-under-fire.png', timeout: 120000 });
    }
  }
  await kaiju.keyboard.up('KeyA');
  k = await me(kaiju); t = await me(phone);
  console.log(`INFO  after the chase: kaiju (${k.x.toFixed(2)}, ${k.z.toFixed(2)}), tank (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) alive=${t.alive}`);
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
  // pick next round's mode from the end screen
  await kaiju.locator('#kq-end [data-mode=evac]').dispatchEvent('click');
  await until(() => kaiju.evaluate(() => window.__kq.room.state.mode === 'evac'), 10000);
  check((await me(kaiju)).mode === 'evac', 'end screen mode picker sets the next round to Evacuation');
  const endText = await kaiju.locator('#kq-end').innerText();
  check(/WIN|TIE/.test(endText), `end screen: "${endText.split('\n')[0]}"`);
  await kaiju.screenshot({ path: 'docs/shots/p02-end-screen.png', timeout: 120000 });
  await phone.screenshot({ path: 'docs/shots/p02-phone-end.png', timeout: 120000 });
  // sounds fired for the events this round had (recorded even if the headless audio device is silent)
  const heard = await kaiju.evaluate(() => [...new Set(window.__kqSfx)]);
  const heardPhone = await phone.evaluate(() => [...new Set(window.__kqSfx)]);
  check(['monster-hit', 'tank-shooting', 'tank-dead'].every(n => heard.includes(n)), `kaiju heard: ${heard.join(', ')}`);
  check(['tank-moving', 'roadblock-placed', 'tank-shooting', 'monster-footsteps'].every(n => heardPhone.includes(n)), `phone tank heard: ${heardPhone.join(', ')}`);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e); ok = false;
} finally {
  await Promise.all(browsers.map(b => b.close())); server.kill();
}
process.exit(ok ? 0 : 1);
