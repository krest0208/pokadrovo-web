import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest, createServer } from 'node:http';
import { createApp } from '../app.mjs';
import { provisionOwner, token } from '../security.mjs';
import { SITE_AGENT_HOUR } from '../site-agent.mjs';
import { FREE_MODELS, OPENROUTER_BASE } from '../openrouter.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const home = extra => '<!doctype html><html lang="ru"><head><title>Покадрово</title><meta name="description" content="Монтаж видео"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module" src="/assets/index-123.js"></script><link rel="stylesheet" href="/assets/index-123.css"><link rel="icon" href="/favicon.svg"></head><body>' + (extra || '') + '</body></html>';
const headers = { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Strict-Transport-Security': 'max-age=31536000' };
function publicResponse(url, init, patch = {}) {
  const path = new URL(url).pathname;
  if (path === '/') return new Response(patch.html || home(), { headers });
  if (path === '/api/health') return json({ ok: true });
  if (path === '/api/account/projects') return json({ error: 'private content must not be copied' }, patch.projectsStatus || 401);
  if (init.method === 'HEAD') return new Response('', { status: patch.broken && path.endsWith('.js') ? 404 : 200, headers: { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'image/svg+xml' } });
  throw Error('unexpected URL');
}
function aiResponse(url, init) {
  if (init.method === 'GET') {
    const id = url.slice((OPENROUTER_BASE + '/models/').length, -'/endpoints'.length).split('/').map(decodeURIComponent).join('/');
    return json({ data: { id, architecture: { input_modalities: ['text', 'image', 'video'] }, endpoints: [{ status: 0, pricing: { prompt: '0', completion: '0' } }] } });
  }
  return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ideas: [
    { title: 'Сравнивать ритм двух вариантов', details: 'Предложить сравнение двух коротких планов до применения.', basis: 'Это гипотеза для проверки пользы авторазбора.' },
    { title: 'Помечать выбранные удачные кадры', details: 'Проверить, помогает ли пользователю короткий список отмеченных кадров.', basis: 'Нужно измерить полезность подсказок на реальных исходниках.' }
  ] }) } }], usage: { prompt_tokens: 200, completion_tokens: 160, cost: 0 } });
}
async function fixture(options = {}) {
  let clock = Date.UTC(2026, 9, 20, 10, 15); const calls = [], aiCalls = [];
  const origin = options.origin || 'https://pokadrovo.ru', dir = mkdtempSync(join(tmpdir(), 'pk-agent-'));
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), home());
  if (options.realSite) { mkdirSync(join(dir,'dist/assets')); writeFileSync(join(dir,'dist/assets/index-123.js'),'console.log(1)'); writeFileSync(join(dir,'dist/assets/index-123.css'),'body{}'); writeFileSync(join(dir,'dist/favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>'); }
  const config = { now: () => clock, origin, accountsEnabled: true, dataDir: join(dir, 'private'), dist: join(dir, 'dist'), siteAgentAutoStart: false,
    siteAgentFetch: async (url, init) => { calls.push([url, init]); return options.realSite ? globalThis.fetch(url, init) : options.siteFetch ? options.siteFetch(url, init) : publicResponse(url, init); },
    aiFetch: async (url, init) => { aiCalls.push([url, init]); return options.aiFetch ? options.aiFetch(url, init) : aiResponse(url, init); } };
  let app = createApp(config); const password = token(); await provisionOwner(app.store, 'agent_owner', password);
  app.server.listen(options.bindPort || 0, '127.0.0.1'); await once(app.server, 'listening');
  function client() {
    const cookies = new Map(); let csrf = '', accountId = '';
    return async (path, method = 'GET', data, extra = {}) => new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path, method,
        headers: { Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-PK-Account': accountId,
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
          for (const line of res.headers['set-cookie'] || []) { const [k, v] = line.split(';')[0].split('='); if (v) cookies.set(k, v); else cookies.delete(k); }
          const raw = Buffer.concat(chunks).toString(); const value = JSON.parse(raw);
          if (value.csrf) csrf = value.csrf; if (value.user) accountId = value.user.id;
          if (path === '/api/admin/login' && res.statusCode === 200) accountId = 'owner';
          resolve({ status: res.statusCode, data: value, raw });
        });
      }); req.on('error', reject); if (data !== undefined) req.write(JSON.stringify(data)); req.end();
    });
  }
  const owner = client(), login = () => owner('/api/admin/login', 'POST', { login: 'agent_owner', password }); await login();
  return { get app() { return app; }, calls, aiCalls, owner, login, password, client, now: () => clock, advance: ms => { clock += ms; },
    configureAi: (patch = {}) => owner('/api/admin/ai/openrouter', 'PUT', { apiKey: 'test-only-openrouter-agent-key', enabled: true, trialEnabled: true,
      analysisModel: FREE_MODELS.gemma, editModel: FREE_MODELS.gemma, dailyLimit: 40, password, ...patch }),
    settings: (patch = {}, extra = {}) => owner('/api/admin/site-agent/settings', 'PUT', { enabled: true, useAi: false, password, ...patch }, extra),
    register: async () => { const user = client(); await user('/api/account/session'); const password = token();
      const result = await user('/api/account/register', 'POST', { email: 'ordinary@example.test', password, confirmPassword: password, acceptPrivacy: true }); assert.equal(result.status, 201); return user; },
    restart: async () => { await new Promise(resolve => app.server.close(resolve)); app = createApp(config); app.server.listen(options.bindPort || 0, '127.0.0.1'); await once(app.server, 'listening'); },
    close: async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(dir, { recursive: true, force: true }); } };
}

test('Hourly reports and ideas are private to the authenticated owner with CSRF and account binding', async () => {
  const f = await fixture();
  try {
    const guest = f.client(); assert.equal((await guest('/api/account/agent/reports')).status, 401);
    const user = await f.register();
    for (const path of ['/api/account/agent/status', '/api/account/agent/reports', '/api/account/agent/ideas', '/api/admin/site-agent/status']) assert.ok([401, 403].includes((await user(path)).status));
    assert.equal((await f.owner('/api/account/agent/status', 'GET', undefined, { 'X-PK-Account': 'ordinary' })).status, 409);
    assert.equal((await f.settings({ password: 'wrong' })).status, 403);
    assert.equal((await f.settings({}, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await f.settings({}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.settings()).status, 200); await f.app.siteAgent.run(true);
    const page = await f.owner('/api/account/agent/reports'); assert.equal(page.status, 200); assert.equal(page.data.items.length, 1); assert.equal(page.data.status.unread, 1);
    const id = page.data.items[0].id;
    assert.equal((await f.owner(`/api/account/agent/reports/${id}/read`, 'POST', {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await f.owner(`/api/account/agent/reports/${id}/read`, 'POST', {})).status, 200);
    assert.equal((await f.owner('/api/account/agent/status')).data.unread, 0);
    assert.equal((await f.owner('/api/account/agent/reports?before=invalid')).status, 400);
    assert.ok(!page.raw.includes('test-only-openrouter-agent-key')); assert.ok(!page.raw.includes(f.password));
  } finally { await f.close(); }
});

test('The persisted hourly schedule prevents duplicate slots, catches up once, and survives restart', async () => {
  const f = await fixture();
  try {
    assert.equal(f.app.siteAgent.status().enabled, true); assert.equal(await f.app.siteAgent.run(), null); assert.equal(f.calls.length, 0);
    f.advance(60000); await f.app.siteAgent.run(); assert.equal(f.app.store.get('SELECT count(*) AS n FROM site_agent_reports').n, 1);
    const next = f.app.siteAgent.status().nextRun; assert.ok(next > f.now()); assert.equal(await f.app.siteAgent.run(), null);
    await f.restart(); assert.equal(f.app.siteAgent.status().nextRun, next); assert.equal(await f.app.siteAgent.run(), null);
    f.advance(3 * SITE_AGENT_HOUR); await f.app.siteAgent.run(); assert.equal(f.app.store.get('SELECT count(*) AS n FROM site_agent_reports').n, 2);
    assert.ok(f.app.siteAgent.status().nextRun > f.now()); assert.equal(await f.app.siteAgent.run(), null);
    await f.login(); const page = await f.owner('/api/account/agent/reports'); assert.equal(page.data.status.unread, 2);
    assert.ok(page.data.items.every(r => r.trigger === 'hourly'));
  } finally { await f.close(); }
});

test('Broken assets are evidence-based findings, repeats are deduplicated and recovery is reported', async () => {
  let broken = true; const f = await fixture({ siteFetch: (url, init) => publicResponse(url, init, { broken }) });
  try {
    await f.settings(); await f.app.siteAgent.run(true);
    let report = (await f.owner('/api/account/agent/reports')).data.items[0]; assert.equal(report.status, 'critical');
    assert.ok(report.findings.some(i => i.key === 'asset:/assets/index-123.js' && /404/.test(i.evidence)));
    assert.ok(report.newFindingKeys.includes('asset:/assets/index-123.js')); assert.ok(!report.newFindingKeys.includes('speech-captions'));
    await f.app.siteAgent.run(true); report = (await f.owner('/api/account/agent/reports')).data.items[0]; assert.equal(report.newFindingKeys.length, 0);
    broken = false; await f.app.siteAgent.run(true); report = (await f.owner('/api/account/agent/reports')).data.items[0];
    assert.equal(report.status, 'ok'); assert.ok(report.resolvedFindings.some(i => i.key === 'asset:/assets/index-123.js'));
    assert.equal(f.app.siteAgent.status().openFindings, 0); assert.ok(report.notChecked.includes('Визуальная вёрстка и действия в браузере'));
  } finally { await f.close(); }
});

test('Public checks do not follow external URLs, send cookies, read project contents or expose raw errors', async () => {
  const f = await fixture({ siteFetch: (url, init) => {
    assert.equal(new URL(url).origin, 'https://pokadrovo.ru'); assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers.Authorization, undefined);
    if (new URL(url).pathname === '/api/health') throw Error('secret private connection details');
    return publicResponse(url, init, { html: home('<script src="https://169.254.169.254/metadata"></script><script src="/api/private"></script>'), projectsStatus: 200 });
  } });
  try {
    await f.settings(); await f.app.siteAgent.run(true); const page = await f.owner('/api/account/agent/reports');
    assert.equal(page.data.items[0].status, 'critical'); assert.ok(page.data.items[0].findings.some(i => i.key === 'project-auth'));
    assert.ok(!page.raw.includes('private content must not be copied')); assert.ok(!page.raw.includes('secret private connection details'));
    assert.ok(f.calls.length <= 11); assert.ok(!f.calls.some(([u]) => u.includes('/metadata') || u.endsWith('/api/private')));
    assert.equal(f.aiCalls.length, 0);
  } finally { await f.close(); }
});

test('Pausing, manual runs, reading all messages and idea states remain under owner control', async () => {
  const f = await fixture();
  try {
    await f.settings({ enabled: false }); f.advance(SITE_AGENT_HOUR); assert.equal(await f.app.siteAgent.run(), null);
    await f.app.siteAgent.run(true); await f.app.siteAgent.run(true); await f.login();
    const page = (await f.owner('/api/account/agent/reports')).data; assert.equal(page.items.length, 2); assert.equal(page.status.unread, 2);
    assert.notEqual(page.items[0].ideas[0].key, page.items[1].ideas[0].key);
    const key = page.items[0].ideas[0].key;
    assert.equal((await f.owner('/api/account/agent/ideas/state', 'POST', { key, state: 'planned' })).status, 200);
    assert.equal((await f.owner('/api/account/agent/ideas')).data.items.find(i => i.key === key).state, 'planned');
    for (let i=0;i<105;i++) f.app.store.run("INSERT INTO site_agent_ideas(key,title,details,basis,source,first_at,delivered_at) VALUES(?,?,'Detail','Basis','rule',?,?)", 'test:archive-'+i,'Archive idea '+i,f.now()+i+1,f.now()+i+1);
    assert.equal((await f.owner('/api/account/agent/ideas')).data.items.find(i => i.key === key).state, 'planned');
    assert.equal((await f.owner('/api/account/agent/reports')).data.items[0].ideas[0].state,'planned');
    assert.equal((await f.owner('/api/account/agent/ideas/state', 'POST', { key, state: 'execute' })).status, 400);
    await f.owner('/api/account/agent/read-all', 'POST', {}); assert.equal(f.app.siteAgent.status().unread, 0);
    await f.restart(); assert.equal(f.app.siteAgent.status().enabled, false); assert.equal(f.app.siteAgent.status().unread, 0);
    assert.equal((await f.owner('/api/account/agent/ideas')).data.items.find(i => i.key === key).state, 'planned');
  } finally { await f.close(); }
});

test('Idea generation uses at most one free API call per UTC day and does not consume user coins', async () => {
  const f = await fixture();
  try {
    await f.configureAi(); const user = await f.register();
    await f.app.siteAgent.run(true); await f.app.siteAgent.run(true);
    let posts = f.aiCalls.filter(([, i]) => i.method === 'POST'); assert.equal(posts.length, 1);
    const payload = JSON.parse(posts[0][1].body); assert.equal(payload.model, FREE_MODELS.gemma);
    assert.equal(payload.provider.max_price.prompt, 0); assert.equal(payload.provider.allow_fallbacks, false);
    assert.ok(!JSON.stringify(payload).includes(f.password)); assert.ok(!JSON.stringify(payload).includes('private content'));
    const page = (await f.owner('/api/account/agent/reports')).data; assert.ok(page.items.every(r => r.ideas[0].source === 'ai'));
    assert.notEqual(page.items[0].ideas[0].key, page.items[1].ideas[0].key);
    const journal = f.app.store.get("SELECT * FROM ai_runs WHERE mode='site-agent'"); assert.equal(journal.result, 'ok'); assert.equal(journal.coin_charge, 0); assert.equal(journal.task, 'ideas'); assert.equal(journal.input_tokens, 200);
    assert.equal((await user('/api/ai/status?service=source-analysis')).data.billing.remainingCoins, 3);
    f.advance(86400000); await f.app.siteAgent.run(true); posts = f.aiCalls.filter(([, i]) => i.method === 'POST'); assert.equal(posts.length, 2);
    // Duplicate generated titles are never delivered again as new ideas.
    const titles = f.app.store.all('SELECT title FROM site_agent_ideas'); assert.equal(titles.filter(i => i.title === 'Сравнивать ритм двух вариантов').length, 1);
  } finally { await f.close(); }
});

test('The agent reserves user quota and falls back to rule ideas when AI fails or is unavailable', async () => {
  const f = await fixture({ aiFetch: (url, init) => init.method === 'GET' ? aiResponse(url, init) : new Response('private provider key', { status: 429 }) });
  try {
    await f.configureAi(); await f.app.siteAgent.run(true); await f.app.siteAgent.run(true);
    assert.equal(f.aiCalls.filter(([, i]) => i.method === 'POST').length, 1);
    let page = (await f.owner('/api/account/agent/reports')).data; assert.ok(page.items.every(r => r.ideas[0].source === 'rule'));
    assert.ok(!JSON.stringify(page).includes('private provider key')); assert.equal(f.app.store.get("SELECT result FROM ai_runs WHERE mode='site-agent'").result, 'failed');
    f.advance(86400000); await f.login();
    for (let i = 0; i < 31; i++) f.app.store.run("INSERT INTO ai_runs(request_id,at,result,model,account_id,provider) VALUES(?,?,'ok',?,'owner','openrouter')", 'used-' + i, f.now(), FREE_MODELS.gemma);
    await f.app.siteAgent.run(true); assert.equal(f.app.siteAgent.status().aiStatus, 'user-reserve'); assert.equal(f.aiCalls.filter(([, i]) => i.method === 'POST').length, 1);
  } finally { await f.close(); }
});

test('Persistent leases prevent overlap and abandoned checks can resume after lease expiry', async () => {
  const f = await fixture();
  try {
    f.app.store.run('UPDATE site_agent_state SET next_run=?,lease_token=?,lease_until=? WHERE id=1', f.now() - 1, 'abandoned', f.now() + 180000);
    await f.restart(); assert.equal(await f.app.siteAgent.run(), null); assert.equal(f.calls.length, 0);
    f.advance(180001); await f.app.siteAgent.run(); assert.equal(f.app.store.get('SELECT count(*) AS n FROM site_agent_reports').n, 1);
    assert.equal(f.app.siteAgent.status().running, false);
  } finally { await f.close(); }
});

test('Local installations stay paused by default and report pagination preserves every message', async () => {
  const f = await fixture({ origin: 'http://localhost:5173' });
  try {
    assert.equal(f.app.siteAgent.status().enabled, false);
    for (let i = 0; i < 22; i++) await f.app.siteAgent.run(true);
    const first = (await f.owner('/api/account/agent/reports')).data; assert.equal(first.items.length, 20); assert.ok(first.nextBefore);
    const older = (await f.owner('/api/account/agent/reports?before=' + first.nextBefore)).data;
    assert.equal(older.items.length, 2); assert.equal(new Set([...first.items, ...older.items].map(r => r.id)).size, 22); assert.equal(first.status.unread, 22);
    assert.equal((await f.owner('/api/admin/site-agent/run', 'POST', {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  } finally { await f.close(); }
});

test('A real local server can audit its public build and API without an authenticated probe', async () => {
  const allocator = createServer(); allocator.listen(0, '127.0.0.1'); await once(allocator, 'listening');
  const port = allocator.address().port; await new Promise(resolve => allocator.close(resolve));
  const f = await fixture({ origin: 'http://127.0.0.1:' + port, bindPort: port, realSite: true });
  try {
    await f.app.siteAgent.run(true); const report = (await f.owner('/api/account/agent/reports')).data.items[0];
    assert.equal(report.status, 'ok', JSON.stringify(report.findings));
    assert.ok(report.checks.some(c => c.key === 'project-auth' && c.status === 'ok'));
    assert.ok(report.checks.some(c => c.key === 'asset:/assets/index-123.js' && c.status === 'ok'));
    assert.equal(f.aiCalls.length, 0);
  } finally { await f.close(); }
});

test('Restart cancels an in-flight idea job without writing to a closed database or spending again', async () => {
  let announce, release; const started = new Promise(resolve => { announce = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ aiFetch: async (url, init) => {
    if (init.method === 'GET') return aiResponse(url, init);
    announce(); await gate; return aiResponse(url, init);
  } });
  try {
    await f.configureAi(); const pending = f.app.siteAgent.run(true); await started;
    await f.restart(); release(); assert.equal(await pending, null);
    assert.equal(f.app.store.get("SELECT result FROM ai_runs WHERE mode='site-agent'").result, 'interrupted');
    await f.app.siteAgent.run(true); assert.equal(f.aiCalls.filter(([, i]) => i.method === 'POST').length, 1);
    assert.equal(f.app.siteAgent.status().running, false); assert.equal(f.app.siteAgent.status().unread, 1);
  } finally { release(); await f.close(); }
});
