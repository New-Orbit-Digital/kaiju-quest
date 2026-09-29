# Kaiju Quest

Online multiplayer, isometric city smash-up. One player is the **kaiju**, knocking down buildings for points. Up to six players drive **tanks**, repairing the city and gunning the kaiju down. WASD + Space (tank roadblock) + Shift (kaiju boost), or a controller (left stick moves, A drops a roadblock, RB boosts), or a phone (either side). Tanks only fire when no building is in the way.

**The kaiju has no smash button:** it stomps on buildings by pushing into them. Hold a direction into a building or roadblock for a quarter of a second (`smashPushDelay`) and it smashes it every strike cooldown for as long as you hold; a shorter push still slides you round corners. In King of the Hill the kaiju collide (they can't walk through each other) and pushing into another kaiju hits it.

**Phones:** tap anywhere to walk there along the streets (as the kaiju, tap a building to walk up and smash it to rubble; your route and target show on the ground). Drag anywhere for a floating stick that appears under your thumb, follows it if you drag past its edge, snaps to the streets as drawn on screen, and cancels any tap route. BLOCK (tanks) / BOOST (kaiju) sit bottom right. Phones get a little more cornering help (`mobileCornerLookahead`, `mobileCornerNudge`). On every device your own unit moves the instant you press (`clientPrediction`) and eases onto the server's position.

**Play:** https://justbost.com/kaiju-quest/ (the page; the game server runs on Render at https://kaiju-quest.onrender.com, which also still serves the page). The free server sleeps when idle, so the first join can take about a minute.

## Modes

- **Save the City!** (default): the city starts part-damaged (more tanks = more damage) and the round lasts 30 s per player. Tanks repair damaged buildings and rebuild rubble; the kaiju smashes. At the buzzer the kaiju wins if the city's total health is at or below 50%, otherwise the tanks win (the city-health bar shows the 50% line). Points still count up for bragging rights. The kaiju respawns after a kill (tanks then repair at double speed for 10 s). A neutral **bonus crate** drifts toward the kaiju (faster with more tanks); grabbing it doubles your side's damage or repair speed (and points) and halves the other's for 20 s.
- **King of the Hill**: everyone is a colour-tinted kaiju (phones too). Smash buildings (×3 inside the red zone, which jumps every 20 s with a red-alert siren) and each other. The round lasts 30 s per player and the first to 250 points per player wins outright; otherwise top score at the buzzer.
- **Evacuation**: a fixed crowd of 60 civilians each walks to the exit farthest from where it appeared (green pads mid-edge), preferring streets the tanks have roadblocked and swerving around the kaiju only when it's within 10 tiles. Each civilian's planned route shows as a faint green line on the ground; routes that share a street merge into one line. First side past half the crowd (stomped vs escaped) wins. A crowd murmur gets louder the more civilians are around you.

Your cooldown (kaiju boost / tank roadblock) shows on the coloured ring under your unit: it drains to a pale ring, refills, and flashes when ready. Tanks drop roadblocks in front of them, at most 3 each (a 4th removes the oldest, with a floating note); roadblock strength scales with the number of tanks (10 smashes with 1 tank down to 4 with 6).

Every 1-vs-N number (kaiju health and speed, respawn times, repair rate, crush / kill points, crate drift) lives in the **SCALING** table in `shared/tuning.js`, one column per tank count. `node tools/balance.mjs [race|evac|koth] [rounds]` plays bot rounds at every tank count and prints average scores (bots are simple: a rough first pass, not a verdict).

## Joining

Everyone types a name, then picks **PLAY** (any public game with a free seat; a new one is made when they're all full), **CREATE ROOM** (a private game with a 4-letter code) or **JOIN CODE**. In the lobby, **COPY LINK** copies a share link (`?room=CODE`) that drops friends straight into that game. Private rooms never get random players. In the lobby (a free-roam city, no combat) pick a side (**PLAY KAIJU** / **PLAY TANK**), a **game mode**, and hit **READY**; the round starts when every active player is ready. Players with no input for `afkSeconds` (60) show as AFK and don't hold up the start; anyone can take an AFK kaiju's seat and remove players with ✕. After a round the next one starts automatically, and the end screen can change the mode. **+ BOT TANK / + BOT KAIJU** add computer players. `?name=` skips the name screen; `?desktop` forces desktop controls on a touch device.

## Hosting

- **Page:** GitHub Pages via `.github/workflows/pages.yml` (builds `client/` with `VITE_SERVER_URL=wss://kaiju-quest.onrender.com` on every push to `main`) → https://justbost.com/kaiju-quest/. One-time setup: repo Settings → Pages → Source: **GitHub Actions**.
- **Game server:** Render (`render.yaml`, one free web service). It also serves the page, so https://kaiju-quest.onrender.com keeps working.

## Run it locally

```bash
npm run install:all      # root + server + client
npm run server           # game server on ws://localhost:2567
npm run client           # web client on http://localhost:5173
```

Open two browser windows:

- `http://localhost:5173/?role=kaiju`
- `http://localhost:5173/?role=tank`

Sides are picked in the lobby. `?role=kaiju` / `?role=tank` sets a starting preference, and `&server=ws://host:port` points at another server.

## Where to change things

| What | File |
|---|---|
| Every gameplay number (speeds, HP, damage, timers, camera, controls, phone settings) | `shared/tuning.js` |
| The rules (rounds, strikes, firing, stomps, respawns, repair, roadblocks, scoring) | `shared/game.js` |
| Bot behaviour | `shared/bots.js` |
| 1-vs-N balance (per tank count) | `SCALING` in `shared/tuning.js`; check with `node tools/balance.mjs` |
| Room codes / share links | `server/src/KaijuRoom.js` (codes) + `server/src/index.js` (`/room/:code`) |
| Game modes (Save the City! · King of the Hill · Evacuation) | rules in `shared/game.js`, numbers under GAME MODES in `shared/tuning.js` |
| Sound effects | files in `client/public/assets/sfx/`, wiring in `client/src/audio.js` + `main.js` |
| The city layout (ASCII map, one character per tile) and spawn points | `shared/map.js` |
| Which Kenney model goes on which lot, and road tiling | `client/src/city.js` |
| Which building model sits on which lot | `client/src/cityplan.js` |
| Unit model orientation, size and animation names | `client/src/units.js` |

Restart the server after changing `shared/`. Vite reloads the client on its own.

## Tests

```bash
npm test          # 49 tests: rules, movement, collisions, scaling + a live two-client server test
npm run shots     # builds the client, plays a short round with a desktop kaiju vs an emulated-phone tank, saves docs/shots/p02-*.png
node tools/touchshots.mjs   # offline phone kaiju: floating stick, tap-a-building smash, Evacuation path network (docs/shots/pm-*.png)
node tools/build-sandbox.mjs   # single-file offline sandbox (client/dist-sandbox/kaiju-sandbox.html)
```

## Stack

- Three.js client (Vite) with an orthographic isometric camera.
- Colyseus 0.18 server. The server decides everything: clients send WASD input, and the server moves units and syncs state 20×/s.
- Deploy: one Render web service (`render.yaml`) hosts both the page and the game server. A justbost.com/kaiju-quest/ link comes later.

## Credits

- City: [Kenney](https://kenney.nl) City Kit (Roads, Suburban, Commercial, Industrial), CC0.
- Kaiju (T-Rex), Tank, Soldier (used for the civilians): [Quaternius](https://quaternius.com), CC0, via poly.pizza.
