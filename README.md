# Kaiju Quest

Online multiplayer, isometric city smash-up. One player is the **kaiju**, knocking down buildings for points. Up to three players drive **tanks**, trying to kill it. WASD + Space (smash / boost) + Shift (tank roadblock).

**Status:** playable. Full combat loop (strikes, rubble, auto-firing tanks, soldiers, stomps, boost, respawns, a 5-minute round and an end screen), tank repairs and roadblocks, phone support for tanks, a ready-up lobby with player names, and bots.

Live playtest: https://kaiju-quest.onrender.com. Open it on a phone to drive a tank with the on-screen joystick.

## Playtest (Render)

`render.yaml` is a Render Blueprint for one free web service. It builds the client and runs the game server, which also serves the page, so everyone opens the same URL. Everyone types a name, then lands in the **lobby** (a free-roam city with no combat). Pick a side there (**PLAY KAIJU** / **PLAY TANK**, kaiju is desktop only) and hit **READY**. The round starts when every active player is ready. Players with no input for `afkSeconds` (60) show as AFK and don't hold up the start; anyone can take an AFK kaiju's seat, and anyone can remove a player from the lobby with ✕. After a round ends, the next one starts automatically. **+ BOT TANK / + BOT KAIJU** in the lobby add computer players (always ready; ✕ removes them; a person picking KAIJU takes the seat from a bot). Name tags float over every unit. Phones are always tanks (`?desktop` forces desktop mode on a touch device; `?name=` skips the name screen). The free tier sleeps when idle, so the first visit can take about a minute.

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
| The city layout (ASCII map, one character per tile) and spawn points | `shared/map.js` |
| Which Kenney model goes on which lot, and road tiling | `client/src/city.js` |
| Which building model sits on which lot | `client/src/cityplan.js` |
| Unit model orientation, size and animation names | `client/src/units.js` |

Restart the server after changing `shared/`. Vite reloads the client on its own.

## Tests

```bash
npm test          # 32 tests: rules, movement, collisions, scaling + a live two-client server test
npm run shots     # builds the client, plays a short round with a desktop kaiju vs an emulated-phone tank, saves docs/shots/p02-*.png
node tools/build-sandbox.mjs   # single-file offline sandbox (client/dist-sandbox/kaiju-sandbox.html)
```

## Stack

- Three.js client (Vite) with an orthographic isometric camera.
- Colyseus 0.18 server. The server decides everything: clients send WASD input, and the server moves units and syncs state 20×/s.
- Deploy: one Render web service (`render.yaml`) hosts both the page and the game server. A justbost.com/kaiju-quest/ link comes later.

## Credits

- City: [Kenney](https://kenney.nl) City Kit (Roads, Suburban, Commercial, Industrial), CC0.
- Kaiju (T-Rex), Tank, Soldier: [Quaternius](https://quaternius.com), CC0, via poly.pizza.
