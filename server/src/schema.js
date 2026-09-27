import { schema, t } from '@colyseus/schema';

export const Soldier = schema({
  x: t.number(), z: t.number(), rot: t.number(),
  alive: t.boolean(), firing: t.boolean(),
}, 'Soldier');

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
  boostIn: t.number(),  // boost cooldown remaining (tanks)
  boosting: t.boolean(),
  strikeIn: t.number(), // strike cooldown remaining (kaiju)
  soldiers: t.array(Soldier),
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
}, 'MatchState');
