// Phone controls, both live at once:
//  • TAP anywhere on the city: walk there along the streets (tap a building as
//    the kaiju to walk up and smash it).
//  • DRAG anywhere: a floating stick appears where your thumb landed and follows
//    it if you drag past its edge. The stick cancels any tap route.
// Plus BLOCK (tanks) or BOOST (kaiju) at the bottom right. The kaiju has no
// smash button: it smashes by pushing into buildings or by tapping them.
// Pointer events, so it works with touch, pen and mouse.
import { TUNING } from '../../shared/tuning.js';
import { setTouchVector } from './input.js';

const CSS = `
#kq-stick { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 8; }
#kq-stick b { position: absolute; border-radius: 50%; background: rgba(12,16,24,.35); border: 2px solid rgba(255,255,255,.35); }
#kq-stick i { position: absolute; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
  background: rgba(238,242,246,.85); box-shadow: 0 2px 8px rgba(0,0,0,.5); }
#kq-block, #kq-kboost { position: fixed; right: calc(20px + env(safe-area-inset-right, 0px)); bottom: calc(40px + env(safe-area-inset-bottom, 0px));
  width: 96px; height: 96px; border-radius: 50%; border: 0; z-index: 8; touch-action: none;
  font: 800 15px/1 system-ui, sans-serif; letter-spacing: .05em; box-shadow: 0 3px 10px rgba(0,0,0,.5); }
#kq-block { color: #2a1606; background: #ff9f43; }
#kq-kboost { color: #141a24; background: #f5b82e; }
#kq-block[data-cooling], #kq-kboost[data-cooling] { background: #4a5364; color: #cfd6e0; }
#kq-block small, #kq-kboost small { display: block; font-size: 12px; margin-top: 3px; }
`;

// onTap(clientX, clientY): a tap on the city. surface: the element taps/drags start on (the canvas).
export function createTouchControls({ surface, onTap, onBlock, onBoost }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const stick = document.createElement('div'); stick.id = 'kq-stick'; stick.hidden = true;
  const base = document.createElement('b'), knob = document.createElement('i');
  stick.append(base, knob);
  const block = document.createElement('button'); block.id = 'kq-block'; block.type = 'button'; block.innerHTML = 'BLOCK';
  const kboost = document.createElement('button'); kboost.id = 'kq-kboost'; kboost.type = 'button'; kboost.innerHTML = 'BOOST';
  document.body.append(stick, block, kboost);
  document.body.style.touchAction = 'none';
  addEventListener('contextmenu', e => e.preventDefault());

  const R = () => TUNING.stickRadiusPx;
  let pid = null, start = null, centre = null, dragging = false;
  function draw(tx, ty) {
    const r = R();
    base.style.cssText = `left:${centre.x - r}px; top:${centre.y - r}px; width:${2 * r}px; height:${2 * r}px`;
    knob.style.left = `${tx}px`; knob.style.top = `${ty}px`;
  }
  function drag(e) {
    const r = R();
    let dx = e.clientX - centre.x, dy = e.clientY - centre.y;
    const len = Math.hypot(dx, dy);
    if (len > r) {   // past the edge: the stick follows the thumb
      centre.x += dx * (1 - r / len); centre.y += dy * (1 - r / len);
      dx = e.clientX - centre.x; dy = e.clientY - centre.y;
    }
    draw(e.clientX, e.clientY);
    const mag = Math.min(1, Math.hypot(dx, dy) / r);
    setTouchVector(mag < TUNING.joystickDeadzone ? { x: 0, y: 0 } : { x: dx / r, y: -dy / r });
  }
  function end(e) {
    if (e.pointerId !== pid) return;
    if (!dragging && performance.now() - start.t <= TUNING.tapMaxMs) onTap?.(start.x, start.y);
    if (dragging) setTouchVector(null);
    pid = null; dragging = false; stick.hidden = true;
  }
  surface.addEventListener('pointerdown', e => {
    if (pid !== null) return;          // one finger drives; a second one is ignored
    pid = e.pointerId; surface.setPointerCapture?.(pid);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    centre = { x: e.clientX, y: e.clientY }; dragging = false;
    e.preventDefault();
  });
  surface.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= TUNING.tapSlopPx) { dragging = true; stick.hidden = false; }
    if (dragging) drag(e);
  });
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  block.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); onBlock?.(); });
  kboost.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); onBoost?.(); });
  let lastBoost = '', lastBlock = '';

  return {
    element: { stick, block, kboost },
    get dragging() { return dragging; },
    update(me) {
      if (!me) return;
      const kaiju = me.role === 'kaiju';
      block.hidden = kaiju; kboost.hidden = !kaiju;
      if (kaiju) {
        const bh = me.boosting ? 'GO!' : me.boostIn > 0 ? `BOOST<small>${Math.ceil(me.boostIn)}s</small>` : 'BOOST';
        if (bh !== lastBoost) { kboost.innerHTML = bh; lastBoost = bh; }
        if (me.boostIn > 0 && !me.boosting) kboost.dataset.cooling = ''; else delete kboost.dataset.cooling;
        return;
      }
      const bh = me.blockIn > 0 ? `BLOCK<small>${Math.ceil(me.blockIn)}s</small>` : 'BLOCK';
      if (bh !== lastBlock) { block.innerHTML = bh; lastBlock = bh; }
      if (me.blockIn > 0) block.dataset.cooling = ''; else delete block.dataset.cooling;
    },
  };
}
