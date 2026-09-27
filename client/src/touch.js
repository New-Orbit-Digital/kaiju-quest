// Phone controls for tanks: a joystick (bottom-left) and a BLOCK (roadblock)
// button (bottom-right). Tanks have no boost. Pointer events so it works with touch, pen and mouse.
import { TUNING } from '../../shared/tuning.js';
import { setTouchVector } from './input.js';

const CSS = `
#kq-stick { position: fixed; left: calc(20px + env(safe-area-inset-left, 0px)); bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  width: 136px; height: 136px; border-radius: 50%; background: rgba(12,16,24,.45); border: 2px solid rgba(255,255,255,.35);
  touch-action: none; z-index: 8; }
#kq-stick i { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%;
  background: rgba(238,242,246,.85); box-shadow: 0 2px 8px rgba(0,0,0,.5); }
#kq-block { position: fixed; right: calc(20px + env(safe-area-inset-right, 0px)); bottom: calc(40px + env(safe-area-inset-bottom, 0px));
  width: 96px; height: 96px; border-radius: 50%; border: 0; z-index: 8; touch-action: none;
  font: 800 15px/1 system-ui, sans-serif; letter-spacing: .05em; color: #2a1606; background: #ff9f43;
  box-shadow: 0 3px 10px rgba(0,0,0,.5); }
#kq-block[data-cooling] { background: #4a5364; color: #cfd6e0; }
#kq-block small { display: block; font-size: 12px; margin-top: 3px; }
`;

export function createTouchControls({ onBlock }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const stick = document.createElement('div'); stick.id = 'kq-stick'; stick.innerHTML = '<i></i>';
  const knob = stick.firstChild;
  const block = document.createElement('button'); block.id = 'kq-block'; block.type = 'button';
  block.innerHTML = 'BLOCK';
  document.body.append(stick, block);
  document.body.style.touchAction = 'none';
  addEventListener('contextmenu', e => e.preventDefault());

  let pid = null;
  const radius = 68;
  function move(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = radius;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, len / max);
    if (mag < TUNING.joystickDeadzone) setTouchVector({ x: 0, y: 0 });
    else setTouchVector({ x: dx / max, y: -dy / max });
  }
  function release() { pid = null; knob.style.transform = ''; setTouchVector(null); }
  stick.addEventListener('pointerdown', e => { pid = e.pointerId; stick.setPointerCapture(pid); move(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
  stick.addEventListener('pointerup', e => { if (e.pointerId === pid) release(); });
  stick.addEventListener('pointercancel', e => { if (e.pointerId === pid) release(); });
  block.addEventListener('pointerdown', e => { e.preventDefault(); onBlock?.(); });
  let lastBlock = '';

  return {
    element: { stick, block },
    update(me) {
      if (!me) return;
      const hide = me.role !== 'tank';
      stick.hidden = hide; block.hidden = hide;
      const bh = me.blockIn > 0 ? `BLOCK<small>${Math.ceil(me.blockIn)}s</small>` : 'BLOCK';
      if (bh !== lastBlock) { block.innerHTML = bh; lastBlock = bh; }
      if (me.blockIn > 0) block.dataset.cooling = ''; else delete block.dataset.cooling;
    },
  };
}
