# Kaiju Quest

Online multiplayer, isometric city smash-up. One player is the **kaiju**, knocking down buildings for points. Up to six players drive **tanks**, repairing the city and gunning the kaiju down. WASD + Space (kaiju smash / tank roadblock) + Shift (kaiju boost), or a controller (left stick moves, A smashes / drops a roadblock, RB boosts), or a phone (joystick + buttons, either side). Tanks only fire when no building is in the way.

**Play:** https://justbost.com/kaiju-quest/ (the page; the game server runs on Render at https://kaiju-quest.onrender.com, which also still serves the page). The free server sleeps when idle, so the first join can take about a minute.

## Modes

- **Points race** (default): the kaiju scores for destroyed buildings and crushed tanks; tanks score for repaired building HP and kaiju kills. The kaiju respawns after a kill (tanks get a few seconds of double-speed repairs). A neutral **bonus crate** drops on the streets, drifting toward the kaiju (faster with more tanks); whoever grabs it doubles their side's points and halves the other side's for 20 s. Highest score at the buzzer wins.
- **King of the Hill** (beta): everyone is a colour-tinted kaiju (phones too). Smash buildings (×3 inside the moving gold ring) and each other. Top score wins.
- **Evacuation** (beta): a fixed crowd of 60 civilians walks to the exits (green pads mid-edge). Kaiju stomps, tanks shepherd and wall off the kaiju with sturdy, unlimited roadblocks. First side past half the crowd wins.

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
| Game modes (Points race · King of the Hill · Evacuation) | rules in `shared/game.js`, numbers under GAME MODES in `shared/tuning.js` |
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
node tools/build-sandbox.mjs   # single-file offline sandbox (client/dist-sandbox/kaiju-sandbox.html)
```

## Stack

- Three.js client (Vite) with an orthographic isometric camera.
- Colyseus 0.18 server. The server decides everything: clients send WASD input, and the server moves units and syncs state 20×/s.
- Deploy: one Render web service (`render.yaml`) hosts both the page and the game server. A justbost.com/kaiju-quest/ link comes later.

## Credits

- City: [Kenney](https://kenney.nl) City Kit (Roads, Suburban, Commercial, Industrial), CC0.
- Kaiju (T-Rex), Tank, Soldier (used for the civilians): [Quaternius](https://quaternius.com), CC0, via poly.pizza.
