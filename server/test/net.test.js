import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { startServer } from '../src/index.js';
import { TUNING as T, kaijuSpeedFor } from '../../shared/tuning.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('two clients over the network: roles, sync, countdown, combat events', async () => {
  const port = 25670 + Math.floor(Math.random() * 100);
  const server = await startServer(port);
  try {
    const a = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match');
    const b = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match', { mobile: true });
    const fx = [];
    a.onMessage('fx', (m) => fx.push(m));
    await wait(200);
    assert.equal(a.state.players.get(a.sessionId).role, 'kaiju');
    assert.equal(b.state.players.get(b.sessionId).role, 'tank');
    assert.equal(b.state.players.get(b.sessionId).mobile, true);
    assert.equal(b.state.players.get(b.sessionId).soldiers.length, T.soldiersPerTank);
    assert.ok(Math.abs(a.state.kaijuSpeed - kaijuSpeedFor(1)) < 1e-6);
    assert.equal(a.state.buildingHp.length > 100, true);

    await wait(T.countdownSeconds * 1000 + 300);
    assert.equal(b.state.phase, 'playing');
    assert.equal(b.state.kaijuHp, T.kaijuHpPerTank);

    // kaiju walks east along row 12, then strikes whatever building is beside it
    const kx0 = a.state.players.get(a.sessionId).x;
    a.send('input', { x: 1, z: 0 }); await wait(600); a.send('input', { x: 0, z: 0 });
    await wait(150);
    assert.ok(b.state.players.get(a.sessionId).x > kx0 + 1, 'tank client sees kaiju move');
    a.send('action');
    await wait(200);
    assert.ok(fx.some(m => m.type === 'strike'), 'strike event broadcast');

    // garbage input is ignored, not fatal
    b.send('input', { x: 'NaN', z: 1e9 });
    await wait(150);
    assert.ok(Number.isFinite(a.state.players.get(b.sessionId).z));
    await a.leave(); await b.leave();
  } finally {
    await server.gracefullyShutdown(false);
  }
});
