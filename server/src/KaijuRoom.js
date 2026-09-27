import { Room } from 'colyseus';
import { MatchState, Player } from './schema.js';
import { TUNING, kaijuSpeedFor } from '../../shared/tuning.js';
import { parseCity, SPAWNS } from '../../shared/map.js';
import { stepUnit } from '../../shared/sim.js';

const city = parseCity();

export class KaijuRoom extends Room {
  maxClients = 1 + TUNING.maxTanks;

  onCreate() {
    this.setState(new MatchState());
    this.inputs = new Map();          // sessionId → { x, z }
    this.destroyed = new Set();       // building ids that are rubble (P02)

    this.onMessage('input', (client, msg) => {
      const x = Number(msg?.x), z = Number(msg?.z);
      this.inputs.set(client.sessionId, {
        x: Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0,
        z: Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0,
      });
    });

    const dtMs = 1000 / TUNING.tickRate;
    this.setPatchRate(dtMs);
    this.setSimulationInterval((ms) => this.tick(ms / 1000), dtMs);
  }

  hasKaiju() {
    for (const p of this.state.players.values()) if (p.role === 'kaiju') return true;
    return false;
  }
  tankCount() {
    let n = 0;
    for (const p of this.state.players.values()) if (p.role === 'tank') n++;
    return n;
  }
  freeSlot() {
    const used = new Set([...this.state.players.values()].map(p => p.slot));
    for (let i = 0; i < TUNING.maxTanks; i++) if (!used.has(i)) return i;
    return -1;
  }

  onJoin(client, options = {}) {
    const wantsKaiju = options.role === 'kaiju';
    const wantsTank = options.role === 'tank';
    let role;
    if (!this.hasKaiju() && !wantsTank) role = 'kaiju';
    else if (wantsKaiju && !this.hasKaiju()) role = 'kaiju';
    else role = 'tank';

    const p = new Player();
    p.role = role;
    p.moving = false;
    if (role === 'kaiju') {
      p.slot = -1;
      p.x = SPAWNS.kaiju.x; p.z = SPAWNS.kaiju.z; p.rot = 0;
    } else {
      const slot = this.freeSlot();
      if (slot < 0) throw new Error('No tank seats left');
      p.slot = slot;
      const s = SPAWNS.tanks[slot % SPAWNS.tanks.length];
      p.x = s.x; p.z = s.z; p.rot = 0;
    }
    this.state.players.set(client.sessionId, p);
    this.updateScaling();
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.updateScaling();
  }

  updateScaling() {
    this.state.kaijuSpeed = kaijuSpeedFor(this.tankCount());
  }

  tick(dt) {
    const isRubble = (id) => this.destroyed.has(id);
    for (const [id, p] of this.state.players) {
      const input = this.inputs.get(id);
      const speed = p.role === 'kaiju' ? this.state.kaijuSpeed : TUNING.tankSpeed;
      const r = p.role === 'kaiju' ? TUNING.kaijuRadius : TUNING.tankRadius;
      const unit = { role: p.role, x: p.x, z: p.z, rot: p.rot };
      const moved = stepUnit(city, unit, input, dt, speed, r, isRubble);
      if (unit.x !== p.x) p.x = unit.x;
      if (unit.z !== p.z) p.z = unit.z;
      if (unit.rot !== p.rot) p.rot = unit.rot;
      if (moved !== p.moving) p.moving = moved;
    }
  }
}
