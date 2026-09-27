// Which Kenney model sits on which lot. Pure data (no three.js) so the
// sandbox build can work out exactly which files the city needs.
// Building pools per lot kind (models chosen by lot id so the map is stable).
const letters = (from, to) => {
  const out = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};
const POOLS = {
  house:      letters('a', 'u').map(l => `suburbs/building-type-${l}`),
  commercial: [...letters('a', 'i'), 'l', 'm'].map(l => `commercial/building-${l}`),
  industrial: letters('a', 't').map(l => `industrial/building-${l}`),
  tower:      letters('a', 'e').map(l => `commercial/building-skyscraper-${l}`),
};

export function modelForBuilding(b) {
  const pool = POOLS[b.kind];
  return pool[(b.id * 7 + 3) % pool.length];
}
export const ROAD_MODELS = ['roads/road-crossroad', 'roads/road-intersection', 'roads/road-straight', 'roads/road-bend', 'roads/road-end'];
export const TREE_MODELS = ['suburbs/tree-large', 'suburbs/tree-small'];
