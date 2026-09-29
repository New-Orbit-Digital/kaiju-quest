// Screenshots of each mode (docs/shots/p06-*.png) with a desktop player and an
// emulated phone in a private room, bots filling the rest. Visual check only.
import { chromium, devices } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const PORT = 2601;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
mkdirSync('docs/shots', { recursive: true });
if (!process.argv.includes('--no-build')) execSync('npm run build --prefix client', { stdio: 'ignore' });
const server = spawn('node', ['server/src/index.js'], { env: { ...process.env, PORT: String(PORT), KQ_TEST: '1' }, stdio: 'ignore' });
await sleep(2000);
const launch = () => chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const until = async (f, ms = 60000) => { const t0 = Date.now(); while (!(await f()) && Date.now() - t0 < ms) await sleep(100); };
const out = (m) => console.log(m);
try {
  const bd = await launch(), bp = await launch();
  const desk = await (await bd.newContext({ viewport: { width: 1100, height: 620 } })).newPage();
  desk.on('pageerror', e => errors.push(`desk: ${e.message}`));
  await desk.goto(`http://localhost:${PORT}/?name=Rex&create`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await desk.waitForFunction(() => window.__kq?.room?.state?.code, null, { timeout: 120000 });
  const code = await desk.evaluate(() => window.__kq.room.state.code);
  out(`room ${code}`);
  const phone = await (await bp.newContext({ ...devices['Pixel 7 landscape'], deviceScaleFactor: 1 })).newPage();
  phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
  await phone.goto(`http://localhost:${PORT}/?name=Pat&room=${code}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await phone.waitForFunction(() => window.__kq?.room?.state?.players?.size >= 2, null, { timeout: 120000 });
  const send = (p, type, msg) => p.evaluate(([t, m]) => window.__kq.room.send(t, m), [type, msg]);
  const phase = (p) => p.evaluate(() => window.__kq.room.state.phase);

  // 1) King of the Hill: phone is a kaiju too
  await send(desk, 'mode', { mode: 'koth' });
  await send(desk, 'addBot', { role: 'kaiju' });
  await sleep(500);
  const roles = await phone.evaluate(() => [...window.__kq.room.state.players.values()].map(p => p.role + ':' + p.slot).join(','));
  out(`koth roles ${roles}`);
  await send(desk, 'ready', { ready: true }); await send(phone, 'ready', { ready: true });
  await until(async () => (await phase(desk)) === 'playing');
  await sleep(6000);
  await phone.screenshot({ path: 'docs/shots/p06-koth-phone-kaiju.png', timeout: 120000 });
  await desk.screenshot({ path: 'docs/shots/p06-koth-desktop.png', timeout: 120000 });
  const phoneButtons = await phone.evaluate(() => ['kq-kboost', 'kq-block'].map(id => `${id}:${!document.getElementById(id)?.hidden}`).join(' '));
  out(`phone kaiju buttons ${phoneButtons}`);

  await desk.close(); await phone.close();
  // 2) Points race with a crate, in a fresh private room
  const desk2 = await (await bd.newContext({ viewport: { width: 1100, height: 620 } })).newPage();
  await desk2.goto(`http://localhost:${PORT}/?name=Rex2&create`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await desk2.waitForFunction(() => window.__kq?.room?.state?.code, null, { timeout: 120000 });
  await send(desk2, 'addBot', { role: 'tank' }); await send(desk2, 'addBot', { role: 'tank' });
  await send(desk2, 'ready', { ready: true });
  await until(async () => (await phase(desk2)) === 'playing');
  await send(desk2, 'debugTeleport', { x: 15, z: 9 });
  await send(desk2, 'debugCrate', {});
  await sleep(5000);
  await desk2.screenshot({ path: 'docs/shots/p06-race-crate.png', timeout: 120000 });
  out(`race hud: ${await desk2.evaluate(() => document.getElementById('kq-top').innerText.replace(/\s+/g, ' '))}`);

  await desk2.close();
  // 3) Evacuation
  const desk3 = await (await bd.newContext({ viewport: { width: 1100, height: 620 } })).newPage();
  await desk3.goto(`http://localhost:${PORT}/?name=Rex3&create`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await desk3.waitForFunction(() => window.__kq?.room?.state?.code, null, { timeout: 120000 });
  await send(desk3, 'mode', { mode: 'evac' });
  await send(desk3, 'addBot', { role: 'tank' }); await send(desk3, 'addBot', { role: 'tank' });
  await send(desk3, 'ready', { ready: true });
  await until(async () => (await phase(desk3)) === 'playing');
  await sleep(15000);
  await desk3.screenshot({ path: 'docs/shots/p06-evac.png', timeout: 120000 });
  out(`evac hud: ${await desk3.evaluate(() => document.getElementById('kq-top').innerText.replace(/\s+/g, ' '))} · civilians ${await desk3.evaluate(() => window.__kq.room.state.civilians.size)}`);
  await bd.close(); await bp.close();
} catch (e) { console.error(e); } finally {
  server.kill();
  out(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}
process.exit(0);
