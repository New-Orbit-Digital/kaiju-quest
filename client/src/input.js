// WASD / touch joystick / controller → a world-space direction for the server.
import { TUNING } from '../../shared/tuning.js';

const down = new Set();
const listeners = [];
export function onInputChange(fn) { listeners.push(fn); }
const changed = () => listeners.forEach(fn => fn());
addEventListener('keydown', e => { if (!down.has(e.code)) { down.add(e.code); changed(); } });
addEventListener('keyup', e => { if (down.delete(e.code)) changed(); });
addEventListener('blur', () => { down.clear(); changed(); });

export function isDown(code) { return down.has(code); }

// ── Controller (Gamepad API) ──
// Left stick moves (screen-relative, like the phone joystick). D-pad = WASD.
// Buttons use the "standard" layout: 0 = bottom face button (A on Xbox,
// ✕ on PlayStation, B on Switch), 1 = right face, 5 = RB/R1, 7 = RT/R2.
let pad = null;               // { x, y } stick vector or null
let padDpad = new Set();      // WASD codes held on the D-pad
let padPrev = [];             // last frame's pressed buttons
let padUi = false;            // true while a menu has the D-pad (it navigates instead of moving)
export function setPadUiMode(on) { if (padUi !== on) { padUi = on; changed(); } }
let lastDevice = 'keyboard';  // 'keyboard' | 'gamepad' | 'touch' — for key labels
addEventListener('keydown', () => { lastDevice = 'keyboard'; });
export function usingGamepad() { return lastDevice === 'gamepad'; }
// Button names for help text, following the device last used.
export function keyNames() {
  return usingGamepad()
    ? { move: 'STICK', block: 'A', boost: 'RB' }
    : { move: 'WASD', block: 'SPACE', boost: 'SHIFT' };
}

// Call once per frame. Returns the button indices newly pressed this frame.
export function pollGamepad() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const gp = pads[0];
  const pressed = [];
  if (!gp) {
    if (pad || padDpad.size) { pad = null; padDpad.clear(); changed(); }
    padPrev = [];
    return pressed;
  }
  const btn = (i) => !!gp.buttons[i]?.pressed;
  gp.buttons.forEach((b, i) => { if (b.pressed && !padPrev[i]) pressed.push(i); });
  padPrev = gp.buttons.map(b => b.pressed);

  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const next = Math.hypot(ax, ay) > TUNING.gamepadDeadzone ? { x: ax, y: -ay } : null;
  const dpad = new Set();
  if (btn(12)) dpad.add('KeyW');
  if (btn(13)) dpad.add('KeyS');
  if (btn(14)) dpad.add('KeyA');
  if (btn(15)) dpad.add('KeyD');

  const was = pad ? `${pad.x.toFixed(2)},${pad.y.toFixed(2)}` : '';
  const now = next ? `${next.x.toFixed(2)},${next.y.toFixed(2)}` : '';
  const dpadChanged = [...dpad].join() !== [...padDpad].join();
  pad = next; padDpad = dpad;
  if (next || dpad.size || pressed.length) lastDevice = 'gamepad';
  if (was !== now || dpadChanged) changed();
  return pressed;
}

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
  if (touch) return touchToWorld(touch, TUNING.joystickSnap);
  if (pad) return touchToWorld(pad, TUNING.gamepadSnap);
  const { fwd, right } = TUNING.controlScheme === 'screen' ? screenAxes() : streetAxes();
  const held = (c) => down.has(c) || (!padUi && padDpad.has(c));
  let f = 0, r = 0;
  if (held('KeyW')) f += 1;
  if (held('KeyS')) f -= 1;
  if (held('KeyD')) r += 1;
  if (held('KeyA')) r -= 1;
  // Two keys held = the screen diagonal they point to, snapped onto the street
  // that runs that way (streets run diagonally on screen): W+D = W's street,
  // S+A = S's, W+A = A's, S+D = D's. Keeps you on a street instead of into a corner.
  if (TUNING.controlScheme !== 'screen' && TUNING.keyComboSnap && f && r) {
    if (f > 0 && r > 0) r = 0; else if (f < 0 && r < 0) r = 0;
    else if (f > 0 && r < 0) f = 0; else f = 0;
  }
  let x = fwd.x * f + right.x * r, z = fwd.z * f + right.z * r;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}

// Joystick: push the stick where you want to go on screen. With joystickSnap
// on, it picks the nearest of the 4 street directions (streets run diagonally
// on screen), which keeps tanks from grinding into corners.
let snapAxis = 'x'; // last snapped axis: a stick held near a tie keeps its street
function touchToWorld(t, snap) {
  const { fwd, right } = screenAxes();
  let x = fwd.x * t.y + right.x * t.x, z = fwd.z * t.y + right.z * t.x;
  const len = Math.hypot(x, z);
  if (len < 1e-3) return { x: 0, z: 0 };
  if (snap) {
    // keep the current street until the stick is stickSnapHysteresisDeg past the halfway (45°) line
    const ax = Math.abs(x), az = Math.abs(z);
    const ratio = Math.tan((45 + TUNING.stickSnapHysteresisDeg) * Math.PI / 180);
    if (ax > az * ratio) snapAxis = 'x'; else if (az > ax * ratio) snapAxis = 'z';
    if (snapAxis === 'x') { x = Math.sign(x) || 1; z = 0; } else { z = Math.sign(z) || 1; x = 0; }
  } else if (len > 1) { x /= len; z /= len; }
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}
