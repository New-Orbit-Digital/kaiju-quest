import { Room } from 'colyseus';
import { MatchState, Player, Soldier } from './schema.js';
import { TUNING } from '../../shared/tuning.js';
import { createGame } from '../../shared/game.js';

// Thin wrapper: all rules live in shared/game.js.
export class KaijuRoom extends Room {
  maxClients = 1 + TUNING.maxTanks;

  onCreate() {
    const state = new MatchState();
    state.phase = 'waiting'; state.clock = 0; state.winner = '';
    state.kaijuHp = 0; state.kaijuMaxHp = 0; state.kaijuScore = 0; state.kaijuSpeed = 0;
    this.setState(state);
    this.game = createGame({
      state: this.state,
      make: { player: () => new Player(), soldier: () => new Soldier() },
      emit: (type, data) => this.broadcast('fx', { type, ...data }),
    });

    this.onMessage('input', (client, msg) => this.game.input(client.sessionId, msg));
    this.onMessage('action', (client) => this.game.action(client.sessionId));

    const dtMs = 1000 / TUNING.tickRate;
    this.setPatchRate(dtMs);
    this.setSimulationInterval((ms) => this.game.tick(Math.min(ms, 250) / 1000), dtMs);
  }

  onJoin(client, options = {}) {
    this.game.join(client.sessionId, { role: options.role, mobile: !!options.mobile });
  }

  onLeave(client) {
    this.game.leave(client.sessionId);
  }
}
