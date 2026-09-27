// Offline stand-in for the Colyseus room: runs the same shared rules
// (shared/game.js) in the browser. Used by the sandbox artifact. A kaiju and
// three tanks join as bots; you drive one of them (Tab swaps) and the bots
// play the rest.
import { TUNING } from '../../shared/tuning.js';
import { createGame, plainMake } from '../../shared/game.js';
import { createBots } from '../../shared/bots.js';

export function createLocalRoom() {
  const state = plainMake.state();
  const handlers = {};
  const game = createGame({ state, emit: (type, data) => handlers.fx?.({ type, ...data }) });
  const bots = createBots(game, state);
  const kaijuId = bots.add('kaiju');
  for (let i = 0; i < Math.min(3, TUNING.maxTanks); i++) bots.add('tank');
  const order = [...state.players.keys()];

  const room = {
    offline: true,
    sessionId: kaijuId,
    state,
    send(type, msg) {
      if (type === 'input') game.input(room.sessionId, msg);
      else if (type === 'action') game.action(room.sessionId);
      else if (type === 'block') game.block(room.sessionId);
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
  const dt = 1 / TUNING.tickRate;
  setInterval(() => { bots.tick(dt, room.sessionId); game.tick(dt); }, 1000 / TUNING.tickRate);
  return room;
}
