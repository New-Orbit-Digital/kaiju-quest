import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { startServer } from '../src/index.js';
import { kaijuSpeedFor } from '../../shared/tuning.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('two clients: roles, movement, and each sees the other', async () => {
  const port = 25670 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  try {
    const a = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match');
    const b = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match');
    await wait(200);
    assert.equal(a.state.players.get(a.sessionId).role, 'kaiju');
    assert.equal(b.state.players.get(b.sessionId).role, 'tank');
    assert.equal(a.state.players.size, 2);
    assert.equal(b.state.players.size, 2);
    assert.ok(Math.abs(a.state.kaijuSpeed - kaijuSpeedFor(1)) < 1e-6);

    const kx0 = a.state.players.get(a.sessionId).x;
    a.send('input', { x: 1, z: 0 });
    await wait(600);
    a.send('input', { x: 0, z: 0 });
    await wait(150);
    const kxOnB = b.state.players.get(a.sessionId).x;
    assert.ok(kxOnB > kx0 + 1, `tank client should see kaiju move: ${kx0} → ${kxOnB}`);

    // garbage input is ignored, not fatal
    b.send('input', { x: 'NaN', z: 1e9 });
    await wait(150);
    assert.ok(Number.isFinite(a.state.players.get(b.sessionId).z));

    await a.leave(); await b.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
});
