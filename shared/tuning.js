// ═════════════════════════════════════════════════════════════════
//  KAIJU QUEST — TUNING
//
//  This is the only file you need to change the game's numbers.
//  Find the character, change the number after the colon, save.
//
//  • Units: distance is in TILES (one street is 1 tile wide),
//    time is in SECONDS, speed is TILES PER SECOND.
//  • "Every N seconds" values: LOWER = FASTER (e.g. fire rate).
//  • To see a change live: push to GitHub → Render redeploys (~2 min).
//    Running locally: restart the server and reload the page.
//  • Only change the numbers. Keep the names, colons and commas.
// ═════════════════════════════════════════════════════════════════

export const TUNING = {

  // ───────────────────────────────────────────────────────────────
  //  DAMAGE & RANGE  (every attack in the game, in one place)
  //  Ranges are measured centre-to-centre in tiles. A street is 1 tile.
  // ───────────────────────────────────────────────────────────────

  // Kaiju SMASH (SPACE) — hits a building. Damage to buildings is permanent.
  strikeDamage:       10,    // building HP removed per smash
  strikeRange:        1,     // how far the kaiju can reach a building, tiles
                             // (1 = the building right beside it, 1.5 = diagonals too,
                             //  2 = one tile further away)
  strikeCooldown:     0.5,   // seconds between smashes (lower = faster)
  strikeRoot:         0.35,  // seconds the kaiju is stuck in place after a smash

  // Kaiju STOMP — walking into a tank or soldier kills it instantly.
  stompReach:         0.05,  // extra reach beyond touching, tiles (0.3 = stomps from further)

  // Tank CANNON — fires on its own whenever the kaiju is in range.
  tankDamage:         5,     // kaiju HP removed per shot
  tankRange:          6,     // firing range, tiles
  tankFireInterval:   1.2,   // one shot every N seconds (lower = faster)

  // Soldier RIFLES — each soldier fires on its own when the kaiju is in range.
  soldierDamage:      1,  // kaiju HP removed per shot (each soldier)
  soldierRange:       4,     // firing range, tiles
  soldierFireInterval: 1.0,  // one shot every N seconds, per soldier (lower = faster)

  // ───────────────────────────────────────────────────────────────
  //  KAIJU
  // ───────────────────────────────────────────────────────────────
  kaijuSpeed:         2.7,   // walking speed, tiles/sec (with no tanks in the game)
  kaijuSpeedPerTank:  0.05,  // +5% speed for each tank player (0.10 = +10%)
  kaijuHpPerTank:     100,   // kaiju health = this × number of tanks (no regen)
  viewTilesKaiju:     15,    // ZOOM: tiles visible top-to-bottom (bigger = zoomed out)

  kaijuLength:        2.5,   // how big the T-Rex is drawn, nose to tail (visual only)

  // ───────────────────────────────────────────────────────────────
  //  TANKS
  // ───────────────────────────────────────────────────────────────
  tankSpeed:          3.5,   // driving speed, tiles/sec
  viewTilesTank:      11,    // ZOOM on desktop: tiles visible top-to-bottom
  viewTilesMobile:    12,    // ZOOM on phones (portrait uses this across the width)

  // Boost (SPACE / phone BOOST button)
  boostMultiplier:    2.0,   // speed × this while boosting
  boostSeconds:       1.5,   // how long a boost lasts
  boostCooldown:      10,    // seconds before boost can be used again

  // Repair — a tank near a damaged building fixes it (not destroyed ones).
  repairRange:        1.5,   // tiles from the tank to the building
  repairPerSecond:    4,     // building HP restored per second, per tank

  // Roadblocks (SHIFT / phone BLOCK button) — dropped behind the tank.
  // They only block the kaiju; tanks and soldiers drive through.
  roadblockCooldown:  10,    // seconds between drops
  roadblockHits:      2,     // kaiju smashes needed to break one
  roadblockMaxPerTank: 3,    // dropping another removes that tank's oldest

  // Getting crushed
  tankRespawnSeconds: 3,     // seconds until a crushed tank comes back
  respawnMinDistance: 12,    // respawn at least this many tiles from the kaiju
                             // (also always outside the kaiju's view)

  tankLength:         0.8,   // how big a tank is drawn (visual only)

  // ───────────────────────────────────────────────────────────────
  //  SOLDIERS  (a squad follows each tank; they respawn with it)
  // ───────────────────────────────────────────────────────────────
  soldiersPerTank:    4,     // squad size
  soldierSpacing:     0.35,  // how far behind the tank each pair walks
  soldierSpread:      0.2,   // how far to the side of the tank's path they walk
  soldierHeight:      0.2,  // how big a soldier is drawn (visual only)

  // ───────────────────────────────────────────────────────────────
  //  BUILDINGS & POINTS  (points go to the kaiju)
  // ───────────────────────────────────────────────────────────────
  buildingHp:     { house: 20, commercial: 40, industrial: 40, tower: 80 },
  buildingPoints: { house: 10, commercial: 25, industrial: 25, tower: 60 },
  pointsTankKill:     50,    // kaiju walks into a tank
  pointsSoldierKill:  10,    // kaiju walks into a soldier

  // ───────────────────────────────────────────────────────────────
  //  MATCH
  // ───────────────────────────────────────────────────────────────
  matchSeconds:       300,   // round length (kaiju wins if still alive at 0)
  countdownSeconds:   10,     // "3-2-1" before a round
  endScreenSeconds:   12,    // results screen, then the next round starts
  maxTanks:           6,     // tank seats per game
  afkSeconds:         60,    // lobby: no key press / stick move for this long = AFK.
                             // AFK players don't block the start, and anyone can take
                             // an AFK kaiju's seat.

  // ───────────────────────────────────────────────────────────────
  //  PHONES  (phones always play a tank)
  // ───────────────────────────────────────────────────────────────
  mobileMarkers:      true,  // arrows over the kaiju + other tanks (phones only)
  joystickSnap:       true,  // joystick snaps to the 4 street directions
  joystickDeadzone:   0.25,  // share of the joystick that does nothing (0–1)
  mobileShadows:      false, // shadows look nicer but cost a lot on phones
  mobilePixelRatio:   1.5,   // render sharpness cap on phones (lower = faster)

  // ───────────────────────────────────────────────────────────────
  //  CAMERA & CONTROLS  (everyone)
  // ───────────────────────────────────────────────────────────────
  cameraElevationDeg: 50,    // camera tilt: 35.264 = true isometric, 90 = straight down
  cameraAzimuthDeg:   45,    // camera turn around the city
  cameraFollow:       8.0,   // how tightly the camera follows you (higher = snappier)
  gamepadSnap:        true,  // controller stick snaps to the 4 street directions
  gamepadDeadzone:    0.3,   // share of the controller stick that does nothing (0–1)
  controlScheme:      'street', // 'street': WASD follows the streets (W = up-right)
                                // 'screen': W = straight up the screen
  occluderOpacity:    0.22,  // buildings in front of a unit fade to this (0 = invisible)
  shadows:            true,  // shadows on desktop

  // ───────────────────────────────────────────────────────────────
  //  ADVANCED  (rarely needs changing)
  // ───────────────────────────────────────────────────────────────
  kaijuRadius:        0.4,   // kaiju hitbox half-width (a street is 1 tile, so < 0.5)
  tankRadius:         0.25,  // tank hitbox half-width
  soldierRadius:      0.12,  // soldier hitbox half-width
  laneAssist:         6.0,   // how fast units slide to the middle of the street (corners)
  streetWiden:        0.1,   // extra road on each side of a street, in tiles
                             // (0.1 = streets 20% wider; above ~0.12 units clip building edges)
  cornerLookahead:    0.8,   // steer into a side street up to this many tiles early and
                             // you keep rolling, then turn when it lines up (0 = off)
  cornerNudge:        0.35,  // pushing into a wall this close to an opening slides you into it
  buildingFootprint:  0.78,  // how much of its lot a building fills (also sets height)
  tickRate:           20,    // server updates per second
};

// Derived helpers (don't edit — change the values above instead)
export function kaijuSpeedFor(tankCount) {
  return TUNING.kaijuSpeed * (1 + TUNING.kaijuSpeedPerTank * tankCount);
}
export function kaijuMaxHpFor(tankCount) {
  return TUNING.kaijuHpPerTank * Math.max(1, tankCount);
}
