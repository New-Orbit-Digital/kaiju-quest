// Offline stand-in for the Colyseus room: runs the same shared movement
// rules in the browser. Used by the sandbox (no server). One kaiju and
// three tanks; you drive one of them at a time and Tab swaps.
import { TUNING, kaijuSpeedFor } from '../../shared/tuning.js';
import { parseCity, SPAWNS } from '../../shared/map.js';
import { stepUnit } from '../../shared/sim.js';

export function createLocalRoom() {
  const city = parseCity();
  const players = new Map();
  players.set('kaiju', { role: 'kaiju', slot: -1, x: SPAWNS.kaiju.x, z: SPAWNS.kaiju.z, rot: 0, moving: false });
  for (let i = 0; i < TUNING.maxTanks; i++) {
    const s = SPAWNS.tanks[i % SPAWNS.tanks.length];
    players.set(`tank${i}`, { role: 'tank', slot: i, x: s.x, z: s.z, rot: 0, moving: false });
  }
  const order = [...players.keys()];
  const inputs = new Map();
  const state = { players, kaijuSpeed: kaijuSpeedFor(TUNING.maxTanks) };

  const room = {
    offline: true,
    sessionId: 'kaiju',
    state,
    send(type, msg) { if (type === 'input') inputs.set(room.sessionId, msg); },
    onLeave() {},
    // switch which unit you drive; returns the new id
    cycle(dir = 1) {
      inputs.delete(room.sessionId);
      const i = order.indexOf(room.sessionId);
      room.sessionId = order[(i + dir + order.length) % order.length];
      return room.sessionId;
    },
  };

  const dt = 1 / TUNING.tickRate;
  setInterval(() => {
    for (const [id, p] of players) {
      const speed = p.role === 'kaiju' ? state.kaijuSpeed : TUNING.tankSpeed;
      const r = p.role === 'kaiju' ? TUNING.kaijuRadius : TUNING.tankRadius;
      p.moving = stepUnit(city, p, inputs.get(id), dt, speed, r, () => false);
    }
  }, 1000 / TUNING.tickRate);
  return room;
}
