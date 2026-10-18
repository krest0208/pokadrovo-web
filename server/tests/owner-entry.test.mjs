import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../app.mjs';
import { createLocalOwnerSetup } from '../setup-browser.mjs';
import { openStore, checkPassword, token } from '../security.mjs';
import { hasOwner } from '../standalone.mjs';
import { OWNER_PATH } from '../owner-route.mjs';

function call(url, { method = 'GET', data, headers = {} } = {}) {
  return new Promise((ok, no) => {
    const q = request(url, { method, headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); let body; try { body = JSON.parse(text); } catch { body = text; } ok({ status: res.statusCode, headers: res.headers, body }); });
    });
    q.on('error', no); if (data !== undefined) q.write(JSON.stringify(data)); q.end();
  });
}
async function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pk-owner-entry-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('custom owner address serves the login form, old admin routes stay closed and APIs require auth', () => fixture(async dir => {
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), '<title>Studio</title>');
  const app = createApp({ origin: 'http://localhost:5173', dataDir: join(dir, 'private'), dist: join(dir, 'dist') });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const get = path => call(base + path, { headers: { Host: 'localhost:5173' } });
  try {
    for (const path of [OWNER_PATH, OWNER_PATH + '/', '/krest0208%21%21%21']) {
      const r = await get(path); assert.equal(r.status, 200); assert.match(r.body, /id="login-form"/); assert.match(r.headers['x-robots-tag'], /noindex/);
    }
    for (const path of ['/admin', '/admin/', '/%61dmin', '/admin/anything']) assert.equal((await get(path)).status, 404);
    assert.equal((await get('/api/admin/session')).status, 401);
    assert.equal((await call(base + '/api/admin/setup', { method: 'POST', headers: { Host: 'localhost:5173', Origin: 'http://localhost:5173' }, data: { login: 'intruder', password: token() } })).status, 401);
    assert.equal((await call(base + '/setup-owner', { method: 'POST', headers: { Host: 'localhost:5173' }, data: {} })).status, 405);
  } finally { await new Promise(ok => app.server.close(ok)); }
}));

test('local setup needs the one-time token, exact Origin and Host; it never replaces an existing owner', () => fixture(async dir => {
  const dataDir = join(dir, 'private');
  const setup = await createLocalOwnerSetup({ dataDir, returnTo: 'http://localhost:5173' + OWNER_PATH });
  const link = new URL(setup.url), key = new URLSearchParams(link.hash.slice(1)).get('token');
  const headers = { Origin: link.origin, 'X-Pokadrovo-Setup-Token': key };
  const password = token(), data = { login: 'krest0208', password, confirmPassword: password };
  try {
    const page = await call(link.origin + OWNER_PATH);
    assert.equal(page.status, 200); assert.doesNotMatch(page.body, new RegExp(key));
    assert.equal((await call(link.origin + '/setup-owner', { method: 'POST', data, headers: { Origin: link.origin } })).status, 403);
    assert.equal((await call(link.origin + '/setup-owner', { method: 'POST', data, headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await call(link.origin + '/setup-owner', { method: 'POST', data, headers: { ...headers, Host: 'attacker.example' } })).status, 403);
    assert.equal((await call(link.origin + '/setup-owner', { method: 'POST', data: { ...data, confirmPassword: 'mismatch' }, headers })).status, 400);
    assert.equal(hasOwner(dataDir), false);
    assert.equal((await call(link.origin + '/setup-owner', { method: 'POST', data, headers })).status, 201);
    await setup.done;
    const store = openStore(dataDir);
    try { const owner = store.get('SELECT * FROM owner WHERE id=1'); assert.equal(owner.login, data.login); assert.equal(await checkPassword(password, owner.password), true); }
    finally { store.close(); }
    await assert.rejects(() => call(link.origin + '/setup-owner', { method: 'POST', data, headers }));
    await assert.rejects(() => createLocalOwnerSetup({ dataDir, returnTo: link.origin }), /уже настроен/);
  } finally { setup.close(); await setup.done.catch(() => {}); }
}));

test('simultaneous setup requests create exactly one owner', () => fixture(async dir => {
  const setup = await createLocalOwnerSetup({ dataDir: dir, returnTo: 'http://localhost:5173' + OWNER_PATH });
  const url = new URL(setup.url), headers = { Origin: url.origin, 'X-Pokadrovo-Setup-Token': new URLSearchParams(url.hash.slice(1)).get('token') };
  const password = token();
  try {
    const results = await Promise.all(['first_owner', 'second_owner'].map(login => call(url.origin + '/setup-owner', { method: 'POST', headers, data: { login, password, confirmPassword: password } })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); await setup.done;
    const store = openStore(dir); try { assert.equal(store.get('SELECT count(*) n FROM owner').n, 1); } finally { store.close(); }
  } finally { setup.close(); await setup.done.catch(() => {}); }
}));

test('expired bootstrap closes and leaves no owner account', () => fixture(async dir => {
  const setup = await createLocalOwnerSetup({ dataDir: dir, returnTo: 'http://localhost:5173' + OWNER_PATH, timeoutMs: 30 });
  await assert.rejects(setup.done, /истекло/); assert.equal(hasOwner(dir), false);
}));
