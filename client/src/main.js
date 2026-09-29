import * as THREE from 'three';
import { Client } from '@colyseus/sdk';
import { TUNING } from '../../shared/tuning.js';
import { buildCity, fadeOccluders } from './city.js';
import { loadUnitModels, createUnit, colourHex, kaijuHex, TANK_COLOURS } from './units.js';
import { moveVector, onInputChange, pollGamepad, usingGamepad, keyNames, setPadUiMode } from './input.js';
import { createLocalRoom } from './localroom.js';
import { initFx, createBuildingDamage, createRoadblocks, createHill, createExits, createCrate } from './fx.js';
import { initAudio, play as sfx, loop as sfxLoop, setListener, toggleMute, isMuted } from './audio.js';
import { EXITS } from '../../shared/map.js';
import { MODE_NAMES, BETA_MODES } from '../../shared/game.js';
import { createHud } from './hud.js';
import { createTouchControls } from './touch.js';
import { createCivilianPaths, createRouteMarks } from './paths.js';
import { stepUnit } from '../../shared/sim.js';

const params = new URLSearchParams(location.search);
const OFFLINE = !!globalThis.__KQ_OFFLINE || params.has('offline');
// Phones join as tanks with touch controls. A touch device counts as a phone
// only if its main pointer is a finger AND the screen is phone/tablet-sized, so
// touchscreen laptops and desktops stay desktop. ?mobile / ?desktop override.
const MOBILE = !params.has('desktop') && (params.has('mobile') ||
  (matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches &&
   navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) <= 900));
// Dev (vite on :5173) talks to the game server on :2567; a deployed build
// is served by the game server itself, so it connects to its own host.
const WS = location.protocol === 'https:' ? 'wss' : 'ws';
const SERVER = params.get('server') || import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? `${WS}://${location.hostname || 'localhost'}:2567` : `${WS}://${location.host}`);
const HTTP = SERVER.replace(/^ws/, 'http');   // same server, for the room-code lookup
// The free Render server sleeps when idle: poke it as soon as the page opens so
// it's awake by the time the player has typed a name.
if (!OFFLINE) fetch(`${HTTP}/health`).catch(() => {});

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
const touch = MOBILE ? createTouchControls({ surface: canvas, onTap: (x, y) => tapAt(x, y), onBlock: () => room?.send('block'), onBoost: () => room?.send('boost') }) : null;
const civPaths = createCivilianPaths(scene);
let routeMarks = null;   // needs the city: made in boot()
const roadblocks = createRoadblocks(scene, (slot) => TANK_COLOURS[Math.max(0, slot) % TANK_COLOURS.length]);
const hill = createHill(scene, TUNING.hillRadius);
const crate = createCrate(scene);
let exits = null;
initAudio();
hud.onMute(() => toggleMute(), isMuted());

// ── Boot ───────────────────────────────────────────────────
const units = new Map();    // sessionId → { view, display: {x,z,rot}, alive }
const civilians = new Map(); // civilian id → { view, display }
let room = null, city = null, wantedRole = null, roleNoticeDone = false, codeInUrl = false;
let buildingObjects = new Map(), damage = null;

async function boot() {
  const [built] = await Promise.all([buildCity(scene), loadUnitModels()]);
  city = built.city;
  buildingObjects = built.buildingObjects;
  damage = createBuildingDamage(scene, city, buildingObjects);
  exits = createExits(scene, EXITS, city);
  routeMarks = createRouteMarks(scene, city);
  camTarget.set((city.width - 1) / 2, 0, (city.depth - 1) / 2);
  if (OFFLINE) {
    room = createLocalRoom();
  } else {
    // Everyone enters a name first (?name= skips it), then picks PLAY (any public
    // game), CREATE ROOM (private, with a code) or joins a code / share link (?room=).
    // Sides are picked in the lobby; ?role=kaiju / ?role=tank sets a preference.
    const wanted = params.get('role') || undefined;
    wantedRole = wanted;
    const client = new Client(SERVER);
    const opts = (name) => ({ role: wanted, mobile: MOBILE, name });
    let pickCode = (params.get('room') || '').toUpperCase(), note = '';
    for (;;) {
      const choice = params.get('name') && !note
        ? { name: params.get('name'), how: pickCode ? 'code' : (params.has('create') ? 'create' : 'public'), code: pickCode }
        : await hud.askJoin({ code: pickCode, note });
      setStatus('connecting…');
      try {
        if (choice.how === 'create') room = await client.create('match', { ...opts(choice.name), private: true });
        else if (choice.how === 'code') {
          const r = await fetch(`${HTTP}/room/${encodeURIComponent(choice.code)}`);
          if (r.status === 404) throw new Error('not-found');
          room = await client.joinById((await r.json()).roomId, opts(choice.name));
        } else room = await client.joinOrCreate('match', opts(choice.name));
        break;
      } catch (e) {
        console.warn(e);
        const msg = String(e?.message || e);
        pickCode = choice.how === 'code' ? choice.code : '';
        note = msg === 'not-found' ? `No game with the code ${choice.code}. Check it, or start your own.`
          : /full|locked/i.test(msg) ? `Room ${choice.code || ''} is full. Play a public game or create your own room.`
          : `Couldn't reach the game server (${SERVER}). Try again in a minute — it may be waking up.`;
        setStatus('');
      }
    }
    room.onLeave((code) => setStatus(code === 4001 ? 'You were removed from the lobby — reload to rejoin'
                                                   : 'disconnected — reload to rejoin'));
    hud.onLobby({
      ready: (r) => room.send('ready', { ready: r }),
      role: (r) => room.send('role', { role: r }),
      kick: (id) => room.send('kick', { id }),
      addBot: (role) => room.send('addBot', { role }),
      mode: (m) => room.send('mode', { mode: m }),
      shareLink: () => { const u = new URL(location.href); u.search = ''; u.searchParams.set('room', room.state.code); return u.toString(); },
    });
  }
  setStatus('');
  room.onMessage('fx', onFx);
  if (OFFLINE) hud.onLobby({ mode: (m) => room.send('mode', { mode: m }) });
  window.__kq = { room, units, civilians, camera, scene, renderer, mobile: MOBILE, city, moveVector, civPaths, touch }; // debugging + screenshots
}

// ── Effects from the server ────────────────────────────────
function kaijuEntry() {
  for (const [id, u] of units) if (u.role === 'kaiju') return u;
  return null;
}
const myRoleNow = () => room?.state?.players?.get(room.sessionId)?.role;
function onFx(e) {
  const k = (e.target && units.get(e.target)) || kaijuEntry();
  switch (e.type) {
    case 'shot': {
      if (!k) break;
      const from = units.get(e.id);
      if (!from) break;
      const jitter = () => (Math.random() - 0.5) * 0.5;
      if (e.blocked) {   // a building took the shell: tracer to its wall, a puff, no damage
        fx.tracer({ x: from.display.x, y: 0.28, z: from.display.z }, { x: e.x, y: 0.3 + Math.random() * 0.2, z: e.z }, 0xffd66b);
        fx.dust(e.x, e.z, 0.35, 0x8a8f98);
      } else {
        fx.tracer({ x: from.display.x, y: 0.28, z: from.display.z },
                  { x: k.display.x + jitter(), y: 0.7 + Math.random() * 0.5, z: k.display.z + jitter() }, 0xffd66b);
        k.view.hit(1);
      }
      sfx('tank-shooting', 0.8, from.display);
      break;
    }
    case 'strike':
      units.get(e.id)?.view.attack();
      if (e.hitKaiju) units.get(e.hitKaiju)?.view.hit(1.5);
      if (e.bid >= 0 && city) { const b = city.buildings[e.bid]; fx.dust(b.cx, b.cz, 0.7 * b.size); }
      if (e.bid >= 0 || e.roadblock || e.hitKaiju) sfx('monster-hit', 1, { x: e.x, z: e.z });   // only hits that land
      break;
    case 'destroyed':
      if (city) {
        const b = city.buildings[e.bid]; fx.dust(b.cx, b.cz, 1.6 * b.size); fx.blast(b.cx, b.cz, 0.8 * b.size, 0x9a8f80);
        sfx('building-destroyed', 1, { x: b.cx, z: b.cz });
        if (e.hill && e.id === room.sessionId) hud.toast(`ZONE BONUS ×${TUNING.hillMultiplier}  ★ ${Math.round(e.points)}`, 2);
      }
      break;
    case 'tankDown': fx.blast(e.x, e.z, 1.2); sfx('tank-dead', 1, { x: e.x, z: e.z }); break;
    case 'repair':
      if (city) { const b = city.buildings[e.bid]; fx.repair(b.cx, b.cz, b.size); }
      break;
    case 'roadblock': fx.dust(e.x, e.z, 0.4); sfx('roadblock-placed', 1, { x: e.x, z: e.z }); break;
    case 'roadblockRecycled':   // only the tank that dropped it sees the note
      if (e.id === room.sessionId) { const u = units.get(e.id); if (u) hud.floatText(camera, u.display.x, 0.9, u.display.z, 'oldest roadblock removed'); }
      break;
    case 'rebuilt':
      if (city) { const b = city.buildings[e.bid]; fx.dust(b.cx, b.cz, 1.2 * b.size, 0xd8d2c4); fx.repair(b.cx, b.cz, b.size); }
      break;
    case 'roadblockDown': fx.dust(e.x, e.z, 0.7); fx.blast(e.x, e.z, 0.4, 0xd9412b); break;
    case 'civilianDown': fx.blast(e.x, e.z, 0.35, 0xc0392b); break;
    case 'escaped': fx.repair(e.x, e.z, 0.6); break;
    case 'mode': {
      const label = `${MODE_NAMES[e.mode]}${BETA_MODES.has(e.mode) ? ' (beta)' : ''}`;
      hud.toast(e.by && !OFFLINE ? `${e.by} picked ${label}.` : `Mode: ${label}`, 4);
      break;
    }
    case 'kaijuDown': {
      const u = units.get(e.id);
      fx.blast(e.x, e.z, 2, 0x7dff8a);
      sfx('building-destroyed', 1, { x: e.x, z: e.z });
      if (e.id === room.sessionId) hud.toast(myRoleNow() === 'kaiju' && room.state.mode === 'koth' ? 'Knocked out! Back soon.' : 'Down! You\'ll be back in a few seconds.', 3);
      u?.view.die();
      break;
    }
    case 'kaijuKill':
      hud.toast(`KAIJU DOWN · tanks +${Math.round(e.points)} · repairs ×${TUNING.deathRepairBoost} for ${TUNING.deathRepairSeconds}s`, 4);
      break;
    case 'kaijuUp': units.get(e.id)?.view.revive(); break;
    case 'hill': if (room.state.phase === 'playing') { sfx('red-alert', 1); hud.toast('The red zone moved!', 2); } break;
    case 'crateSpawn': hud.toast('A bonus crate dropped. Grab it to tilt the scoring!', 3); sfx('red-alert', 1); break;
    case 'crate': {
      const mine = room.state.players.get(room.sessionId);
      const ours = mine && (e.side === 'kaiju') === (mine.role === 'kaiju');
      hud.toast(`${ours ? 'YOUR SIDE' : e.side === 'kaiju' ? 'KAIJU' : 'TANKS'} GOT THE CRATE: ×${TUNING.crateFavor} points for ${TUNING.crateBonusSeconds}s`, 4);
      fx.blast(e.x, e.z, 0.8, 0xf5b82e); sfx('monster-hit', 1, { x: e.x, z: e.z });
      break;
    }
    case 'start': for (const u of units.values()) if (u.role === 'kaiju') u.view.revive(); break;
    case 'kaijuReplaced':
      if (e.id === room.sessionId) hud.toast('You were AFK, so another player took over the kaiju. You\'re a tank now.', 8);
      break;
    case 'kicked':
      if (e.id !== room.sessionId) hud.toast(`${e.by || 'Someone'} removed a player from the lobby.`, 4);
      break;
  }
}

// ── Sync game state → scene ────────────────────────────────
function follow(entry, p, dt, exact = false) {
  const k = exact ? 1 : Math.min(1, dt * 15);
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
  const seen = new Set();
  room.state.players.forEach((p, id) => {
    seen.add(id);
    let u = units.get(id);
    if (u && (u.role !== p.role || u.slot !== p.slot)) { scene.remove(u.view.object); units.delete(id); u = null; } // role / colour changed
    if (!u) {
      const view = createUnit(p.role, p.slot, id === room.sessionId);
      scene.add(view.object);
      u = { view, role: p.role, slot: p.slot, display: { x: p.x, z: p.z, rot: p.rot } };
      units.set(id, u);
    }
    u.alive = p.alive;
    // a kaiju lies down while it's out, and stands back up when it respawns / a round starts
    if (p.role === 'kaiju') { if (p.alive && u.view.dead) u.view.revive(); else if (!p.alive && !u.view.dead) u.view.die(); }
    u.view.object.visible = p.role === 'kaiju' || p.alive;
    if (id === room.sessionId && predictMine(u, p, dt)) follow(u, u.pred, dt, true);
    else follow(u, p, dt);
    u.view.update(dt, id === room.sessionId && u.pred ? u.pred.moving || p.moving : p.moving);
    if (id === room.sessionId) u.view.setCharge(p.role === 'kaiju'
      ? 1 - p.boostIn / TUNING.boostCooldown : 1 - p.blockIn / TUNING.roadblockCooldown, dt);
  });
  // Evacuation civilians
  const seenCiv = new Set();
  room.state.civilians?.forEach((c, id) => {
    seenCiv.add(id);
    let e = civilians.get(id);
    if (!e) {
      const view = createUnit('civilian', c.look, false);
      scene.add(view.object);
      e = { view, display: { x: c.x, z: c.z, rot: c.rot } };
      civilians.set(id, e);
    }
    follow(e, c, dt);
    e.view.update(dt, c.moving);
  });
  for (const [id, u] of units) if (!seen.has(id)) { scene.remove(u.view.object); units.delete(id); }
  for (const [key, e] of civilians) if (!seenCiv.has(key)) { scene.remove(e.view.object); civilians.delete(key); }
}

function updateSideHud(me) {
  if (!me) return;
  const roleName = me.role === 'kaiju' ? 'KAIJU' : `TANK ${me.slot + 1}`;
  const swatch = me.role === 'tank' ? `<span style="color:${colourHex(me.slot)}">■</span> `
    : me.slot >= 0 ? `<span style="color:${kaijuHex(me.slot)}">■</span> ` : '';
  let tanks = 0;
  room.state.players.forEach(p => { if (p.role === 'tank') tanks++; });
  const k = keyNames();
  const mode = room.state.mode;
  const help = me.role === 'kaiju'
    ? `${k.move} move · stomp on buildings to smash${MOBILE ? ' (or tap one)' : ''} · ${k.boost} boost<br>` + (mode === 'koth'
      ? `Smash buildings (×${TUNING.hillMultiplier} in the red zone) and other kaiju`
      : `Walk into tanks${mode === 'evac' ? ' & civilians' : ''} to crush them`)
    : `${k.move} move · turret fires on its own (not through buildings)<br>${k.block} drop roadblock<br>` +
      (mode === 'race' ? 'Repair damaged buildings and kill the kaiju for points' : 'Drive near damaged buildings to repair them');
  hudBody.innerHTML =
    `You are ${swatch}<span class="role-${me.role}">${roleName}</span><br>` +
    `Mode: ${MODE_NAMES[mode] || ''}${BETA_MODES.has(mode) ? ' (beta)' : ''}<br>` +
    (mode === 'koth' ? `Kaiju: ${room.state.players.size}/${1 + TUNING.maxTanks}<br>`
      : `Tanks: ${tanks}/${TUNING.maxTanks} · Kaiju speed ${room.state.kaijuSpeed.toFixed(2)}<br>`) +
    `<span class="dim">${help}` +
    (room.offline ? (usingGamepad() ? `<br>Y swap unit` : `<br>Tab swap unit · N mode · C camera · V controls`) : '') +
    `<br>M sound ${isMuted() ? 'off' : 'on'}</span>`;
}

// ── Tap to move (phones) ───────────────────────────────────
// A tap on a standing building (not one faded out in front of you) targets that
// building; anywhere else, the ground tile under the finger.
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function tapAt(clientX, clientY) {
  if (!room || !city) return;
  const me = room.state?.players?.get(room.sessionId);
  if (!me || !me.alive) return;
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hp = room.state.buildingHp;
  const targets = [...buildingObjects.entries()]
    .filter(([id, g]) => (hp?.[id] ?? 1) > 0 && (g.userData.fade ?? 1) > 0.5 && city.buildings[id].kind !== 'park')
    .map(([, g]) => g);
  const hit = raycaster.intersectObjects(targets, true)[0];
  let tile = null;
  if (hit) {
    let o = hit.object;
    while (o && o.userData.buildingId === undefined) o = o.parent;
    if (o) { const b = city.buildings[o.userData.buildingId]; tile = { x: b.x, z: b.z }; }
  }
  if (!tile) {
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(ground, pt)) return;
    tile = { x: Math.round(pt.x), z: Math.round(pt.z) };
  }
  room.send('moveTo', tile);
  fx.dust(tile.x, tile.z, 0.25, 0xf2f5f8);
}

// ── Client-side prediction (your own unit) ─────────────────
// Your unit moves the moment you press, using the same movement code as the
// server, then eases onto the server's position. Error inside the expected lag
// (speed × predictionLag) is left alone so the unit doesn't get pulled back.
const phoneHelp = { lookahead: TUNING.mobileCornerLookahead, nudge: TUNING.mobileCornerNudge };
function predictMine(u, p, dt) {
  const st = room.state;
  const skip = !TUNING.clientPrediction || room.offline || !p.alive || p.route || p.boosting || st.phase === 'ended' || !city;
  if (skip) { u.pred = null; return false; }
  if (!u.pred || u.pred.role !== p.role || Math.hypot(u.pred.x - p.x, u.pred.z - p.z) > 2) {
    u.pred = { role: p.role, x: p.x, z: p.z, rot: p.rot, moving: p.moving };
  }
  const kaiju = p.role === 'kaiju';
  const hpList = st.buildingHp;
  const destroyed = (id) => city.buildings[id].kind !== 'park' && hpList[id] <= 0;
  const blocked = kaiju ? (tx, tz) => st.roadblocks.has(`${tx},${tz}`) : null;
  const speed = kaiju ? st.kaijuSpeed : TUNING.tankSpeed;
  const v = moveVector();
  const pushing = Math.hypot(v.x, v.z) > 0.01;
  u.pred.moving = stepUnit(city, u.pred, pushing ? v : null, dt, speed, kaiju ? TUNING.kaijuRadius : TUNING.tankRadius,
    destroyed, blocked, MOBILE ? phoneHelp : null);
  const ex = p.x - u.pred.x, ez = p.z - u.pred.z, e = Math.hypot(ex, ez);
  const budget = pushing ? speed * TUNING.predictionLag : 0;
  if (e > budget) {
    const k = (1 - budget / e) * Math.min(1, dt * (pushing ? 6 : 8));
    u.pred.x += ex * k; u.pred.z += ez * k;
  }
  if (!pushing) u.pred.rot = p.rot;
  return true;
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

function myRole() { return room?.state?.players?.get(room.sessionId)?.role; }

// Controller buttons (standard layout). A / ✕ / Switch-B (0) = tank roadblock
// (the kaiju smashes by pushing into buildings). Kaiju boost = right face
// button (1), RB/R1 (5) or RT/R2 (7).
function gamepadButtons() {
  const pressed = pollGamepad();
  // Menus (join screen, lobby, end screen): the D-pad moves between buttons and
  // A (✕ on PlayStation) presses the highlighted one. The stick still moves you.
  const menu = hud.padMenuOpen();
  setPadUiMode(menu);
  if (menu) {
    for (const b of pressed) {
      if (b >= 12 && b <= 15) hud.padNav(['up', 'down', 'left', 'right'][b - 12]);
      else if (b === 0) hud.padAccept();
      else if (b === 9 && room && !room.offline && room.state.phase === 'lobby') room.send('ready', { ready: !room.state.players.get(room.sessionId)?.ready });
    }
    return;
  }
  hud.padNav(null);
  if (!room || !pressed.length) return;
  const tank = myRole() === 'tank';
  for (const b of pressed) {
    if (b === 0 && tank) room.send('block');
    else if (!tank && (b === 1 || b === 5 || b === 7)) room.send('boost');
    else if (b === 9 && !room.offline && room.state.phase === 'lobby') { // Start / Menu / +: toggle ready
      room.send('ready', { ready: !room.state.players.get(room.sessionId)?.ready });
    }
    else if (room.offline && b === 3) { room.cycle(1); clearUnits(); lastSent = ''; } // Y: swap unit (sandbox)
  }
}

function clearUnits() {
  for (const u of units.values()) scene.remove(u.view.object);
  for (const e of civilians.values()) scene.remove(e.view.object);
  units.clear(); civilians.clear();
}
addEventListener('keydown', (e) => {
  if (!room) return;
  // Kaiju: Shift = boost (it smashes by pushing into buildings). Tank: Space = roadblock.
  const isShift = e.code === 'ShiftLeft' || e.code === 'ShiftRight';
  if (e.code === 'Space') e.preventDefault();
  if (!e.repeat && (e.code === 'Space' || isShift)) {
    const tank = myRole() === 'tank';
    if (e.code === 'Space' && tank) room.send('block');
    else if (!tank) room.send('boost');
  }
  if (e.code === 'KeyM' && !e.repeat) { toggleMute(); hud.setMuted(isMuted()); }
  if (!room.offline) return;
  // Sandbox-only keys: Tab swaps unit, N game mode, C camera angle, V controls.
  if (e.code === 'KeyN' && !e.repeat) room.send('mode', { next: true });
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

// ── Sound loops (single sources, volume follows the game each frame) ──
function updateSound() {
  const st = room?.state, me = st?.players?.get(room.sessionId);
  setListener(camTarget.x, camTarget.z);
  if (!st || !me) return;
  const live = st.phase !== 'ended';
  // kaiju footsteps: everyone hears the nearest walking kaiju, fading with distance
  let near = null, nearD = Infinity;
  st.players.forEach((p, id) => {
    if (p.role !== 'kaiju' || !p.moving || !p.alive) return;
    const u = units.get(id); if (!u) return;
    const d = Math.hypot(u.display.x - camTarget.x, u.display.z - camTarget.z);
    if (d < nearD) { nearD = d; near = u; }
  });
  sfxLoop('monster-footsteps', near && live ? 1 : 0, near?.display);
  // your own tank's engine and repair hum (only you hear them, so they never stack)
  const myTank = me.role === 'tank' && me.alive && live;
  sfxLoop('tank-moving', myTank && me.moving ? 1 : 0);
  sfxLoop('building-repair', myTank && me.repairing ? 1 : 0);
  // Evacuation: a crowd murmur that swells the more civilians are around you
  let crowd = 0;
  if (st.mode === 'evac' && st.phase === 'playing') {
    const mine = units.get(room.sessionId)?.display || camTarget;
    st.civilians.forEach(c => { if (Math.hypot(c.x - mine.x, c.z - mine.z) < TUNING.crowdHearing) crowd++; });
    crowd = 0.08 + 0.92 * Math.min(1, crowd / TUNING.crowdFull);
  }
  sfxLoop('crowd-shouting', crowd);
  // rustling leaves: the nearest unit pushing through a park
  let leaves = null, leavesD = Infinity;
  if (city) st.players.forEach((p, id) => {
    if (!p.moving || !p.alive) return;
    const bid = city.owner[Math.round(p.z)]?.[Math.round(p.x)];
    if (bid === undefined || bid < 0 || city.buildings[bid].kind !== 'park') return;
    const u = units.get(id); if (!u) return;
    const d = Math.hypot(u.display.x - camTarget.x, u.display.z - camTarget.z);
    if (d < leavesD) { leavesD = d; leaves = u; }
  });
  sfxLoop('trees-rustling', leaves && live ? 1 : 0, leaves?.display);
}

// ── Loop ───────────────────────────────────────────────────
const timer = new THREE.Timer();
function frame(ts) {
  window.__kqFrame = (window.__kqFrame || 0) + 1;   // for automated checks
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  gamepadButtons();
  sendInput(performance.now());
  syncUnits(dt);
  fx.update(dt);
  damage?.sync(room?.state?.buildingHp, dt);
  roadblocks.sync(room?.state?.roadblocks);
  hill.sync(room?.state, dt);
  crate.sync(room?.state, dt);
  exits?.sync(room?.state);
  civPaths.sync(room?.state, civilians);
  updateSound();

  const me = room?.state?.players?.get(room.sessionId);
  const mine = room && units.get(room.sessionId);
  if (mine) {
    const want = mine.role === 'kaiju' ? (MOBILE ? TUNING.viewTilesMobileKaiju : TUNING.viewTilesKaiju)
      : MOBILE ? TUNING.viewTilesMobile : TUNING.viewTilesTank;
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

  if (me && !roleNoticeDone && !OFFLINE) {
    roleNoticeDone = true;
    if (!MOBILE && wantedRole === 'kaiju' && me.role === 'tank') {
      hud.toast(`Someone is already the kaiju, so you're a tank. Use PLAY KAIJU in the lobby if the seat frees up.`, 9);
    }
  }
  // put the room code in the address bar once known, so a reload or a copied URL rejoins
  if (room && !OFFLINE && !codeInUrl && room.state?.code) {
    codeInUrl = true;
    try { const u = new URL(location.href); u.searchParams.set('room', room.state.code); u.searchParams.delete('create'); u.searchParams.delete('name'); history.replaceState(null, '', u); } catch {}
  }
  if (routeMarks) routeMarks.sync(me, mine?.display || me || { x: 0, z: 0 }, dt);
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
