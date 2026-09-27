import { Room } from 'colyseus';
import { MatchState, Player, Soldier } from './schema.js';
import { TUNING } from '../../shared/tuning.js';
import { createGame } from '../../shared/game.js';

// Thin wrapper: all rules live in shared/game.js.
export class KaijuRoom extends Room {
  maxClients = 1 + TUNING.maxTanks;

  onCreate() {
    const state = new MatchState();
    state.phase = 'lobby'; state.clock = 0; state.winner = '';
    state.kaijuHp = 0; state.kaijuMaxHp = 0; state.kaijuScore = 0; state.kaijuSpeed = 0;
    this.setState(state);
    this.game = createGame({
      state: this.state,
      make: { player: () => new Player(), soldier: () => new Soldier() },
      emit: (type, data) => this.broadcast('fx', { type, ...data }),
    });

    this.onMessage('input', (client, msg) => this.game.input(client.sessionId, msg));
    this.onMessage('action', (client) => this.game.action(client.sessionId));
    this.onMessage('ready', (client, msg) => this.game.setReady(client.sessionId, !!msg?.ready));
    this.onMessage('role', (client, msg) => this.game.setRole(client.sessionId, msg?.role));
    this.onMessage('name', (client, msg) => this.game.setName(client.sessionId, msg?.name));
    // Anyone can remove another player from the lobby (for ghosts / old tabs).
    this.onMessage('kick', (client, msg) => {
      if (this.state.phase !== 'lobby' || msg?.id === client.sessionId) return;
      const target = this.clients.find(c => c.sessionId === msg?.id);
      if (target) { this.broadcast('fx', { type: 'kicked', id: msg.id, by: this.state.players.get(client.sessionId)?.name || '' }); target.leave(4001); }
    });

    const dtMs = 1000 / TUNING.tickRate;
    this.setPatchRate(dtMs);
    this.setSimulationInterval((ms) => this.game.tick(Math.min(ms, 250) / 1000), dtMs);
  }

  onJoin(client, options = {}) {
    this.game.join(client.sessionId, { role: options.role, mobile: !!options.mobile, name: options.name });
  }

  onLeave(client) {
    this.game.leave(client.sessionId);
  }
}
