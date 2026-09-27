// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — THE CITY (v1 fixed map)
//  One character = one tile. Edit freely; keep every row the same
//  length and keep every building lot touching a street.
//
//    #  street            h  suburban house
//    c  commercial        i  industrial
//    T  tower (2×2 lot: T is the top-left, t fills the other 3)
//    t  tower fill        g  park (blocked for everyone, has trees)
//
//  North is the top row. x grows to the right, z grows downward.
// ─────────────────────────────────────────────────────────────

export const CITY = `
#########################
#hh#hh#hh#hh#hh#cc#hh#cc#
#hh#hh#hh#hh#hh#ch#hh#hc#
#########################
#hh#hh#hh#hh#hc#hh#gg#hh#
#hh#hh#hh#hh#hh#hh#gg#hh#
#hh###################hh#
#hh#hh#cc#ch#hh#cc#hh#ch#
#hh#hh#cc#cc#cc#cc#hh#hc#
####hh###################
#hh#hh#cc#Tt#Tt#cc#cc#hh#
#hh#hh#cc#tt#tt#cc#cc#hh#
#########################
#hh#hh#cc#Tt#Tt#cc#ii#ii#
#hh#hh#ci#tt#tt#cc#ii#ii#
######################ii#
#hh#hh#ic#cc#cc#cc#ii#ii#
#hh#hh#cc#cc#cc#ic#ii#ii#
#hh################ii####
#hh#gg#hh#hh#ii#ii#ii#ii#
#hh#gg#hh#hh#ii#ii#ii#ii#
################ii#######
#hh#hh#hh#hh#ii#ii#ii#ii#
#hh#hh#hh#hh#ii#ii#ii#ii#
#########################
`;

// Where things start. Tiles, not pixels. Must be street tiles.
export const SPAWNS = {
  kaiju: { x: 12, z: 12 },
  tanks: [ { x: 0, z: 0 }, { x: 24, z: 0 }, { x: 0, z: 24 }, { x: 24, z: 24 } ],
};

const KIND = { h: 'house', c: 'commercial', i: 'industrial', T: 'tower', g: 'park' };

// Parse the ASCII into a grid + a building list.
// Each building gets an id; tower fill tiles point at their tower.
export function parseCity(text = CITY) {
  const rows = text.split('\n').map(r => r.trimEnd()).filter(r => r.length);
  const depth = rows.length, width = rows[0].length;
  rows.forEach((r, z) => {
    if (r.length !== width) throw new Error(`map row ${z} is ${r.length} wide, expected ${width}`);
  });

  const tiles = rows.map(r => r.split(''));
  const owner = rows.map(r => new Array(r.length).fill(-1)); // tile → building id
  const buildings = [];

  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const ch = tiles[z][x];
      if (ch === '#' || ch === 't') continue;
      const kind = KIND[ch];
      if (!kind) throw new Error(`unknown map character '${ch}' at x=${x} z=${z}`);
      const size = ch === 'T' ? 2 : 1;
      const b = { id: buildings.length, kind, x, z, size, cells: [] };
      for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) {
        if (size === 2 && (dx || dz) && tiles[z + dz]?.[x + dx] !== 't') {
          throw new Error(`tower at x=${x} z=${z} needs 't' at x=${x + dx} z=${z + dz}`);
        }
        owner[z + dz][x + dx] = b.id;
        b.cells.push([x + dx, z + dz]);
      }
      // centre of the lot, in tile coordinates (tile centres are integers)
      b.cx = x + (size - 1) / 2;
      b.cz = z + (size - 1) / 2;
      buildings.push(b);
    }
  }
  return { width, depth, tiles, owner, buildings };
}

export function isStreet(city, x, z) {
  return city.tiles[z]?.[x] === '#';
}
