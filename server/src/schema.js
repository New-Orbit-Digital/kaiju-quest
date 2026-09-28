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
  slot: t.number(),     // colour slot 0..n (the single kaiju in Points race / Evacuation = -1)
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
  hp: t.number(), maxHp: t.number(), // kaiju health
  score: t.number(),    // personal points (King of the Hill ranks by this)
}, 'Player');

export const MatchState = schema({
  phase: t.string(),    // lobby | countdown | playing | ended
  clock: t.number(),    // seconds left in the current phase
  winner: t.string(),
  kaijuScore: t.number(),
  tankScore: t.number(),
  kaijuSpeed: t.number(),
  players: t.map(Player),
  buildingHp: t.array('number'),
  rebuildHp: t.array('number'),   // Save the City!: rubble rebuilding progress
  cityHp: t.number(),   // Save the City!: city health 0…1
  roadblocks: t.map(Roadblock),
  code: t.string(),     // room code for share links (every room has one)
  private: t.boolean(), // private rooms never get random players
  mode: t.string(),     // 'race' | 'koth' | 'evac'
  hillX: t.number(), hillZ: t.number(), // King of the Hill centre
  hillIn: t.number(),   // seconds until the hill moves
  target: t.number(),   // King of the Hill: first to this score wins
  evacuated: t.number(),// Evacuation: civilians out so far
  stomped: t.number(),  // Evacuation: civilians the kaiju got
  bonus: t.string(),    // crate tilt: '' | 'kaiju' | 'tanks'
  bonusIn: t.number(),  // seconds of tilt left
  healIn: t.number(),   // seconds of faster repair left (after a kaiju kill)
  crateOn: t.boolean(), crateX: t.number(), crateZ: t.number(), crateIn: t.number(),
  civilians: t.map(Civilian),
}, 'MatchState');
