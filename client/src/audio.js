// Sound effects (Web Audio). Files live in client/public/assets/sfx/.
// One-shots fade with distance from the camera centre (TUNING.sfxHearing);
// loops (footsteps, tank engine, repair) are single sources whose volume is
// set every frame, so they never stack up. M toggles mute (remembered).
import { TUNING } from '../../shared/tuning.js';
import { loadBytes } from './assets.js';

const NAMES = ['building-destroyed', 'building-repair', 'monster-footsteps', 'monster-hit',
  'roadblock-placed', 'tank-dead', 'tank-moving', 'tank-shooting'];

// Per-file level balance (asset calibration, measured with ffmpeg volumedetect;
// the engine loop is much louder than the rest and plays constantly).
const LEVEL = { 'tank-moving': 0.3, 'monster-footsteps': 0.7, 'building-repair': 0.8,
  'monster-hit': 1.3, 'roadblock-placed': 1.3 };
const level = (n) => LEVEL[n] ?? 1;

let ctx = null, master = null, muted = false;
const buffers = {};
const loops = {};
const listener = { x: 0, z: 0 };
try { muted = localStorage.getItem('kq-muted') === '1'; } catch {}
const played = (window.__kqSfx = []);   // record for automated checks

function volume() { return muted ? 0 : TUNING.sfxVolume; }

export function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume();
  master.connect(ctx.destination);
  for (const n of NAMES) {
    loadBytes(`./assets/sfx/${n}.mp3`)
      .then(b => ctx.decodeAudioData(b))
      .then(buf => { buffers[n] = buf; })
      .catch(e => console.warn('[sfx]', n, e));
  }
  // browsers start audio suspended until the player presses something
  const unlock = () => { if (ctx.state !== 'running') ctx.resume(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { passive: true });
}
export const unlockAudio = () => { if (ctx && ctx.state !== 'running') ctx.resume(); };

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('kq-muted', muted ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(volume(), ctx.currentTime, 0.02);
  return muted;
}

export function setListener(x, z) { listener.x = x; listener.z = z; }
const falloff = (x, z) => x === undefined ? 1
  : Math.max(0, 1 - Math.hypot(x - listener.x, z - listener.z) / TUNING.sfxHearing);

// One-shot. at = {x, z} for distance fade (omit = full volume).
export function play(name, gain = 1, at) {
  played.push(name);
  if (!ctx || !buffers[name] || ctx.state !== 'running') return;
  const g = gain * level(name) * falloff(at?.x, at?.z);
  if (g < 0.02) return;
  const src = ctx.createBufferSource(), amp = ctx.createGain();
  src.buffer = buffers[name]; amp.gain.value = g;
  src.connect(amp).connect(master);
  src.start();
}

// Loop at a volume (0 = silent). Call every frame; starts/stops itself.
export function loop(name, gain, at) {
  if (!ctx || !buffers[name]) return;
  const g = gain > 0 ? gain * level(name) * falloff(at?.x, at?.z) : 0;
  let l = loops[name];
  if (!l && g > 0.005) {
    const src = ctx.createBufferSource(), amp = ctx.createGain();
    src.buffer = buffers[name]; src.loop = true; amp.gain.value = 0;
    src.loopStart = 0.02; src.loopEnd = buffers[name].duration;   // skip the mp3 encoder's lead-in gap
    src.connect(amp).connect(master); src.start();
    l = loops[name] = { src, amp, on: false };
  }
  if (!l) return;
  if ((g > 0.005) !== l.on) { l.on = g > 0.005; if (l.on) played.push(name); }
  l.amp.gain.setTargetAtTime(g, ctx.currentTime, 0.06);
}
