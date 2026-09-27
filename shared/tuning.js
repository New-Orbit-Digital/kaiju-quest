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
  //  KAIJU
  // ───────────────────────────────────────────────────────────────
  kaijuSpeed:         3.0,   // walking speed, tiles/sec (with no tanks in the game)
  kaijuSpeedPerTank:  0.05,  // +5% speed for each tank player (0.10 = +10%)
  kaijuHpPerTank:     100,   // kaiju health = this × number of tanks (no regen)
  viewTilesKaiju:     15,    // ZOOM: tiles visible top-to-bottom (bigger = zoomed out)

  // Smashing (SPACE) — each press is one strike on the building beside the kaiju.
  // Building damage is permanent: walk away and come back, it's still hurt.
  strikeDamage:       10,    // building HP removed per strike
  strikeCooldown:     0.5,   // seconds between strikes (lower = faster smashing)
  strikeRoot:         0.35,  // seconds the kaiju is stuck in place after a strike

  kaijuLength:        3.0,   // how big the T-Rex is drawn, nose to tail (visual only)

  // ───────────────────────────────────────────────────────────────
  //  TANKS
  // ───────────────────────────────────────────────────────────────
  tankSpeed:          3.5,   // driving speed, tiles/sec
  viewTilesTank:      11,    // ZOOM on desktop: tiles visible top-to-bottom
  viewTilesMobile:    12,    // ZOOM on phones (portrait uses this across the width)

  // Auto-fire — the turret locks on by itself whenever the kaiju is in range.
  tankRange:          6,     // firing range, tiles
  tankDamage:         2,     // kaiju HP removed per shot
  tankFireInterval:   1.2,   // FIRE RATE: one shot every N seconds (lower = faster)

  // Boost (SPACE / phone BOOST button)
  boostMultiplier:    2.0,   // speed × this while boosting
  boostSeconds:       1.5,   // how long a boost lasts
  boostCooldown:      15,    // seconds before boost can be used again

  // Getting crushed
  tankRespawnSeconds: 5,     // seconds until a crushed tank comes back
  respawnMinDistance: 12,    // respawn at least this many tiles from the kaiju
                             // (also always outside the kaiju's view)

  tankLength:         0.8,   // how big a tank is drawn (visual only)

  // ───────────────────────────────────────────────────────────────
  //  SOLDIERS  (a squad follows each tank; they respawn with it)
  // ───────────────────────────────────────────────────────────────
  soldiersPerTank:    4,     // squad size
  soldierRange:       4,     // firing range, tiles
  soldierDamage:      0.25,  // kaiju HP removed per shot (each soldier)
  soldierFireInterval: 1.0,  // FIRE RATE: one shot every N seconds per soldier
  soldierSpacing:     0.35,  // how far behind the tank each pair walks
  soldierSpread:      0.2,   // how far to the side of the tank's path they walk
  soldierHeight:      0.32,  // how big a soldier is drawn (visual only)

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
  countdownSeconds:   3,     // "3-2-1" before a round
  endScreenSeconds:   12,    // results screen, then the next round starts
  maxTanks:           3,     // tank seats per game

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
  stompPad:           0.05,  // extra reach when the kaiju walks into tanks/soldiers
  laneAssist:         6.0,   // how fast units slide to the middle of the street (corners)
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
