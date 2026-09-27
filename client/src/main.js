import * as THREE from 'three';
import { Client } from '@colyseus/sdk';
import { TUNING } from '../../shared/tuning.js';
import { buildCity, fadeOccluders } from './city.js';
import { loadUnitModels, createUnit, colourHex } from './units.js';
import { moveVector, onInputChange } from './input.js';
import { createLocalRoom } from './localroom.js';
import { initFx, createBuildingDamage } from './fx.js';
import { createHud } from './hud.js';
import { createTouchControls } from './touch.js';

const params = new URLSearchParams(location.search);
const OFFLINE = !!globalThis.__KQ_OFFLINE || params.has('offline');
// Phones (coarse pointer, no hover) join as tanks with touch controls.
const MOBILE = params.has('mobile') ||
  (matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches);
// Dev (vite on :5173) talks to the game server on :2567; a deployed build
// is served by the game server itself, so it connects to its own host.
const WS = location.protocol === 'https:' ? 'wss' : 'ws';
const SERVER = params.get('server') || import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? `${WS}://${location.hostname || 'localhost'}:2567` : `${WS}://${location.host}`);

if (MOBILE) TUNING.shadows = TUNING.mobileShadows; // phones: cheaper rendering

// ── Renderer / scene ───────────────────────────────────────
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? TUNING.mobilePixelRatio : 2));
renderer.shadowMap.enabled = TUNING.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec4e0);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x55603f, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.castShadow = TUNING.shadows;
sun.shadow.mapSize.set(2048, 2048);
// shadows only around the camera target (tight box = fewer shadow draw calls)
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const camTarget = new THREE.Vector3(12, 0, 12);
let viewTiles = MOBILE ? TUNING.viewTilesMobile : TUNING.viewTilesTank;

function camOffset() {
  const el = TUNING.cameraElevationDeg * Math.PI / 180, az = TUNING.cameraAzimuthDeg * Math.PI / 180;
  const d = 60;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
}
function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h, half = viewTiles / 2;
  renderer.setSize(w, h, false);
  if (aspect < 1) Object.assign(camera, { left: -half, right: half, top: half / aspect, bottom: -half / aspect }); // portrait phones
  else Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ── HUD ────────────────────────────────────────────────────
const hudBody = document.getElementById('hud-body');
const statusEl = document.getElementById('status');
const setStatus = (t) => { statusEl.textContent = t; statusEl.hidden = !t; };
const hud = createHud({ mobile: MOBILE });
const fx = initFx(scene);
const touch = MOBILE ? createTouchControls({ onBoost: () => room?.send('action') }) : null;

// ── Boot ───────────────────────────────────────────────────
const units = new Map();    // sessionId → { view, display: {x,z,rot}, alive }
const squads = new Map();   // `${id}:${i}` → { view, display }
let room = null, city = null;
let buildingObjects = new Map(), damage = null;

async function boot() {
  const [built] = await Promise.all([buildCity(scene), loadUnitModels()]);
  city = built.city;
  buildingObjects = built.buildingObjects;
  damage = createBuildingDamage(scene, city, buildingObjects);
  camTarget.set((city.width - 1) / 2, 0, (city.depth - 1) / 2);
  if (OFFLINE) {
    room = createLocalRoom();
  } else {
    setStatus('connecting…');
    try {
      const wanted = params.get('role'); // ?role=kaiju | ?role=tank (lobby comes in P03)
      room = await new Client(SERVER).joinOrCreate('match', { role: wanted || undefined, mobile: MOBILE });
    } catch (e) {
      console.error(e);
      setStatus(/full|locked/i.test(String(e?.message)) ? 'This match is full — try again after a round ends'
                                                        : `could not reach the game server (${SERVER})`);
      return;
    }
    room.onLeave(() => setStatus('disconnected — reload to rejoin'));
  }
  setStatus('');
  room.onMessage('fx', onFx);
  window.__kq = { room, units, squads, camera, scene, renderer, mobile: MOBILE }; // debugging + screenshots
}

// ── Effects from the server ────────────────────────────────
function kaijuEntry() {
  for (const [id, u] of units) if (u.role === 'kaiju') return u;
  return null;
}
function onFx(e) {
  const k = kaijuEntry();
  switch (e.type) {
    case 'shot': {
      if (!k) break;
      const from = e.kind === 'tank' ? units.get(e.id) : squads.get(`${e.id}:${e.i}`);
      if (!from) break;
      const y = e.kind === 'tank' ? 0.28 : 0.2;
      const jitter = () => (Math.random() - 0.5) * 0.5;
      fx.tracer({ x: from.display.x, y, z: from.display.z },
                { x: k.display.x + jitter(), y: 0.7 + Math.random() * 0.5, z: k.display.z + jitter() },
                e.kind === 'tank' ? 0xffd66b : 0xfff1b0);
      k.view.hit(e.kind === 'tank' ? 1 : 0.3);
      break;
    }
    case 'strike':
      k?.view.attack();
      if (e.bid >= 0 && city) { const b = city.buildings[e.bid]; fx.dust(b.cx, b.cz, 0.7 * b.size); }
      break;
    case 'destroyed':
      if (city) { const b = city.buildings[e.bid]; fx.dust(b.cx, b.cz, 1.6 * b.size); fx.blast(b.cx, b.cz, 0.8 * b.size, 0x9a8f80); }
      break;
    case 'tankDown': fx.blast(e.x, e.z, 1.2); break;
    case 'soldierDown': fx.blast(e.x, e.z, 0.35, 0xc0392b); break;
    case 'end': if (e.winner === 'tanks') k?.view.die(); break;
    case 'start': k?.view.revive(); break;
  }
}

// ── Sync game state → scene ────────────────────────────────
function follow(entry, p, dt) {
  const k = Math.min(1, dt * 15);
  const d = entry.display;
  if (Math.hypot(p.x - d.x, p.z - d.z) > 3) { d.x = p.x; d.z = p.z; } // teleports (respawn) snap
  d.x += (p.x - d.x) * k; d.z += (p.z - d.z) * k;
  let dr = p.rot - d.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
  d.rot += dr * Math.min(1, dt * 12);
  entry.view.object.position.set(d.x, 0.02, d.z);
  entry.view.object.rotation.y = d.rot;
}

function syncUnits(dt) {
  if (!room?.state?.players) return;
  const seen = new Set(), seenSquad = new Set();
  room.state.players.forEach((p, id) => {
    seen.add(id);
    let u = units.get(id);
    if (!u) {
      const view = createUnit(p.role, p.slot, id === room.sessionId);
      scene.add(view.object);
      u = { view, role: p.role, display: { x: p.x, z: p.z, rot: p.rot } };
      units.set(id, u);
    }
    u.alive = p.alive;
    u.view.object.visible = p.role === 'kaiju' || p.alive;
    follow(u, p, dt);
    u.view.update(dt, p.moving);

    (p.soldiers || []).forEach((s, i) => {
      const key = `${id}:${i}`;
      seenSquad.add(key);
      let e = squads.get(key);
      if (!e) {
        const view = createUnit('soldier', p.slot, false);
        scene.add(view.object);
        e = { view, display: { x: s.x, z: s.z, rot: s.rot } };
        squads.set(key, e);
      }
      e.view.object.visible = s.alive;
      if (!s.alive) return;
      const moving = Math.hypot(s.x - e.display.x, s.z - e.display.z) > 0.01;
      follow(e, s, dt);
      e.view.update(dt, moving, s.firing);
    });
  });
  for (const [id, u] of units) if (!seen.has(id)) { scene.remove(u.view.object); units.delete(id); }
  for (const [key, e] of squads) if (!seenSquad.has(key)) { scene.remove(e.view.object); squads.delete(key); }
}

function updateSideHud(me) {
  if (!me) return;
  const roleName = me.role === 'kaiju' ? 'KAIJU' : `TANK ${me.slot + 1}`;
  const swatch = me.role === 'tank' ? `<span style="color:${colourHex(me.slot)}">■</span> ` : '';
  let tanks = 0;
  room.state.players.forEach(p => { if (p.role === 'tank') tanks++; });
  const help = me.role === 'kaiju'
    ? 'WASD move · SPACE smash the building beside you<br>Walk into tanks & soldiers to crush them'
    : 'WASD move · turret fires on its own<br>SPACE boost (15s cooldown)';
  hudBody.innerHTML =
    `You are ${swatch}<span class="role-${me.role}">${roleName}</span><br>` +
    `Tanks: ${tanks}/${TUNING.maxTanks} · Kaiju speed ${room.state.kaijuSpeed.toFixed(2)}<br>` +
    `<span class="dim">${help}` +
    (room.offline ? `<br>Tab swap unit · C camera · V controls` : '') + `</span>`;
}

// ── Input → server ─────────────────────────────────────────
let lastSent = '', lastSendAt = 0;
function sendInput(now) {
  if (!room) return;
  const v = moveVector();
  const key = `${v.x},${v.z}`;
  if (key !== lastSent || now - lastSendAt > 250) {
    room.send('input', v);
    lastSent = key; lastSendAt = now;
  }
}
onInputChange(() => sendInput(performance.now())); // react on the key event, not the next frame

function clearUnits() {
  for (const u of units.values()) scene.remove(u.view.object);
  for (const e of squads.values()) scene.remove(e.view.object);
  units.clear(); squads.clear();
}
addEventListener('keydown', (e) => {
  if (!room) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) room.send('action'); } // smash / boost
  if (!room.offline) return;
  // Sandbox-only keys: Tab swaps unit, C camera angle, V controls.
  if (e.code === 'Tab') {
    e.preventDefault();
    room.cycle(e.shiftKey ? -1 : 1);
    clearUnits(); // rebuild so the "you" ring moves to the new unit
    lastSent = '';
  } else if (e.code === 'KeyC') {
    TUNING.cameraElevationDeg = TUNING.cameraElevationDeg > 40 ? 35.264 : 50;
  } else if (e.code === 'KeyV') {
    TUNING.controlScheme = TUNING.controlScheme === 'street' ? 'screen' : 'street';
    lastSent = '';
  }
});

// ── Loop ───────────────────────────────────────────────────
const timer = new THREE.Timer();
function frame(ts) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  sendInput(performance.now());
  syncUnits(dt);
  fx.update(dt);
  damage?.sync(room?.state?.buildingHp, dt);

  const me = room?.state?.players?.get(room.sessionId);
  const mine = room && units.get(room.sessionId);
  if (mine) {
    const want = MOBILE ? TUNING.viewTilesMobile : mine.role === 'kaiju' ? TUNING.viewTilesKaiju : TUNING.viewTilesTank;
    if (want !== viewTiles) { viewTiles = want; resize(); }
    const k = Math.min(1, dt * TUNING.cameraFollow);
    camTarget.x += (mine.display.x - camTarget.x) * k;
    camTarget.z += (mine.display.z - camTarget.z) * k;
  }
  camera.position.copy(camTarget).add(camOffset());
  camera.lookAt(camTarget);
  sun.position.copy(camTarget).add(new THREE.Vector3(-12, 25, 8));
  sun.target.position.copy(camTarget);
  camera.updateMatrixWorld();
  fadeOccluders(buildingObjects, camera,
    [...units.values()].filter(u => u.role === 'kaiju' || u.alive).map(u => u.display), dt);

  if (me) {
    updateSideHud(me);
    hud.update({ state: room.state, me, myId: room.sessionId, camera, units });
    touch?.update(me);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
boot();
requestAnimationFrame(frame);
