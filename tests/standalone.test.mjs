import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openStore, provisionOwner, token } from '../server/security.mjs';
import { hasOwner, launchConfig } from '../server/standalone.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(ok => server.close(ok)); return port;
}
function launch(directory, port, accountsEnabled = false) {
  let output = '';
  const child = spawn(process.execPath, ['tools/start-standalone.mjs'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, POKADROVO_ACCOUNTS_ENABLED: accountsEnabled ? '1' : '0', POKADROVO_PORT: String(port), POKADROVO_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, POKADROVO_DATA_DIR: join(directory, 'private') } });
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const exited = once(child, 'exit');
  return { child, exited, output: () => output, async stop() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; } };
}
function delivery() {
  const directory = mkdtempSync(join(tmpdir(), 'pk standalone '));
  cpSync(join(root, 'server'), join(directory, 'server'), { recursive: true });
  cpSync(join(root, 'shared'), join(directory, 'shared'), { recursive: true });
  mkdirSync(join(directory, 'tools'));
  cpSync(join(root, 'tools/start-standalone.mjs'), join(directory, 'tools/start-standalone.mjs'));
  cpSync(join(root, 'dist'), join(directory, 'dist'), { recursive: true });
  return directory;
}
async function ready(app, origin) {
  for (let n = 0; n < 100; n++) {
    if (app.child.exitCode !== null) throw Error(app.output());
    try { if ((await fetch(origin + '/api/health')).ok) return; } catch {}
    await new Promise(ok => setTimeout(ok, 50));
  }
  throw Error('Standalone server did not become ready. ' + app.output());
}
function client(origin) {
  const cookies = new Map(); let csrf = '', account = '';
  return async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, { method, redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json',
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'X-CSRF-Token': csrf, 'X-PK-Account': account }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [name, cookie] = value.split(';')[0].split('='); if (cookie) cookies.set(name, cookie); else cookies.delete(name); }
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    if (data.csrf) csrf = data.csrf; if (data.user) account = data.user.id;
    return { status: response.status, data };
  };
}

test('launch modes retain loopback defaults and reject external HTTP or mismatched local ports', () => {
  assert.equal(launchConfig({ POKADROVO_HOST: '0.0.0.0' }).host, '127.0.0.1');
  assert.equal(launchConfig({}, true).host, '0.0.0.0');
  for (const origin of ['http://example.test:5173', 'http://localhost:5000', 'https://a:b@example.test', 'https://example.test/admin'])
    assert.throws(() => launchConfig({ POKADROVO_PUBLIC_ORIGIN: origin }));
  for (const directory of [join(root, 'dist'), join(root, 'public/private')])
    assert.throws(() => launchConfig({ POKADROVO_DATA_DIR: directory }), /вне public и dist/);
});

test('first noninteractive launch refuses to create a default owner or a private database', async () => {
  const directory = delivery(); const app = launch(directory, await freePort());
  try { const [code] = await app.exited; assert.equal(code, 1); assert.match(app.output(), /интерактивного терминала/); assert.equal(existsSync(join(directory, 'private')), false); }
  finally { await app.stop(); rmSync(directory, { recursive: true, force: true }); }
});

test('existing database without its key is preserved and never silently reset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pk-missing-key-'));
  try { const original = Buffer.from('do not replace'); writeFileSync(join(directory, 'owner.sqlite'), original);
    assert.throws(() => hasOwner(directory), /master.key/); assert.deepEqual(readFileSync(join(directory, 'owner.sqlite')), original); assert.equal(existsSync(join(directory, 'master.key')), false); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('ready delivery starts without npm, preserves accounts/projects and owner access after clean restart', { timeout: 30000 }, async () => {
  const directory = delivery(), port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const ownerPassword = token(), userPassword = token();
  const store = openStore(join(directory, 'private'));
  try { await provisionOwner(store, 'standalone_owner', ownerPassword); } finally { store.close(); }
  const originalKey = readFileSync(join(directory, 'private/master.key'));
  let app = launch(directory, port, true);
  try {
    await ready(app, origin);
    assert.equal((await fetch(origin)).status, 200);
    const user = client(origin); await user('/api/account/session');
    assert.equal((await user('/api/admin/session')).status, 401);
    assert.equal((await user('/api/account/register', 'POST', { name: 'Local Author', email: 'local@example.test', password: userPassword, confirmPassword: userPassword, acceptPrivacy: true })).status, 201);
    const project = { id: 'standalone-project', name: 'Persistent timeline', mode: 'reels', ratio: '9:16', clips: [], audio: [], texts: [], brief: 'Keep this brief', schema: 4, created: Date.now(), modified: Date.now(), master: 1 };
    assert.equal((await user('/api/account/projects', 'PUT', { project })).status, 200);
    assert.equal((await user('/api/admin/users')).status, 401);
    await app.stop(); assert.equal(app.child.exitCode, 0);
    app = launch(directory, port, true); await ready(app, origin);
    const returning = client(origin); await returning('/api/account/session');
    assert.equal((await returning('/api/account/login', 'POST', { email: 'local@example.test', password: userPassword })).status, 200);
    assert.equal((await returning('/api/account/projects')).data.projects[0].brief, project.brief);
    const owner = client(origin);
    assert.equal((await owner('/api/admin/login', 'POST', { login: 'standalone_owner', password: ownerPassword })).status, 200);
    assert.equal((await owner('/api/admin/users')).status, 200);
    assert.deepEqual(readFileSync(join(directory, 'private/master.key')), originalKey);
    const probe = spawn(process.execPath, ['server/healthcheck.mjs'], { cwd: directory, env: { ...process.env, POKADROVO_PORT: String(port), POKADROVO_PUBLIC_ORIGIN: origin }, stdio: 'ignore' });
    assert.equal((await once(probe, 'exit'))[0], 0);
  } finally { await app.stop(); rmSync(directory, { recursive: true, force: true }); }
});

test('default unified delivery serves guest routes and retains encrypted AI settings after restart', { timeout: 30000 }, async () => {
  const directory=delivery(),port=await freePort(),origin=`http://127.0.0.1:${port}`,password=token(),key=token();
  const store=openStore(join(directory,'private'));
  try { await provisionOwner(store,'site_owner',password); } finally { store.close(); }
  let app=launch(directory,port);
  try {
    await ready(app,origin);
    const guest=client(origin),session=await guest('/api/account/session');
    assert.equal(session.data.accountsEnabled,false);
    for(const route of ['/','/studio','/projects']){const response=await fetch(origin+route,{redirect:'manual'});assert.equal(response.status,200);assert.match(await response.text(),/assets\/index-/);}
    assert.equal((await guest('/api/account/register','POST',{})).status,404);
    assert.equal((await guest('/api/admin/settings')).status,401);
    const owner=client(origin);await owner('/api/admin/login','POST',{login:'site_owner',password});
    assert.equal((await owner('/api/admin/settings','PUT',{provider:'openai',model:'test-model',apiKey:key,password,analyticsEnabled:true})).status,200);
    await app.stop();app=launch(directory,port);await ready(app,origin);
    const returning=client(origin);await returning('/api/admin/login','POST',{login:'site_owner',password});
    const settings=await returning('/api/admin/settings');assert.equal(settings.data.keyConfigured,true);assert.equal(settings.data.model,'test-model');assert.equal(JSON.stringify(settings.data).includes(key),false);
  } finally { await app.stop();rmSync(directory,{recursive:true,force:true}); }
});
