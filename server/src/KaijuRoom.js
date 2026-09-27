import { Room } from 'colyseus';
import { MatchState, Player, Civilian, Roadblock } from './schema.js';
import { TUNING } from '../../shared/tuning.js';
import { createGame } from '../../shared/game.js';
import { createBots } from '../../shared/bots.js';

// Thin wrapper: all rules live in shared/game.js.
export class KaijuRoom extends Room {
  maxClients = 1 + TUNING.maxTanks;

  onCreate() {
    const state = new MatchState();
    state.phase = 'lobby'; state.clock = 0; state.winner = '';
    state.kaijuHp = 0; state.kaijuMaxHp = 0; state.kaijuScore = 0; state.kaijuSpeed = 0;
    state.mode = ''; state.hillX = 0; state.hillZ = 0; state.hillIn = 0; state.evacuated = 0;
    this.setState(state);
    this.game = createGame({
      state: this.state,
      make: { player: () => new Player(), civilian: () => new Civilian(), roadblock: () => new Roadblock() },
      emit: (type, data) => this.broadcast('fx', { type, ...data }),
    });

    this.bots = createBots(this.game, this.state);
    // Lobby: add a computer player (always ready). Remove it with the lobby ✕.
    this.onMessage('addBot', (client, msg) => {
      if (this.state.phase !== 'lobby') return;
      this.bots.add(msg?.role === 'kaiju' ? 'kaiju' : 'tank');
    });
    this.onMessage('input', (client, msg) => this.game.input(client.sessionId, msg));
    this.onMessage('action', (client) => this.game.action(client.sessionId));
    this.onMessage('block', (client) => this.game.block(client.sessionId));
    this.onMessage('boost', (client) => this.game.boost(client.sessionId));
    this.onMessage('ready', (client, msg) => this.game.setReady(client.sessionId, !!msg?.ready));
    this.onMessage('role', (client, msg) => this.game.setRole(client.sessionId, msg?.role));
    this.onMessage('name', (client, msg) => this.game.setName(client.sessionId, msg?.name));
    this.onMessage('mode', (client, msg) => this.game.setMode(client.sessionId, String(msg?.mode || '')));
    // Anyone can remove another player from the lobby (for ghosts / old tabs).
    this.onMessage('kick', (client, msg) => {
      if (this.state.phase !== 'lobby' || msg?.id === client.sessionId) return;
      if (this.bots.has(msg?.id)) { this.bots.remove(msg.id); return; }
      const target = this.clients.find(c => c.sessionId === msg?.id);
      if (target) { this.broadcast('fx', { type: 'kicked', id: msg.id, by: this.state.players.get(client.sessionId)?.name || '' }); target.leave(4001); }
    });

    const dtMs = 1000 / TUNING.tickRate;
    this.setPatchRate(dtMs);
    this.setSimulationInterval((ms) => {
      const dt = Math.min(ms, 250) / 1000;
      this.bots.tick(dt);
      this.game.tick(dt);
    }, dtMs);
  }

  onJoin(client, options = {}) {
    // people outrank bots: free a tank seat (or the kaiju seat) held by a bot if needed
    let tanks = 0, botTank = null, botKaiju = null;
    this.state.players.forEach((p, id) => {
      if (p.role === 'tank') { tanks++; if (p.bot) botTank = id; }
      else if (p.bot) botKaiju = id;
    });
    if (tanks >= TUNING.maxTanks && botTank) this.bots.remove(botTank);
    else if (tanks >= TUNING.maxTanks && botKaiju) this.bots.remove(botKaiju);
    this.game.join(client.sessionId, { role: options.role, mobile: !!options.mobile, name: options.name });
  }

  onLeave(client) {
    this.game.leave(client.sessionId);
  }
}
