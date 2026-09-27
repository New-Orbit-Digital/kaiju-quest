import { schema, t } from '@colyseus/schema';

export const Civilian = schema({
  x: t.number(), z: t.number(), rot: t.number(),
  moving: t.boolean(),
  look: t.number(),     // picks the shirt colour
}, 'Civilian');

export const Roadblock = schema({
  x: t.number(), z: t.number(),
  hits: t.number(),     // smashes left
  slot: t.number(),     // colour of the tank that dropped it
  rot: t.number(),      // 0 = barrier runs east–west, π/2 = north–south (always across the road)
}, 'Roadblock');

export const Player = schema({
  name: t.string(),
  ready: t.boolean(),   // lobby ready-up
  afk: t.boolean(),     // no input for TUNING.afkSeconds
  role: t.string(),     // 'kaiju' | 'tank'
  slot: t.number(),     // tank colour slot 0..n (kaiju = -1)
  mobile: t.boolean(),
  x: t.number(), z: t.number(), rot: t.number(),
  moving: t.boolean(),
  alive: t.boolean(),
  respawnIn: t.number(),
  boostIn: t.number(),  // boost cooldown remaining (kaiju)
  boosting: t.boolean(),
  strikeIn: t.number(), // strike cooldown remaining (kaiju)
  blockIn: t.number(),  // roadblock cooldown remaining (tanks)
  bot: t.boolean(),     // computer-controlled
  repairing: t.boolean(), // tank is fixing a building right now (drives the repair sound)
}, 'Player');

export const MatchState = schema({
  phase: t.string(),    // lobby | countdown | playing | ended
  clock: t.number(),    // seconds left in the current phase
  winner: t.string(),
  kaijuHp: t.number(),
  kaijuMaxHp: t.number(),
  kaijuScore: t.number(),
  kaijuSpeed: t.number(),
  players: t.map(Player),
  buildingHp: t.array('number'),
  roadblocks: t.map(Roadblock),
  mode: t.string(),     // 'ffa' | 'koth' | 'evac'
  hillX: t.number(), hillZ: t.number(), // King of the Hill centre
  hillIn: t.number(),   // seconds until the hill moves
  evacuated: t.number(),// Evacuation: civilians out so far
  civilians: t.map(Civilian),
}, 'MatchState');
