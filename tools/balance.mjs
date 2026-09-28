// Bot-vs-bot balance check: plays full rounds with computer players at every
// tank count and prints average scores. Bots are simple, so treat this as a
// rough first pass before real playtests, not a verdict.
//   node tools/balance.mjs [mode=race] [rounds=4]
import { createGame, plainMake } from '../shared/game.js';
import { createBots } from '../shared/bots.js';
import { TUNING as T } from '../shared/tuning.js';

const mode = process.argv[2] || 'race', rounds = Number(process.argv[3] || 4);
const rows = [];
for (let tanks = 1; tanks <= T.maxTanks; tanks++) {
  const acc = { k: 0, t: 0, kWins: 0, tWins: 0, ties: 0, kills: 0, crushes: 0, crates: 0, evac: 0, stomp: 0, city0: 0, city1: 0 };
  for (let r = 0; r < rounds; r++) {
    let seed = 1000 * tanks + r + 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const state = plainMake.state();
    const ev = {};
    const g = createGame({ state, rng, emit: (type) => { ev[type] = (ev[type] || 0) + 1; } });
    g.setMode(null, mode);
    const bots = createBots(g, state);
    if (mode !== 'koth') bots.add('kaiju');
    for (let i = 0; i < (mode === 'koth' ? tanks + 1 : tanks); i++) bots.add('tank');
    let city0 = null;
    for (let s = 0; s < (T.countdownSeconds + 60 * 20) * 20 && state.phase !== 'ended'; s++) {
      bots.tick(0.05); g.tick(0.05);
      if (city0 === null && state.phase === 'playing') city0 = state.cityHp;
    }
    acc.city0 += city0 ?? 1; acc.city1 += state.cityHp;
    acc.k += state.kaijuScore; acc.t += state.tankScore;
    if (state.winner === 'kaiju') acc.kWins++; else if (state.winner === 'tanks') acc.tWins++; else acc.ties++;
    acc.kills += ev.kaijuDown || 0; acc.crushes += ev.tankDown || 0; acc.crates += ev.crate || 0;
    acc.evac += state.evacuated; acc.stomp += state.stomped;
  }
  const avg = (v) => Math.round(v / rounds);
  rows.push(mode === 'evac'
    ? { tanks, stomped: avg(acc.stomp), evacuated: avg(acc.evac), kaijuWins: acc.kWins, tankWins: acc.tWins, ties: acc.ties, kaijuDeaths: avg(acc.kills) }
    : mode === 'koth' ? { kaiju: tanks + 1, kaijuKOs: avg(acc.kills) }
    : { tanks, cityStart: (acc.city0 / rounds).toFixed(3), cityEnd: (acc.city1 / rounds).toFixed(3), kaijuWins: acc.kWins, tankWins: acc.tWins,
        kaijuPts: avg(acc.k), tankPts: avg(acc.t),
        kaijuDeaths: avg(acc.kills), tankCrushes: avg(acc.crushes), crates: avg(acc.crates) });
}
console.log(`mode=${mode}, ${rounds} bot rounds per row`);
console.table(rows);
