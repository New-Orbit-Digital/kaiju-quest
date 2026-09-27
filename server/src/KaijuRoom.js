import { Room } from 'colyseus';
import { MatchState, Player, Civilian, Roadblock } from './schema.js';
import { TUNING } from '../../shared/tuning.js';
import { createGame, KAIJU_SEATS } from '../../shared/game.js';
import { createBots } from '../../shared/bots.js';

// Room codes: every room gets one (share links); private rooms are also
// hidden from PLAY matchmaking. code → roomId, for this server process.
const codes = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I / O (look like 1 / 0)
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < TUNING.roomCodeLength; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!codes.has(c)) return c;
  }
}
export const roomIdForCode = (code) => codes.get(String(code || '').toUpperCase().trim());

// Thin wrapper: all rules live in shared/game.js.
export class KaijuRoom extends Room {
  maxClients = KAIJU_SEATS;

  onCreate(options = {}) {
    const state = new MatchState();
    state.code = newCode(); state.private = !!options.private;
    codes.set(state.code, this.roomId);
    this.setMetadata({ code: state.code });
    if (state.private) this.setPrivate(true);
    state.phase = 'lobby'; state.clock = 0; state.winner = '';
    state.kaijuScore = 0; state.tankScore = 0; state.kaijuSpeed = 0;
    state.mode = ''; state.hillX = 0; state.hillZ = 0; state.hillIn = 0; state.evacuated = 0; state.stomped = 0;
    state.bonus = ''; state.bonusIn = 0; state.healIn = 0; state.crateOn = false; state.crateX = 0; state.crateZ = 0; state.crateIn = 0;
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
    // Test hook for the automated browser checks only (never set in production).
    if (process.env.KQ_TEST) {
      this.onMessage('debugTeleport', (client, msg) => this.game.teleport(client.sessionId, Number(msg?.x), Number(msg?.z)));
      this.onMessage('debugCrate', () => this.game.spawnCrate());
    }
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

  onDispose() { codes.delete(this.state.code); }

  onJoin(client, options = {}) {
    // people outrank bots: free a seat held by a bot if needed
    let tanks = 0, botTank = null, botKaiju = null;
    this.state.players.forEach((p, id) => {
      if (p.role === 'tank') { tanks++; if (p.bot) botTank = id; }
      else if (p.bot) botKaiju = id;
    });
    const full = this.state.mode === 'koth' ? this.state.players.size >= KAIJU_SEATS : tanks >= TUNING.maxTanks;
    if (full) { const b = botTank || botKaiju; if (b) this.bots.remove(b); }
    this.game.join(client.sessionId, { role: options.role, mobile: !!options.mobile, name: options.name });
  }

  onLeave(client) {
    this.game.leave(client.sessionId);
  }
}
