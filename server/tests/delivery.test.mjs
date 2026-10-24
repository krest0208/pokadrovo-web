import {prepareLegal,legalAcceptance} from './legal-fixture.mjs';
/** Release regressions: real HTTP + SQLite. Credentials are generated per test run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app.mjs';
import { provisionOwner, token } from '../security.mjs';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pk-delivery-'));
  const dist = join(directory, 'dist');
  mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Test</title>');
  let app;
  async function start() {
    app = createApp({ accountsEnabled: true, origin: 'http://localhost:5173', dataDir: join(directory, 'private'), dist });prepareLegal(app);
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  }
  await start();
  const ownerPassword = token(); await provisionOwner(app.store, 'release_owner', ownerPassword);
  function client() {
    const cookies = new Map(); let csrf = '', account = '';
    return async (path, method = 'GET', body) => new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path, method,
        headers: { Host: 'localhost:5173', Origin: 'http://localhost:5173', 'Content-Type': 'application/json',
          'X-CSRF-Token': csrf, 'X-PK-Account': account,
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
      }, res => {
        const chunks = []; res.on('data', x => chunks.push(x));
        res.on('end', () => {
          for (const line of res.headers['set-cookie'] || []) {
            const [name, value] = line.split(';')[0].split('=');
            if (value) cookies.set(name, value); else cookies.delete(name);
          }
          const raw = Buffer.concat(chunks).toString(); let data;
          try { data = JSON.parse(raw); } catch { data = raw; }
          if (data.csrf) csrf = data.csrf;
          if (data.user) account = data.user.id;
          resolve({ status: res.statusCode, data, raw });
        });
      });
      req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
    });
  }
  const stop = () => new Promise(resolve => app.server.close(resolve));
  return { client, ownerPassword, restart: async () => { await stop(); await start(); }, close: async () => { await stop(); rmSync(directory, { recursive: true, force: true }); } };
}
async function using(fn) { const f = await fixture(); try { await fn(f); } finally { await f.close(); } }
async function signup(request, email, password) {
  await request('/api/account/session');
  return request('/api/account/register', 'POST', { name: 'Release Author', email, password, confirmPassword: password, ...legalAcceptance });
}

test('project, image transforms and fonts survive server restart without leaking across accounts', () => using(async f => {
  const a = f.client(), password = token();
  assert.equal((await signup(a, 'one@example.test', password)).status, 201);
  const image = { id: 'frame1', assetId: 'image1', name: 'frame', kind: 'image', duration: 5, start: 0, end: 5,
    speed: 1, scaleX: 1.5, scaleY: 0.8, shape: 'ellipse', corner: 0.2, cropLeft: 0.1, cropRight: 0.2, cropTop: 0.05, cropBottom: 0.08 };
  const caption = { id: 'text1', text: 'Story', from: 0, to: 4, fontId: 'serif', weight: 700, italic: true, align: 'left' };
  const project = { id: 'persisted-project', name: 'Story', mode: 'reels', ratio: '9:16', clips: [image], audio: [], texts: [caption], brief: 'Keep my editing idea', schema: 4, created: Date.now(), modified: Date.now(), master: 1 };
  assert.equal((await a('/api/account/projects', 'PUT', { project })).status, 200);
  await f.restart();
  const returning = f.client(); await returning('/api/account/session');
  assert.equal((await returning('/api/account/login', 'POST', { email: 'one@example.test', password })).status, 200);
  const saved = (await returning('/api/account/projects')).data.projects[0];
  assert.deepEqual(saved.clips[0], image); assert.deepEqual(saved.texts[0], caption);
  assert.equal(saved.brief, project.brief); assert.equal(saved.ratio, '9:16');
  const other = f.client(); await signup(other, 'two@example.test', token());
  assert.deepEqual((await other('/api/account/projects')).data.projects, []);
  assert.equal((await other('/api/admin/users')).status, 401);
}));

test('owner can change login and password together; old credentials stop working after restart', () => using(async f => {
  const owner = f.client(), updatedPassword = token();
  assert.equal((await owner('/api/admin/login', 'POST', { login: 'release_owner', password: f.ownerPassword })).status, 200);
  assert.equal((await owner('/api/admin/password', 'POST', { password: f.ownerPassword, newLogin: 'updated_owner', newPassword: updatedPassword, confirmPassword: updatedPassword })).status, 200);
  assert.equal((await owner('/api/admin/session')).status, 401);
  await f.restart();
  const fresh = f.client();
  assert.equal((await fresh('/api/admin/login', 'POST', { login: 'release_owner', password: f.ownerPassword })).status, 401);
  assert.equal((await fresh('/api/admin/login', 'POST', { login: 'updated_owner', password: updatedPassword })).status, 200);
  const session = await fresh('/api/account/session');
  assert.equal(session.data.user.role, 'owner'); assert.equal(session.data.user.name, 'updated_owner');
  assert.equal((await fresh('/api/admin/users')).status, 200);
}));

test('clean install exposes no social credentials and no unauthenticated private documents', () => using(async f => {
  const guest = f.client(); const session = await guest('/api/account/session');
  assert.equal(session.data.user, null);
  assert.deepEqual(session.data.providers, []);
  assert.equal(session.data.socialLoginEnabled, false);
  assert.equal((await guest('/api/admin/oauth')).status, 401);
  assert.equal((await guest('/api/account/projects')).status, 401);
  for (const path of ['/.pokadrovo-private/master.key', '/.pokadrovo-private/owner.sqlite', '/server/security.mjs'])
    assert.equal((await guest(path)).status, 404);
}));
