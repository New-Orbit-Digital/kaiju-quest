// WASD → a world-space direction for the server.
import { TUNING } from '../../shared/tuning.js';

const down = new Set();
const listeners = [];
export function onInputChange(fn) { listeners.push(fn); }
const changed = () => listeners.forEach(fn => fn());
addEventListener('keydown', e => { if (!down.has(e.code)) { down.add(e.code); changed(); } });
addEventListener('keyup', e => { if (down.delete(e.code)) changed(); });
addEventListener('blur', () => { down.clear(); changed(); });

export function isDown(code) { return down.has(code); }

// Touch joystick: a screen-space vector (x right, y up, length ≤ 1), or null.
let touch = null;
export function setTouchVector(v) { touch = v; changed(); }

// Screen axes on the ground for a camera at the given azimuth.
function screenAxes() {
  const az = TUNING.cameraAzimuthDeg * Math.PI / 180;
  const fwd = { x: -Math.sin(az), z: -Math.cos(az) };   // up the screen
  const right = { x: Math.cos(az), z: -Math.sin(az) };  // right on screen
  return { fwd, right };
}

// 'street' scheme: W = the street axis nearest "up-right" on screen.
function streetAxes() {
  const { fwd, right } = screenAxes();
  const snap = (v) => Math.abs(v.x) > Math.abs(v.z)
    ? { x: Math.sign(v.x), z: 0 } : { x: 0, z: Math.sign(v.z) };
  const w = snap({ x: fwd.x + right.x, z: fwd.z + right.z });
  const d = snap({ x: right.x - fwd.x, z: right.z - fwd.z });
  return { fwd: w, right: d };
}

export function moveVector() {
  if (touch) return touchToWorld(touch);
  const { fwd, right } = TUNING.controlScheme === 'screen' ? screenAxes() : streetAxes();
  let f = 0, r = 0;
  if (down.has('KeyW')) f += 1;
  if (down.has('KeyS')) f -= 1;
  if (down.has('KeyD')) r += 1;
  if (down.has('KeyA')) r -= 1;
  let x = fwd.x * f + right.x * r, z = fwd.z * f + right.z * r;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}

// Joystick: push the stick where you want to go on screen. With joystickSnap
// on, it picks the nearest of the 4 street directions (streets run diagonally
// on screen), which keeps tanks from grinding into corners.
function touchToWorld(t) {
  const { fwd, right } = screenAxes();
  let x = fwd.x * t.y + right.x * t.x, z = fwd.z * t.y + right.z * t.x;
  const len = Math.hypot(x, z);
  if (len < 1e-3) return { x: 0, z: 0 };
  if (TUNING.joystickSnap) {
    if (Math.abs(x) > Math.abs(z)) { x = Math.sign(x); z = 0; } else { z = Math.sign(z); x = 0; }
  } else if (len > 1) { x /= len; z /= len; }
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}
