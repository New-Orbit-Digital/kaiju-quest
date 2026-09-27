import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KaijuRoom, roomIdForCode } from './KaijuRoom.js';
import { TUNING } from '../../shared/tuning.js';

// Test hook: shorter rounds for automated checks (never set in production).
if (process.env.KQ_MATCH_SECONDS) TUNING.matchSeconds = Number(process.env.KQ_MATCH_SECONDS);
// Browser checks run on a slow software renderer; don't let their idle tabs go AFK.
if (process.env.KQ_TEST) TUNING.afkSeconds = 600;

// When the client has been built (client/dist), this server also hosts it,
// so one Render service = one URL to share for playtests.
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

export async function startServer(port = Number(process.env.PORT) || 2567) {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      if (existsSync(CLIENT_DIST)) app.use(express.static(CLIENT_DIST));
      app.get('/health', (_req, res) => res.send('ok'));
      // Room code → room id, for share links / "join with code" (the page may be
      // served from another site, e.g. justbost.com, so allow any origin).
      app.get('/room/:code', (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        const roomId = roomIdForCode(req.params.code);
        if (!roomId) return res.status(404).json({ error: 'not-found' });
        res.json({ roomId });
      });
    },
  });
  server.define('match', KaijuRoom);
  await server.listen(port);
  console.log(`[kaiju-quest] server listening on :${port}${existsSync(CLIENT_DIST) ? ' (serving client)' : ''}`);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
