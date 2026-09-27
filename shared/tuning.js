// ─────────────────────────────────────────────────────────────
//  KAIJU QUEST — TUNING
//  Every gameplay number lives here. Client and server both read
//  this file, so edit, save, restart the server, reload the page.
//  Units: 1 tile = 1 city block cell. Times are in seconds.
// ─────────────────────────────────────────────────────────────

export const TUNING = {
  // ── Match ──────────────────────────────────────────────────
  matchSeconds: 300,          // 5-minute match; kaiju wins if alive at 0
  countdownSeconds: 3,        // "3-2-1" before a round starts
  endScreenSeconds: 12,       // results screen, then the next round starts
  maxTanks: 3,                // tank seats per room (raise later)
  tickRate: 20,               // server simulation ticks per second

  // ── Kaiju ──────────────────────────────────────────────────
  kaijuSpeed: 3.0,            // tiles/sec with 0 tanks in the room
  kaijuSpeedPerTank: 0.05,    // +5% speed per tank player
  kaijuHpPerTank: 100,        // HP = this × tank players (no regen)
  kaijuRadius: 0.4,           // collision radius (street is 1 tile wide)
  kaijuLength: 3.0,           // visual nose-to-tail length (tiles); the
                              // T-Rex is long, so bigger = more clipping

  // ── Kaiju: smashing buildings (P02) ────────────────────────
  // Each E press is one strike on the adjacent building. Building
  // damage is permanent — walk away and come back, it's still hurt.
  strikeDamage: 10,
  strikeCooldown: 0.5,        // seconds between E strikes
  strikeRoot: 0.35,           // kaiju can't move for this long after a strike
  buildingHp:    { house: 20, commercial: 40, industrial: 40, tower: 80 },
  buildingPoints:{ house: 10, commercial: 25, industrial: 25, tower: 60 },
  pointsTankKill: 50,
  pointsSoldierKill: 10,

  // ── Tanks ──────────────────────────────────────────────────
  tankSpeed: 3.5,             // tiles/sec
  tankRadius: 0.25,
  tankLength: 0.8,            // visual length (tiles)
  tankRange: 6,               // auto-fire range (tiles); turret auto-locks
  tankDamage: 2,
  tankFireInterval: 1.2,
  boostMultiplier: 2.0,       // E = boost
  boostSeconds: 1.5,
  boostCooldown: 15,
  tankRespawnSeconds: 5,
  respawnMinDistance: 12,     // also must be outside kaiju's view
  stompPad: 0.05,             // extra reach when the kaiju walks into things

  // ── Soldiers (P02) ─────────────────────────────────────────
  soldiersPerTank: 4,
  soldierRange: 4,
  soldierDamage: 0.25,
  soldierFireInterval: 1.0,
  soldierRadius: 0.12,
  soldierSpacing: 0.35,       // how far behind the tank each pair walks
  soldierSpread: 0.2,         // sideways offset from the tank's path
  soldierHeight: 0.32,        // visual height (tiles)

  // ── Movement feel ──────────────────────────────────────────
  laneAssist: 6.0,            // tiles/sec the unit slides toward lane
                              // center while driving, so corners are easy

  // ── Controls ───────────────────────────────────────────────
  // 'street': W/A/S/D follow the street grid (W = up-right on screen).
  // 'screen': W is straight up the screen (streets are diagonal, so
  //           driving down a street needs two keys).
  controlScheme: 'street',

  // ── Camera ─────────────────────────────────────────────────
  cameraElevationDeg: 50,     // 35.264 = true isometric; higher = more
                              // top-down, fewer streets hidden by buildings
  cameraAzimuthDeg: 45,
  viewTilesTank: 11,          // tiles visible top-to-bottom for tanks
  viewTilesKaiju: 15,         // kaiju sees more (zoomed out)
  cameraFollow: 8.0,          // higher = camera snaps faster

  // ── Rendering ──────────────────────────────────────────────
  buildingFootprint: 0.78,    // share of a lot a building fills (also
                              // sets building height — models scale evenly)
  occluderOpacity: 0.22,      // buildings in front of a unit fade to this
  shadows: true,

  // ── Phones (tank only) ─────────────────────────────────────
  mobileMarkers: true,        // arrows over the kaiju + other tanks, phones only
  mobileShadows: false,       // shadows cost a lot on phones
  mobilePixelRatio: 1.5,      // render resolution cap on phones
  viewTilesMobile: 12,        // phone camera zoom (portrait uses the width)
  joystickSnap: true,         // joystick snaps to the 4 street directions
  joystickDeadzone: 0.25,     // share of the pad that does nothing
};

// Derived helpers (don't tune these — tune the values above)
export function kaijuSpeedFor(tankCount) {
  return TUNING.kaijuSpeed * (1 + TUNING.kaijuSpeedPerTank * tankCount);
}
export function kaijuMaxHpFor(tankCount) {
  return TUNING.kaijuHpPerTank * Math.max(1, tankCount);
}
