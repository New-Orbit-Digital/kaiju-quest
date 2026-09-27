import * as THREE from 'three';
import { Client } from '@colyseus/sdk';
import { TUNING } from '../../shared/tuning.js';
import { buildCity, fadeOccluders } from './city.js';
import { loadUnitModels, createUnit, TANK_COLOURS } from './units.js';
import { moveVector, onInputChange } from './input.js';
import { createLocalRoom } from './localroom.js';

const params = new URLSearchParams(location.search);
const OFFLINE = !!globalThis.__KQ_OFFLINE || params.has('offline');
// Dev (vite on :5173) talks to the game server on :2567; a deployed build
// is served by the game server itself, so it connects to its own host.
const WS = location.protocol === 'https:' ? 'wss' : 'ws';
const SERVER = params.get('server') || import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? `${WS}://${location.hostname || 'localhost'}:2567` : `${WS}://${location.host}`);

// ── Renderer / scene ───────────────────────────────────────
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = TUNING.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec4e0);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x55603f, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.castShadow = TUNING.shadows;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const camTarget = new THREE.Vector3(12, 0, 12);
let viewTiles = TUNING.viewTilesTank;

function camOffset() {
  const el = TUNING.cameraElevationDeg * Math.PI / 180, az = TUNING.cameraAzimuthDeg * Math.PI / 180;
  const d = 60;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
}
function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h, half = viewTiles / 2;
  renderer.setSize(w, h, false);
  Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ── HUD ────────────────────────────────────────────────────
const hudBody = document.getElementById('hud-body');
const statusEl = document.getElementById('status');
const setStatus = (t) => { statusEl.textContent = t; statusEl.hidden = !t; };

// ── Boot ───────────────────────────────────────────────────
const units = new Map(); // sessionId → { view, display: {x,z,rot} }
let room = null;
let buildingObjects = new Map();

async function boot() {
  const [built] = await Promise.all([buildCity(scene), loadUnitModels()]);
  const { city } = built;
  buildingObjects = built.buildingObjects;
  camTarget.set((city.width - 1) / 2, 0, (city.depth - 1) / 2);
  if (OFFLINE) {
    room = createLocalRoom();
    setStatus('');
    window.__kq = { room, units, camera, scene };
    globalThis.__KQ_READY?.();
    return;
  }
  setStatus('connecting…');
  try {
    const wanted = params.get('role'); // ?role=kaiju | ?role=tank (lobby comes in P03)
    room = await new Client(SERVER).joinOrCreate('match', wanted ? { role: wanted } : {});
  } catch (e) {
    console.error(e);
    setStatus(`could not reach server at ${SERVER}`);
    return;
  }
  setStatus('');
  room.onLeave(() => setStatus('disconnected — reload to rejoin'));
  window.__kq = { room, units, camera, scene }; // handy for debugging + screenshots
}

// ── Sync game state → scene ────────────────────────────────
function syncUnits(dt) {
  if (!room?.state?.players) return;
  const seen = new Set();
  room.state.players.forEach((p, id) => {
    seen.add(id);
    let u = units.get(id);
    if (!u) {
      const view = createUnit(p.role, p.slot, id === room.sessionId);
      scene.add(view.object);
      u = { view, role: p.role, display: { x: p.x, z: p.z, rot: p.rot } };
      units.set(id, u);
    }
    const k = Math.min(1, dt * 15);
    u.display.x += (p.x - u.display.x) * k;
    u.display.z += (p.z - u.display.z) * k;
    let dr = p.rot - u.display.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    u.display.rot += dr * Math.min(1, dt * 12);
    u.view.object.position.set(u.display.x, 0.02, u.display.z);
    u.view.object.rotation.y = u.display.rot;
    u.view.update(dt, p.moving);
  });
  for (const [id, u] of units) {
    if (!seen.has(id)) { scene.remove(u.view.object); units.delete(id); }
  }
}

function updateHud() {
  if (!room?.state?.players) return;
  const me = room.state.players.get(room.sessionId);
  if (!me) return;
  let tanks = 0, kaiju = 0;
  room.state.players.forEach(p => p.role === 'kaiju' ? kaiju++ : tanks++);
  const roleName = me.role === 'kaiju' ? 'KAIJU' : `TANK ${me.slot + 1}`;
  const swatch = me.role === 'tank'
    ? `<span style="color:#${TANK_COLOURS[me.slot].toString(16).padStart(6, '0')}">■</span> ` : '';
  hudBody.innerHTML =
    `You are ${swatch}<span class="role-${me.role}">${roleName}</span><br>` +
    (room.offline ? `Sandbox · no combat yet<br>` : `Kaiju: ${kaiju ? 'in city' : 'none yet'} · Tanks: ${tanks}/${TUNING.maxTanks}<br>`) +
    `Kaiju speed: ${room.state.kaijuSpeed.toFixed(2)} tiles/s<br>` +
    (room.offline
      ? `<span class="dim">WASD move · Tab swap unit<br>C camera: ${TUNING.cameraElevationDeg > 40 ? '50° (steep)' : '35° (true iso)'}<br>V controls: ${TUNING.controlScheme === 'street' ? 'street (W = up-right)' : 'screen (W = up)'}</span>`
      : `<span class="dim">WASD to move · controls: ${TUNING.controlScheme}</span>`);
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

// Sandbox-only keys (offline): Tab swaps unit, C camera angle, V controls.
function clearUnits() { for (const u of units.values()) scene.remove(u.view.object); units.clear(); }
addEventListener('keydown', (e) => {
  if (!room?.offline) return;
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
  const now = performance.now();
  sendInput(now);
  syncUnits(dt);
  updateHud();

  const mine = room && units.get(room.sessionId);
  if (mine) {
    const want = mine.role === 'kaiju' ? TUNING.viewTilesKaiju : TUNING.viewTilesTank;
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
  fadeOccluders(buildingObjects, camera, [...units.values()].map(u => u.display), dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
boot();
frame();
