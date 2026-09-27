// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — THE CITY (v2 fixed map, 31×31)
//  One character = one tile. Edit freely; keep every row the same
//  length and keep every building lot touching a street.
//
//    #  street            h  suburban house
//    c  commercial        i  industrial
//    T  tower (2×2 lot: T is the top-left, t fills the other 3)
//    t  tower fill        g  park (blocked for everyone, has trees)
//
//  North is the top row. x grows to the right, z grows downward.
//
//  Districts: NW suburb grid · NE long east–west blocks (hide behind
//  them) · W long north–south blocks · downtown towers round a park
//  plaza · E industrial rail yard · SW suburb · SE long north–south
//  blocks. Rows 0, 3, 6, 9, 20, 30 and columns 0 and 30 run the full
//  width with no turns.
// ─────────────────────────────────────────────────────────────

export const CITY = `
###############################
#hhch#hhhh#hhcc#cTtccTtcccTtcc#
#hhhh#hchh#hhhc#cttccttcccttcc#
###############################
#hhhh#chhh#hhhh#ccchhc#iiiiiii#
#hghh#hhhh#hhch#chhhcc#iicciii#
###############################
#hhhh#hhcchhcch#iiiiiicccc#hhh#
#hhhh#hhhhhcchh#iiiiccccic#hch#
###############################
#hh#cc#cc#Tt#Tt#Tt#Tt#iiiiiiii#
#hh#ch#ci#tt#tt#tt#tt#iiiicccc#
#hh#hc#cc######################
#hh#cc#ii#cc#ggggg#cc#iiiiiiii#
#hh#cc####cc#ggggg#cc#iggggggi#
#hh#hh#ii#cc#ggggg#ic#iggggggi#
#hh#cc#ic#ci#ggggg#cc#iiiiiiii#
#hh#ch#cc######################
#hh#cc#ci#Tt#Tt#Tt#Tt#ciiiiiii#
#hh#cc#cc#tt#tt#tt#tt#cciiiiii#
###############################
#hhhhchhhh#hhhh#cc#cc#hh#hh#cc#
#hhhhhhhch#hchh#hc#cc#hh#hh#hc#
################hh#ci#hc#hh#hh#
#hhhh#hhhh#chhh#ch#ii#cc#hc#hh#
#hhhh#hhhh#hhhc####ii####hh#hh#
################hh#ii#hh#hh#hh#
#hhhh#hhhh#hhhh#hh#ic#ch#ch#hh#
#hggh#hggh#hggh#ch#cc#hh#hh#ch#
#hhhh#hhch#hhhh#hh#cc#hh#hh#hh#
###############################
`;

// Where things start. Tiles, not pixels. Must be street tiles.
export const SPAWNS = {
  kaiju: { x: 15, z: 12 },
  tanks: [ { x: 0, z: 0 }, { x: 30, z: 30 }, { x: 30, z: 0 }, { x: 0, z: 30 }, { x: 15, z: 0 }, { x: 15, z: 30 } ],
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
