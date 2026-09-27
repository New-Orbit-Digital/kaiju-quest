// DOM HUD: kaiju HP, timer, score, banners, end screen, ability meter,
// the tanks' edge arrow to the kaiju, and phone-only unit markers.
import * as THREE from 'three';
import { TUNING } from '../../shared/tuning.js';
import { colourHex, kaijuHex } from './units.js';
import { keyNames } from './input.js';
import { MODES, MODE_NAMES, BETA_MODES } from '../../shared/game.js';

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
#kq-top .extra { font-variant-numeric: tabular-nums; color: #f5b82e; }
.kq-modes { display: flex; gap: 6px; margin: 0 0 12px; flex-wrap: wrap; }
.kq-modes button { flex: 1; min-width: 88px; border: 1px solid #3a4558; background: #1a2130; color: #cfd6e0; border-radius: 6px;
  padding: 8px 6px; cursor: pointer; font: 700 12px/1.2 system-ui, sans-serif; letter-spacing: .02em; }
.kq-modes button.on { background: #f5b82e; border-color: #f5b82e; color: #141a24; }
.kq-modes button i { display: block; font: 600 10px/1 system-ui, sans-serif; font-style: normal; opacity: .75; margin-top: 3px; }
.kq-modes-label { font: 800 11px/1 system-ui, sans-serif; letter-spacing: .08em; color: #a9b4c2; margin: 0 0 6px; }
#kq-end .card { pointer-events: auto; }
#kq-end .kq-modes { margin: 14px 0 0; }
#kq-mute { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 6; width: 40px; height: 40px;
  border-radius: 50%; border: 0; background: rgba(12,16,24,.78); color: #eef2f6; font: 700 16px/1 system-ui, sans-serif; cursor: pointer; }
.kq-mobile #kq-mute { bottom: auto; top: calc(8px + env(safe-area-inset-top, 0px)); right: 8px; width: 34px; height: 34px; font-size: 14px; }
#kq-top .score small { opacity: .7; font-weight: 500; }
#kq-top > div { white-space: nowrap; }
#kq-top .score, #kq-top .extra { max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
#kq-top .score .k { color: #7dff8a; } #kq-top .score .t { color: #8fb0ff; }
#kq-split { position: fixed; top: calc(52px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
  width: min(420px, calc(100% - 32px)); height: 10px; border-radius: 5px; background: #3a4558; overflow: hidden; z-index: 5; pointer-events: none; }
#kq-split i { position: absolute; top: 0; bottom: 0; transition: width .3s; }
#kq-split .k { left: 0; background: #7dff8a; } #kq-split .t { right: 0; background: #8fb0ff; }
#kq-split::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 2px; background: #fff; }
#kq-cratearrow { position: fixed; width: 0; height: 0; z-index: 5; pointer-events: none; }
#kq-cratearrow::before { content: ''; position: absolute; left: -16px; top: -14px; border-left: 28px solid #f5b82e;
  border-top: 14px solid transparent; border-bottom: 14px solid transparent; filter: drop-shadow(0 0 4px rgba(0,0,0,.8)); }
#kq-cratearrow span { position: absolute; left: -40px; top: 16px; width: 80px; text-align: center; color: #fff;
  font: 700 11px/1 system-ui, sans-serif; text-shadow: 0 1px 3px #000; }
#kq-hillarrow { position: fixed; width: 0; height: 0; z-index: 5; pointer-events: none; }
#kq-hillarrow::before { content: ''; position: absolute; left: -16px; top: -14px; border-left: 28px solid #f5b82e;
  border-top: 14px solid transparent; border-bottom: 14px solid transparent; filter: drop-shadow(0 0 4px rgba(0,0,0,.8)); }
#kq-hillarrow span { position: absolute; left: -40px; top: 16px; width: 80px; text-align: center; color: #fff;
  font: 700 11px/1 system-ui, sans-serif; text-shadow: 0 1px 3px #000; }
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
#kq-pick { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(8,10,16,.6); z-index: 9; padding: 16px; }
#kq-pick .card { background: rgba(14,19,28,.95); border-radius: 8px; padding: 22px 26px; color: #eef2f6; text-align: center;
  border-top: 4px solid #f5b82e; font: 500 15px/1.5 system-ui, sans-serif; max-width: 460px; }
#kq-pick h2 { margin: 0 0 4px; font: 900 30px/1.1 system-ui, sans-serif; }
#kq-pick .row { display: flex; gap: 12px; justify-content: center; margin-top: 14px; flex-wrap: wrap; }
#kq-pick button { font: 800 17px/1 system-ui, sans-serif; letter-spacing: .05em; border: 0; border-radius: 6px;
  padding: 14px 22px; cursor: pointer; min-width: 150px; }
#kq-pick button small { display: block; font: 500 12px/1.3 system-ui, sans-serif; letter-spacing: 0; margin-top: 4px; }
#kq-pick .k { background: #7dff8a; color: #10301a; } #kq-pick .t { background: #8fb0ff; color: #101a33; }
#kq-pick button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
#kq-pick input { display: block; width: 100%; box-sizing: border-box; margin-top: 12px; padding: 12px 14px; border-radius: 6px;
  border: 2px solid #3a4558; background: #0b1018; color: #fff; font: 600 18px/1.2 system-ui, sans-serif; text-align: center; }
#kq-pick input:focus { outline: none; border-color: #f5b82e; }
#kq-pick .note { color: #ffd9a8; margin: 4px 0 2px; font-size: 14px; }
#kq-pick .code-row { display: flex; gap: 8px; margin-top: 14px; }
#kq-pick .code-row input { margin: 0; flex: 1; letter-spacing: .3em; font-size: 16px; padding: 10px; }
#kq-pick .code-row button { min-width: 0; padding: 10px 14px; font-size: 13px; background: #2b3444; color: #eef2f6; }
#kq-lobby .room { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 8px 10px; border-radius: 6px; background: rgba(255,255,255,.06); }
#kq-lobby .room b { font: 900 18px/1 system-ui, sans-serif; letter-spacing: .15em; color: #f5b82e; }
#kq-lobby .room small { color: #a9b4c2; flex: 1; }
#kq-lobby .room button { border: 0; border-radius: 6px; padding: 8px 10px; cursor: pointer; background: #f5b82e; color: #141a24; font: 800 12px/1 system-ui, sans-serif; }
#kq-lobby { position: fixed; right: 16px; top: calc(12px + env(safe-area-inset-top, 0px)); width: min(340px, calc(100% - 32px));
  max-height: calc(100% - 40px); overflow: auto; background: rgba(14,19,28,.94); border-radius: 8px; border-top: 4px solid #f5b82e;
  padding: 14px 16px; color: #eef2f6; font: 500 14px/1.4 system-ui, sans-serif; z-index: 7; }
#kq-lobby h3 { margin: 0 0 2px; font: 900 18px/1.2 system-ui, sans-serif; letter-spacing: .04em; }
#kq-lobby .sub { color: #a9b4c2; font-size: 12px; margin-bottom: 10px; }
#kq-lobby ul { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
#kq-lobby li { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 8px; align-items: center;
  padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,.05); }
#kq-lobby li.me { outline: 1px solid rgba(245,184,46,.6); }
#kq-lobby .sw { width: 12px; height: 12px; border-radius: 3px; }
#kq-lobby .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
#kq-lobby .nm small { font-weight: 500; color: #a9b4c2; margin-left: 4px; }
#kq-lobby .st { font: 800 11px/1 system-ui, sans-serif; letter-spacing: .05em; padding: 4px 6px; border-radius: 4px; }
#kq-lobby .st.ready { background: #1f6b3a; color: #bff5cf; } #kq-lobby .st.wait { background: #3a4558; color: #cfd6e0; }
#kq-lobby .st.afk { background: #5a3a1a; color: #ffd9a8; }
#kq-lobby .kick { border: 0; background: transparent; color: #ff8a80; font: 700 12px/1 system-ui, sans-serif; cursor: pointer; padding: 4px; }
#kq-lobby .acts { display: flex; gap: 8px; flex-wrap: wrap; }
#kq-lobby .acts button { flex: 1; border: 0; border-radius: 6px; padding: 11px 10px; cursor: pointer;
  font: 800 14px/1 system-ui, sans-serif; letter-spacing: .04em; }
#kq-lobby .rdy { background: #7dff8a; color: #10301a; } #kq-lobby .rdy.on { background: #3a4558; color: #eef2f6; }
#kq-lobby .swap { background: #2b3444; color: #eef2f6; }
#kq-lobby button:disabled { opacity: .45; cursor: not-allowed; }
.kq-tag { position: fixed; transform: translate(-50%, -100%); pointer-events: none; z-index: 4; white-space: nowrap;
  font: 700 12px/1 system-ui, sans-serif; color: #fff; padding: 3px 6px; border-radius: 4px; background: rgba(10,14,22,.72);
  border-bottom: 2px solid var(--c); text-shadow: 0 1px 2px #000; }
.kq-mobile .kq-tag { font-size: 11px; }
/* phones: keep overlays at the top, clear of the joystick and BOOST/BLOCK buttons */
.kq-mobile #kq-lobby { top: calc(8px + env(safe-area-inset-top, 0px)); bottom: auto; right: 50%; transform: translateX(50%);
  max-height: 58%; padding: 10px 12px; }
.kq-mobile #kq-lobby ul { gap: 4px; margin-bottom: 8px; }
.kq-mobile #kq-lobby li { padding: 4px 6px; }
.kq-mobile #kq-lobby .acts button { padding: 9px 8px; font-size: 13px; }
.kq-mobile #kq-pick { place-items: start center; padding-top: calc(12px + env(safe-area-inset-top, 0px)); }
.kq-mobile #kq-pick .card { padding: 14px 18px; }
.kq-mobile #kq-toast { bottom: auto; top: calc(64px + env(safe-area-inset-top, 0px)); }
#kq-lobby .bots { display: flex; gap: 8px; margin-top: 8px; }
#kq-lobby .bots button { flex: 1; border: 1px dashed #56627a; background: transparent; color: #cfd6e0; border-radius: 6px;
  padding: 8px; cursor: pointer; font: 700 12px/1 system-ui, sans-serif; letter-spacing: .04em; }
#kq-toast { position: fixed; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  background: rgba(14,19,28,.94); color: #eef2f6; padding: 10px 16px; border-radius: 8px; border-left: 4px solid #f5b82e;
  font: 600 14px/1.4 system-ui, sans-serif; z-index: 8; max-width: calc(100% - 32px); pointer-events: none; }
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
  const top = el(`<div id="kq-top" hidden><div class="hp"><i></i><b></b></div><div class="clock"></div><div class="score"></div><div class="extra"></div></div>`);
  const hillArrow = el(`<div id="kq-hillarrow" hidden><span>HILL</span></div>`);
  const crateArrow = el(`<div id="kq-cratearrow" class="kq-goldarrow" hidden><span>CRATE</span></div>`);
  const split = el(`<div id="kq-split" hidden><i class="k"></i><i class="t"></i></div>`);
  const muteBtn = el(`<button id="kq-mute" type="button" title="Sound on/off (M)">🔊</button>`);
  let endSig = '';
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

  const toastEl = el(`<div id="kq-toast" hidden></div>`);
  const lobby = el(`<div id="kq-lobby" hidden></div>`);
  let lobbySig = '', handlers = {}, fromLobby = false, copied = false;
  const tags = new Map();
  const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let toastTimer = null;

  // Mode picker (lobby + end screen). Anyone can change it.
  const modeBar = (current) => `<div class="kq-modes">` + MODES.map(m =>
    `<button type="button" data-mode="${m}" class="${m === current ? 'on' : ''}">${MODE_NAMES[m]}${BETA_MODES.has(m) ? '<i>beta</i>' : '<i>&nbsp;</i>'}</button>`).join('') + `</div>`;
  const wireModes = (root) => root.querySelectorAll('[data-mode]').forEach(bt =>
    bt.addEventListener('click', () => handlers.mode?.(bt.dataset.mode)));
  // Point an edge arrow at an off-screen spot; hides it when the spot is on screen.
  function pointEdge(node, camera, x, y, z) {
    const p = project(camera, x, y, z);
    if (p.on) { node.hidden = true; return; }
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const dx = p.sx - cx, dy = p.sy - cy;
    const pad = 36, sx = (cx - pad) / Math.abs(dx || 1e-6), sy = (cy - pad) / Math.abs(dy || 1e-6);
    const sc = Math.min(sx, sy);
    node.hidden = false;
    node.style.left = `${cx + dx * sc}px`; node.style.top = `${cy + dy * sc}px`;
    node.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    node.querySelector('span').style.transform = `rotate(${-Math.atan2(dy, dx)}rad)`;
  }

  return {
    onMute(fn, muted) {
      muteBtn.textContent = muted ? '🔇' : '🔊';
      muteBtn.addEventListener('click', () => { const m = fn(); muteBtn.textContent = m ? '🔇' : '🔊'; muteBtn.blur(); });
    },
    setMuted(m) { muteBtn.textContent = m ? '🔇' : '🔊'; },
    // Join screen: name (remembered on this device), then PLAY (public game),
    // CREATE ROOM (private, with a code) or a code. `code` pre-fills a share link.
    askJoin({ code = '', note = '' } = {}) {
      let saved = '';
      try { saved = localStorage.getItem('kq-name') || ''; } catch {}
      return new Promise((resolve) => {
        const card = el(`<div id="kq-pick"><form class="card"><h2>KAIJU QUEST</h2>
          ${note ? `<div class="note">${esc(note)}</div>` : ''}
          <input id="kq-name" maxlength="16" autocomplete="nickname" placeholder="Your name" />
          <div class="row">${code && !note
            ? `<button class="k" type="submit" data-how="code">JOIN ROOM ${esc(code)}</button>`
            : `<button class="k" type="submit" data-how="public">PLAY</button>`}
            <button class="t" type="button" data-how="create">CREATE ROOM<small>private, with a share link</small></button></div>
          <div class="code-row"><input id="kq-code" maxlength="${TUNING.roomCodeLength}" autocomplete="off" placeholder="CODE" value="${esc(note ? code : '')}" />
            <button type="button" data-how="code">JOIN CODE</button></div></form></div>`);
        const input = card.querySelector('#kq-name'), codeIn = card.querySelector('#kq-code');
        input.value = saved;
        codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });
        const go = (how) => {
          const name = input.value.trim().slice(0, 16);
          if (!name) { input.focus(); return; }
          const c = how === 'code' ? (codeIn.value || code).toUpperCase() : '';
          if (how === 'code' && c.length !== TUNING.roomCodeLength) { codeIn.focus(); return; }
          try { localStorage.setItem('kq-name', name); } catch {}
          card.remove(); resolve({ name, how, code: c });
        };
        card.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); go(e.submitter?.dataset.how || (code && !note ? 'code' : 'public')); });
        card.querySelectorAll('button[type=button]').forEach(bt => bt.addEventListener('click', () => go(bt.dataset.how)));
        setTimeout(() => input.focus(), 50);
      });
    },
    // Lobby actions: { ready(bool), role('kaiju'|'tank'), kick(id) }
    onLobby(h) { handlers = { ...handlers, ...h }; },
    toast(text, seconds = 7) {
      toastEl.textContent = text; toastEl.hidden = false;
      (window.__kqToasts ||= []).push(text); // record for automated checks
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, seconds * 1000);
    },
    updateLobby(state, me, myId) {
      // visible in the lobby and during the ready-up countdown (not between rounds)
      if (state.phase === 'lobby') fromLobby = true;
      if (state.phase === 'playing' || state.phase === 'ended') fromLobby = false;
      const show = state.phase === 'lobby' || (state.phase === 'countdown' && fromLobby);
      lobby.hidden = !show;
      if (!show) return;
      const rows = [];
      let hasK = false, kaijuAfk = false, tanks = 0;
      state.players.forEach((p, id) => {
        if (p.role === 'kaiju') { hasK = true; kaijuAfk = p.afk || p.bot; } else tanks++;
        rows.push({ id, name: p.name, role: p.role, slot: p.slot, ready: p.ready, afk: p.afk, mobile: p.mobile, bot: p.bot });
      });
      rows.sort((a, b) => (a.role === 'kaiju' ? -1 : 0) - (b.role === 'kaiju' ? -1 : 0) || a.slot - b.slot);
      const sig = JSON.stringify([state.phase, Math.ceil(state.clock), rows, myId, state.mode, state.code, copied]);
      if (sig === lobbySig) return;
      lobbySig = sig;
      const koth = state.mode === 'koth';
      const canKaiju = me.role !== 'kaiju' && (!hasK || kaijuAfk);
      const canTank = me.role === 'kaiju' && tanks < TUNING.maxTanks;
      const status = state.phase === 'countdown'
        ? `Starting in ${Math.max(1, Math.ceil(state.clock))}…`
        : koth ? (rows.length < 2 ? 'Needs at least two players (add a bot to practise).' : 'Everyone is a kaiju. Starts when everyone is ready.')
        : !hasK ? 'Needs a kaiju.'
        : !tanks ? 'Needs at least one tank.'
        : 'Starts when everyone is ready. AFK players don\'t hold it up.';
      const roomRow = state.code ? `<div class="room"><b>${esc(state.code)}</b><small>${state.private ? 'Private room' : 'Public game'} · invite friends</small>` +
        `<button type="button" data-share>${copied === true ? 'COPIED ✓' : 'COPY LINK'}</button></div>` +
        (typeof copied === 'string' ? `<div class="sub">Copy this link: ${esc(copied)}</div>` : '') : '';
      lobby.innerHTML = `<h3>LOBBY</h3><div class="sub">${esc(status)}</div>` + roomRow +
        (state.phase === 'lobby' ? `<div class="kq-modes-label">GAME MODE</div>${modeBar(state.mode)}` : '') + `<ul>` + rows.map(r => {
        const col = r.role === 'kaiju' ? (koth ? kaijuHex(r.slot) : '#7dff8a') : colourHex(r.slot);
        const st = r.afk ? '<span class="st afk">AFK</span>' : r.ready ? '<span class="st ready">READY</span>' : '<span class="st wait">NOT READY</span>';
        const kick = r.id !== myId ? `<button class="kick" type="button" data-kick="${esc(r.id)}" title="Remove from the lobby">✕</button>` : '<span></span>';
        return `<li class="${r.id === myId ? 'me' : ''}"><span class="sw" style="background:${col}"></span>` +
          `<span class="nm">${esc(r.name || 'Player')}<small>${r.role === 'kaiju' ? 'kaiju' : 'tank'}${r.bot ? ' · bot' : ''}${r.mobile ? ' · phone' : ''}${r.id === myId ? ' · you' : ''}</small></span>${st}${kick}</li>`;
      }).join('') + `</ul><div class="acts">` +
        `<button class="rdy${me.ready ? ' on' : ''}" type="button" data-act="ready">${me.ready ? 'NOT READY' : 'READY'}</button>` +
        (koth ? '' : me.role === 'kaiju'
          ? `<button class="swap" type="button" data-act="tank" ${canTank ? '' : 'disabled'}>PLAY TANK</button>`
          : `<button class="swap" type="button" data-act="kaiju" ${canKaiju ? '' : 'disabled'} title="${hasK && !kaijuAfk ? 'Someone is the kaiju' : ''}">PLAY KAIJU</button>`) +
        `</div><div class="bots">` + (koth
          ? `<button type="button" data-bot="kaiju" ${rows.length < 1 + TUNING.maxTanks ? '' : 'disabled'}>+ BOT KAIJU</button>`
          : `<button type="button" data-bot="tank" ${tanks < TUNING.maxTanks ? '' : 'disabled'}>+ BOT TANK</button>` +
            `<button type="button" data-bot="kaiju" ${hasK ? 'disabled' : ''}>+ BOT KAIJU</button>`) + `</div>`;
      lobby.querySelector('[data-share]')?.addEventListener('click', async () => {
        const link = handlers.shareLink?.() || location.href;
        let ok = true;
        try { await navigator.clipboard.writeText(link); } catch { ok = false; }
        (window.__kqShared ||= []).push(link);
        copied = ok ? true : link; lobbySig = ''; setTimeout(() => { copied = false; lobbySig = ''; }, ok ? 2000 : 15000);
      });
      wireModes(lobby);
      lobby.querySelectorAll('[data-bot]').forEach(bt => bt.addEventListener('click', () => handlers.addBot?.(bt.dataset.bot)));
      lobby.querySelectorAll('[data-kick]').forEach(bt => bt.addEventListener('click', () => handlers.kick?.(bt.dataset.kick)));
      lobby.querySelectorAll('[data-act]').forEach(bt => bt.addEventListener('click', () => {
        const a = bt.dataset.act;
        if (a === 'ready') handlers.ready?.(!me.ready); else handlers.role?.(a);
      }));
    },
    // Name tags over every unit that's on screen (everyone sees them).
    updateTags(state, myId, camera, units) {
      const seen = new Set();
      state.players.forEach((p, id) => {
        const u = units.get(id);
        if (!u || (!p.alive && p.role === 'tank')) return;
        const h = p.role === 'kaiju' ? 2.1 : 0.8;
        const s = project(camera, u.display.x, h, u.display.z);
        if (!s.on) return;
        let t = tags.get(id);
        if (!t) { t = el(`<div class="kq-tag"></div>`); tags.set(id, t); }
        const text = (p.name || 'Player') + (id === myId ? ' (you)' : '');
        if (t.textContent !== text) t.textContent = text;
        t.style.setProperty('--c', p.role === 'kaiju' ? kaijuHex(p.slot) : colourHex(p.slot));
        t.hidden = false; t.style.left = `${s.sx}px`; t.style.top = `${s.sy}px`;
        seen.add(id);
      });
      for (const [id, t] of tags) if (!seen.has(id)) { if (!state.players.has(id)) { t.remove(); tags.delete(id); } else t.hidden = true; }
    },
    update({ state, me, myId, camera, units }) {
      if (!state || !me) return;
      const playing = state.phase === 'playing';
      // top bar: health, clock, and the mode's scoreboard
      top.hidden = !(playing || state.phase === 'ended');
      const pts = (v) => Math.floor(v || 0);
      let lead = null;   // King of the Hill leader
      if (state.mode === 'koth') state.players.forEach((p, id) => { if (!lead || p.score > lead.p.score) lead = { p, id }; });
      if (!top.hidden) {
        let hpP = me.role === 'kaiju' ? me : null;
        if (!hpP) state.players.forEach(p => { if (p.role === 'kaiju' && !hpP) hpP = p; });
        const frac = hpP?.maxHp ? hpP.hp / hpP.maxHp : 0;
        top.querySelector('.hp i').style.width = `${Math.max(0, frac) * 100}%`;
        top.querySelector('.hp b').textContent = !hpP ? '' : hpP.alive
          ? `${hpP === me ? 'YOU' : 'KAIJU'} ${Math.ceil(hpP.hp)} / ${hpP.maxHp}` : `${hpP === me ? 'YOU' : 'KAIJU'} DOWN ${Math.ceil(hpP.respawnIn)}s`;
        top.querySelector('.clock').textContent = playing ? fmt(state.clock) : 'END';
        const bonus = state.bonus && state.bonusIn > 0 ? ` ×${TUNING.crateFavor}` : '';
        top.querySelector('.score').innerHTML = state.mode === 'koth'
          ? `★ ${pts(me.score)} <small>you</small>` + (lead && lead.id !== myId ? ` · ${esc(lead.p.name)} ${pts(lead.p.score)}` : lead ? ' · leading' : '')
          : state.mode === 'evac'
          ? `<span class="k">${state.stomped} stomped</span> · <span class="t">${state.evacuated} out</span> <small>of ${TUNING.evacPool}</small>`
          : `<span class="k">KAIJU ${pts(state.kaijuScore)}${state.bonus === 'kaiju' ? bonus : ''}</span> · ` +
            `<span class="t">TANKS ${pts(state.tankScore)}${state.bonus === 'tanks' ? bonus : ''}</span>`;
        top.querySelector('.extra').textContent = !playing ? ''
          : state.mode === 'koth' ? `HILL MOVES ${Math.max(0, Math.ceil(state.hillIn))}s`
          : state.mode === 'race' ? [state.bonusIn > 0 ? `${state.bonus === 'kaiju' ? 'KAIJU' : 'TANK'} BONUS ${Math.ceil(state.bonusIn)}s` : '',
                                     state.healIn > 0 ? `REPAIR ×${TUNING.deathRepairBoost} ${Math.ceil(state.healIn)}s` : ''].filter(Boolean).join(' · ')
          : '';
      }
      // Evacuation: one bar split three ways (stomped · still in the city · escaped)
      split.hidden = !(state.mode === 'evac' && (playing || state.phase === 'ended'));
      if (!split.hidden) {
        const P = TUNING.evacPool;
        split.querySelector('.k').style.width = `${state.stomped / P * 100}%`;
        split.querySelector('.t').style.width = `${state.evacuated / P * 100}%`;
      }
      // gold arrows to the hill / the crate when they're off screen (everyone)
      if (playing && state.mode === 'koth') pointEdge(hillArrow, camera, state.hillX, 0, state.hillZ);
      else hillArrow.hidden = true;
      if (playing && state.mode === 'race' && state.crateOn) pointEdge(crateArrow, camera, state.crateX, 0.3, state.crateZ);
      else crateArrow.hidden = true;

      this.updateLobby(state, me, myId);
      this.updateTags(state, myId, camera, units);

      // banner
      let b = '', big = false;
      if (state.phase === 'countdown') {
        b = String(Math.max(1, Math.ceil(state.clock))); big = true;
      } else if (playing && !me.alive) {
        b = `${me.role === 'tank' ? 'Crushed!' : 'Down!'}<small>Back in action in ${Math.max(1, Math.ceil(me.respawnIn))}</small>`;
      } else if (playing && state.clock > T0() - 2.5) {
        const k = keyNames();
        const kaiju = me.role === 'kaiju';
        const half = Math.floor(TUNING.evacPool / 2) + 1;
        b = state.mode === 'koth'
          ? `KING OF THE HILL<small>Everyone's a kaiju · smash buildings (×${TUNING.hillMultiplier} in the gold ring) and each other · top score wins</small>`
          : state.mode === 'evac'
          ? (kaiju ? `EVACUATION<small>Stomp ${half} of the ${TUNING.evacPool} civilians before they reach the green exits</small>`
                   : `EVACUATION<small>Get ${half} of the ${TUNING.evacPool} civilians to the green exits · wall off the kaiju with roadblocks</small>`)
          : kaiju ? `SMASH!<small>Destroy buildings and crush tanks for points · ${k.smash} smash · ${k.boost} boost · grab the crate</small>`
                  : `HOLD THE CITY<small>Repair damaged buildings and gun down the kaiju for points · ${k.block} roadblock · grab the crate</small>`;
      }
      banner.hidden = !b; banner.innerHTML = b; banner.classList.toggle('big', big);

      // end screen
      end.hidden = state.phase !== 'ended';
      if (!end.hidden) {
        const w = state.winner;
        const winName = state.mode === 'koth' && w !== 'tie' ? (state.players.get(w)?.name || 'Someone') : '';
        const title = w === 'tie' ? 'TIE' : state.mode === 'koth' ? `${winName.toUpperCase()} WINS` : w === 'kaiju' ? 'KAIJU WINS' : 'TANKS WIN';
        const youWon = state.mode === 'koth' ? w === myId : w !== 'tie' && (me.role === 'kaiju') === (w === 'kaiju');
        const detail = state.mode === 'koth'
          ? [...state.players.values()].sort((a, b) => b.score - a.score).map(p => `${esc(p.name)} ${pts(p.score)}`).join(' · ')
          : state.mode === 'evac'
          ? `Stomped ${state.stomped} · Evacuated ${state.evacuated} (of ${TUNING.evacPool})`
          : `Kaiju ${pts(state.kaijuScore)} · Tanks ${pts(state.tankScore)}`;
        const sig = JSON.stringify([w, youWon, detail, Math.ceil(state.clock), state.mode]);
        if (sig !== endSig) {
          endSig = sig;
          const card = end.querySelector('.card');
          card.innerHTML =
            `<h2>${esc(title)}</h2>` +
            `<div>${w === 'tie' ? 'Dead even.' : youWon ? 'You won.' : 'You lost.'}</div>` +
            `<div class="pts">${detail}</div>` +
            `<div>Next round in ${Math.max(0, Math.ceil(state.clock))}</div>` +
            `<div class="kq-modes-label" style="margin-top:14px">NEXT ROUND'S MODE</div>` + modeBar(state.mode).replace('kq-modes"', 'kq-modes" style="margin-top:0"');
          wireModes(card);
        }
      } else endSig = '';

      // ability meter (desktop; phones use the BLOCK button)
      ability.hidden = !playing || mobile || (me.role === 'tank' && !me.alive);
      if (!ability.hidden) {
        const k = keyNames();
        const secs = (v) => `${Math.ceil(v)}s`;
        let text, left, total;
        if (me.role === 'kaiju') {
          text = (me.strikeIn <= 0 ? `${k.smash}  SMASH — ready` : `${k.smash}  SMASH`) + '   ·   ' +
                 (me.boosting ? 'BOOSTING' : me.boostIn > 0 ? `${k.boost}  BOOST  ${secs(me.boostIn)}` : `${k.boost}  BOOST — ready`);
          left = me.boostIn; total = TUNING.boostCooldown;
        } else {
          text = me.blockIn > 0 ? `${k.block}  ROADBLOCK  ${secs(me.blockIn)}` : `${k.block}  ROADBLOCK — ready`;
          left = me.blockIn; total = TUNING.roadblockCooldown;
        }
        ability.classList.toggle('ready', left <= 0);
        ability.querySelector('span').textContent = text;
        ability.querySelector('.bar i').style.width = `${(1 - left / total) * 100}%`;
      }

      // edge arrow: tanks only, when the kaiju is off screen
      let kaijuUnit = null, kaijuState = null;
      state.players.forEach((p, id) => { if (p.role === 'kaiju') { kaijuState = p; kaijuUnit = units.get(id); } });
      edge.hidden = true;
      if (me.role === 'tank' && kaijuUnit && kaijuState.alive && state.phase !== 'ended') {
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
