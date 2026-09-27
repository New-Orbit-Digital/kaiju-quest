import { schema, t } from '@colyseus/schema';

export const Player = schema({
  role: t.string(),     // 'kaiju' | 'tank'
  slot: t.number(),     // tank colour slot 0..n (kaiju = -1)
  x: t.number(),
  z: t.number(),
  rot: t.number(),
  moving: t.boolean(),
}, 'Player');

export const MatchState = schema({
  players: t.map(Player),
  kaijuSpeed: t.number(),
}, 'MatchState');
