// DOM HUD: kaiju HP, timer, score, banners, end screen, ability meter,
// the tanks' edge arrow to the kaiju, and phone-only unit markers.
import * as THREE from 'three';
import { TUNING } from '../../shared/tuning.js';
import { colourHex } from './units.js';

const CSS = `
[hidden] { display: none !important; }
#kq-top { position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
  display: flex; gap: 14px; align-items: center; padding: 8px 14px; border-radius: 8px;
  background: rgba(12,16,24,.78); color: #eef2f6; font: 600 14px/1.2 system-ui, sans-serif; pointer-events: none; z-index: 5; }
#kq-top .hp { width: 220px; height: 14px; background: #3a1d1d; border-radius: 7px; overflow: hidden; position: relative; }
#kq-top .hp i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg,#e5484d,#ff7a59); border-radius: 7px; transition: width .15s; }
#kq-top .hp b { position: absolute; inset: 0; text-align: center; font: 700 10px/14px system-ui, sans-serif; color: #fff; letter-spacing: .04em; }
#kq-top .clock { font-variant-numeric: tabular-nums; font-size: 18px; min-width: 52px; text-align: center; }
#kq-top .score { font-variant-numeric: tabular-nums; color: #7dff8a; }
#kq-banner { position: fixed; left: 50%; top: 32%; transform: translate(-50%,-50%); text-align: center; pointer-events: none;
  color: #fff; font: 800 28px/1.15 system-ui, sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,.7); z-index: 6; max-width: calc(100% - 32px); }
#kq-banner small { display: block; font: 600 15px/1.4 system-ui, sans-serif; opacity: .85; margin-top: 6px; }
#kq-banner.big { font-size: 72px; }
#kq-end { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(8,10,16,.55); z-index: 7; pointer-events: none; padding: 16px; }
#kq-end .card { background: rgba(14,19,28,.94); border-radius: 8px; padding: 22px 28px; color: #eef2f6; text-align: center;
  border-top: 4px solid #f5b82e; min-width: min(360px, 100%); font: 500 15px/1.5 system-ui, sans-serif; }
#kq-end h2 { margin: 0 0 6px; font: 900 34px/1.1 system-ui, sans-serif; letter-spacing: .03em; }
#kq-end .pts { font: 800 22px/1.3 system-ui, sans-serif; color: #7dff8a; font-variant-numeric: tabular-nums; }
#kq-ability { position: fixed; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%);
  min-width: 200px; padding: 8px 14px; border-radius: 8px; background: rgba(12,16,24,.78); color: #eef2f6;
  font: 600 13px/1.3 system-ui, sans-serif; text-align: center; pointer-events: none; z-index: 5; }
#kq-ability .bar { height: 6px; border-radius: 3px; background: #2b3444; margin-top: 5px; overflow: hidden; }
#kq-ability .bar i { display: block; height: 100%; background: #f5b82e; }
#kq-ability.ready .bar i { background: #7dff8a; }
#kq-edge { position: fixed; width: 0; height: 0; z-index: 5; pointer-events: none; }
#kq-edge::before { content: ''; position: absolute; left: -16px; top: -14px; border-left: 28px solid #ff4d3d;
  border-top: 14px solid transparent; border-bottom: 14px solid transparent; filter: drop-shadow(0 0 4px rgba(0,0,0,.8)); }
#kq-edge span { position: absolute; left: -40px; top: 16px; width: 80px; text-align: center; color: #fff;
  font: 700 11px/1 system-ui, sans-serif; text-shadow: 0 1px 3px #000; }
.kq-marker { position: fixed; width: 0; height: 0; pointer-events: none; z-index: 4; }
.kq-marker::before { content: ''; position: absolute; left: -9px; top: -16px; border-top: 14px solid var(--c);
  border-left: 9px solid transparent; border-right: 9px solid transparent; filter: drop-shadow(0 0 3px rgba(0,0,0,.9)); }
.kq-mobile #kq-top { gap: 8px; padding: 6px 10px; font-size: 12px; }
.kq-mobile #kq-top .hp { width: 120px; }
.kq-mobile #kq-top .clock { font-size: 15px; }
.kq-mobile #kq-banner { font-size: 20px; top: 26%; }
.kq-mobile #kq-banner.big { font-size: 54px; }
.kq-mobile #kq-ability { display: none; }
.kq-mobile #hud { display: none; }
`;

const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function createHud({ mobile }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  if (mobile) document.documentElement.classList.add('kq-mobile');
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; const n = d.firstElementChild; document.body.appendChild(n); return n; };
  const top = el(`<div id="kq-top" hidden><div class="hp"><i></i><b></b></div><div class="clock"></div><div class="score"></div></div>`);
  const banner = el(`<div id="kq-banner" hidden></div>`);
  const end = el(`<div id="kq-end" hidden><div class="card"></div></div>`);
  const ability = el(`<div id="kq-ability" hidden><span></span><div class="bar"><i></i></div></div>`);
  const edge = el(`<div id="kq-edge" hidden><span>KAIJU</span></div>`);
  const markers = new Map();
  const v = new THREE.Vector3();

  function marker(id, colour) {
    let m = markers.get(id);
    if (!m) { m = el(`<div class="kq-marker"></div>`); markers.set(id, m); }
    m.style.setProperty('--c', colour);
    return m;
  }
  function project(camera, x, y, z) {
    v.set(x, y, z).project(camera);
    return { sx: (v.x + 1) / 2 * innerWidth, sy: (1 - v.y) / 2 * innerHeight, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  return {
    update({ state, me, myId, camera, units }) {
      if (!state || !me) return;
      const playing = state.phase === 'playing';
      // top bar
      top.hidden = !(playing || state.phase === 'ended');
      if (!top.hidden) {
        const frac = state.kaijuMaxHp ? state.kaijuHp / state.kaijuMaxHp : 1;
        top.querySelector('.hp i').style.width = `${Math.max(0, frac) * 100}%`;
        top.querySelector('.hp b').textContent = `KAIJU ${Math.ceil(state.kaijuHp)} / ${state.kaijuMaxHp}`;
        top.querySelector('.clock').textContent = playing ? fmt(state.clock) : 'END';
        top.querySelector('.score').textContent = `★ ${state.kaijuScore}`;
      }

      // banner
      let b = '', big = false;
      if (state.phase === 'waiting') {
        let hasK = false, hasT = false;
        state.players.forEach(p => { if (p.role === 'kaiju') hasK = true; else hasT = true; });
        b = !hasK ? 'Waiting for the kaiju…<small>Share this page\'s link with a friend</small>'
          : !hasT ? 'Waiting for a tank…<small>Share this page\'s link — phones can drive tanks</small>' : '';
      } else if (state.phase === 'countdown') {
        b = String(Math.max(1, Math.ceil(state.clock))); big = true;
      } else if (playing && me.role === 'tank' && !me.alive) {
        b = `Crushed!<small>Back in action in ${Math.max(1, Math.ceil(me.respawnIn))}</small>`;
      } else if (playing && state.clock > T0() - 2.5) {
        b = me.role === 'kaiju' ? 'SMASH!<small>E next to a building · walk into tanks and soldiers</small>'
                                : 'HUNT THE KAIJU<small>Your turret fires on its own · E to boost away</small>';
      }
      banner.hidden = !b; banner.innerHTML = b; banner.classList.toggle('big', big);

      // end screen
      end.hidden = state.phase !== 'ended';
      if (!end.hidden) {
        const kaijuWon = state.winner === 'kaiju';
        const youWon = (me.role === 'kaiju') === kaijuWon;
        end.querySelector('.card').innerHTML =
          `<h2>${kaijuWon ? 'KAIJU WINS' : 'TANKS WIN'}</h2>` +
          `<div>${youWon ? 'You won.' : 'You lost.'} ${kaijuWon ? 'The kaiju outlasted the clock.' : 'The kaiju went down.'}</div>` +
          `<div class="pts">★ ${state.kaijuScore} kaiju points</div>` +
          `<div>Next round in ${Math.max(0, Math.ceil(state.clock))}</div>`;
      }

      // ability meter (desktop; phones use the boost button)
      ability.hidden = !playing || mobile || (me.role === 'tank' && !me.alive);
      if (!ability.hidden) {
        const kaijuSide = me.role === 'kaiju';
        const left = kaijuSide ? me.strikeIn : me.boostIn;
        const total = kaijuSide ? TUNING.strikeCooldown : TUNING.boostCooldown;
        const ready = left <= 0;
        ability.classList.toggle('ready', ready);
        ability.querySelector('span').textContent = kaijuSide
          ? (ready ? 'E  SMASH — ready' : 'E  SMASH')
          : (me.boosting ? 'BOOSTING' : ready ? 'E  BOOST — ready' : `E  BOOST  ${Math.ceil(left)}s`);
        ability.querySelector('.bar i').style.width = `${(1 - left / total) * 100}%`;
      }

      // edge arrow: tanks only, when the kaiju is off screen
      let kaijuUnit = null, kaijuState = null;
      state.players.forEach((p, id) => { if (p.role === 'kaiju') { kaijuState = p; kaijuUnit = units.get(id); } });
      edge.hidden = true;
      if (me.role === 'tank' && kaijuUnit && state.phase !== 'ended') {
        const k = kaijuUnit.display;
        const p = project(camera, k.x, 0.8, k.z);
        if (!p.on) {
          const cx = innerWidth / 2, cy = innerHeight / 2;
          const dx = p.sx - cx, dy = p.sy - cy;
          const pad = 36, sx = (cx - pad) / Math.abs(dx || 1e-6), sy = (cy - pad) / Math.abs(dy || 1e-6);
          const s = Math.min(sx, sy);
          edge.hidden = false;
          edge.style.left = `${cx + dx * s}px`; edge.style.top = `${cy + dy * s}px`;
          edge.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
          edge.querySelector('span').style.transform = `rotate(${-Math.atan2(dy, dx)}rad)`;
        }
      }

      // phone-only markers over the kaiju and the other tanks
      const seen = new Set();
      if (mobile && TUNING.mobileMarkers && me.role === 'tank' && state.phase !== 'ended') {
        state.players.forEach((p, id) => {
          if (id === myId || !p.alive) return;
          const u = units.get(id);
          if (!u) return;
          const h = p.role === 'kaiju' ? 1.9 : 0.75;
          const s = project(camera, u.display.x, h, u.display.z);
          if (!s.on) return;
          const m = marker(id, p.role === 'kaiju' ? '#ff4d3d' : colourHex(p.slot));
          m.hidden = false; m.style.left = `${s.sx}px`; m.style.top = `${s.sy}px`;
          seen.add(id);
        });
      }
      for (const [id, m] of markers) if (!seen.has(id)) m.hidden = true;
    },
  };
}
const T0 = () => TUNING.matchSeconds;
