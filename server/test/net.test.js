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
    const a = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match', { name: 'Kay' });
    const b = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match', { mobile: true, name: 'Phone' });
    const c = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('match', { name: 'Ghost' });
    const fx = [];
    a.onMessage('fx', (m) => fx.push(m));
    await wait(200);
    assert.equal(a.state.players.get(a.sessionId).role, 'kaiju');
    assert.equal(b.state.players.get(b.sessionId).role, 'tank');
    assert.equal(b.state.players.get(b.sessionId).mobile, true);
    assert.equal(b.state.mode, T.defaultMode);
    assert.ok(Math.abs(a.state.kaijuSpeed - kaijuSpeedFor(2)) < 1e-6);
    assert.equal(a.state.buildingHp.length > 100, true);
    assert.equal(b.state.players.get(a.sessionId).name, 'Kay');
    assert.equal(b.state.phase, 'lobby');

    // kick the ghost from the lobby, then the two real players ready up
    let cLeft = false; c.onLeave(() => { cLeft = true; });
    a.send('kick', { id: c.sessionId });
    await wait(300);
    assert.equal(cLeft, true, 'kicked player is disconnected');
    assert.equal(a.state.players.size, 2);
    a.send('ready', { ready: true });
    await wait(200);
    assert.equal(a.state.phase, 'lobby', 'waits for the tank to ready');
    b.send('ready', { ready: true });
    await wait(T.countdownSeconds * 1000 + 400);
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
