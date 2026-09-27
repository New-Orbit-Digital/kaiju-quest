// Offline stand-in for the Colyseus room: runs the same shared rules
// (shared/game.js) in the browser. Used by the sandbox artifact. One kaiju
// and three tanks join; you drive one at a time and Tab swaps. The others
// sit still, so you can practise stomping or shooting.
import { TUNING } from '../../shared/tuning.js';
import { createGame, plainMake } from '../../shared/game.js';

export function createLocalRoom() {
  const state = plainMake.state();
  const handlers = {};
  const game = createGame({ state, emit: (type, data) => handlers.fx?.({ type, ...data }) });
  game.join('kaiju', { role: 'kaiju', name: 'Kaiju' });
  for (let i = 0; i < TUNING.maxTanks; i++) game.join(`tank${i}`, { role: 'tank', name: `Tank ${i + 1}` });
  for (const id of state.players.keys()) game.setReady(id, true); // sandbox: no lobby wait
  const order = [...state.players.keys()];

  const room = {
    offline: true,
    sessionId: 'kaiju',
    state,
    send(type, msg) {
      if (type === 'input') game.input(room.sessionId, msg);
      else if (type === 'action') game.action(room.sessionId);
    },
    onMessage(type, cb) { handlers[type] = cb; },
    onLeave() {},
    cycle(dir = 1) {
      game.input(room.sessionId, { x: 0, z: 0 });
      const i = order.indexOf(room.sessionId);
      room.sessionId = order[(i + dir + order.length) % order.length];
      return room.sessionId;
    },
  };
  setInterval(() => game.tick(1 / TUNING.tickRate), 1000 / TUNING.tickRate);
  return room;
}
