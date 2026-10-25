import {prepareLegal,legalAcceptance} from './legal-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app.mjs';
import { provisionOwner, token } from '../security.mjs';
import { FREE_MODELS, OPENROUTER_BASE, readModelCatalog } from '../openrouter.mjs';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const visual = () => ({ summary: 'Человек показывает товар.', speech: 'Неизвестная речь', audio: 'Неизвестный звук',
  events: [{ from: 0, to: 5, visual: 'Товар крупным планом.', speech: 'Угаданные слова', audio: 'Музыка' }],
  limitations: [], advice: ['Начните с крупного плана товара.'] });
const completion = (analysis = null, usage = { prompt_tokens: 120, completion_tokens: 30, cost: 0 }) => json({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ analysis, summary: 'План подготовлен.', operations: [{ type: 'ratio', value: '9:16' }] }) } }], usage
});
function request() { return { version: 1, requestId: token(), projectId: 'p1', revision: 'pk1-test', prompt: 'Предложи монтаж.', cursor: 0, selection: null,
  project: { id: 'p1', schema: 4, mode: 'reels', ratio: '9:16', clips: [{ id: 'v1', assetId: 'asset1', kind: 'video', duration: 10, start: 0, end: 10, speed: 1 }], audio: [], texts: [] }, capabilities: ['ratio'], fontIds: ['system'] }; }
function media() {
  const ftyp = Buffer.alloc(24); ftyp.writeUInt32BE(24, 0); ftyp.write('ftypisom', 4);
  const mvhd = Buffer.alloc(108); mvhd.writeUInt32BE(108, 0); mvhd.write('mvhd', 4); mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(10000, 24);
  const moov = Buffer.alloc(8); moov.writeUInt32BE(116, 0); moov.write('moov', 4);
  return { clipId: 'v1', assetId: 'asset1', mime: 'video/mp4', data: Buffer.concat([ftyp, moov, mvhd]).toString('base64') };
}
const analyze = () => ({ service: 'source-analysis', request: request(), media: media(), mediaConsent: true });
function catalog(url, unavailable = []) {
  const id = url.slice((OPENROUTER_BASE + '/models/').length, -'/endpoints'.length).split('/').map(decodeURIComponent).join('/');
  return json({ data: { id, architecture: { input_modalities: id === FREE_MODELS.deepseek ? ['text'] : ['text', 'image', 'video'] },
    endpoints: unavailable.includes(id) ? [] : [{ status: 0, pricing: { prompt: '0', completion: '0' } }] } });
}
test('a transient public catalog failure retries a fresh credential-free GET without generating',async()=>{
 const calls=[];
 const data=await readModelCatalog(async(url,init)=>{
  calls.push(init);assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,undefined);assert.equal(init.body,undefined);
  assert.equal(init.headers.Connection,'close');assert.equal(init.redirect,'manual');
  if(calls.length===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
  return catalog(url);
 },FREE_MODELS.gemma);
 assert.equal(data.id,FREE_MODELS.gemma);assert.equal(calls.length,2);assert.notEqual(calls[0].signal,calls[1].signal);
});

test('denied, redirected, malformed, oversized and TLS catalog responses fail closed without retries',async()=>{
 const cases=[
  [()=>new Response('denied',{status:403}),'HTTP 403'],
  [()=>new Response(null,{status:302,headers:{Location:'https://example.test/'}}),'HTTP 302'],
  [()=>new Response('not json'),'INVALID_JSON'],
  [()=>json({data:{id:'another-model',endpoints:[]}}),'INVALID_CATALOG'],
  [()=>new Response('x'.repeat(128001)),'RESPONSE_TOO_LARGE'],
  [()=>{throw new TypeError('secret details',{cause:{code:'CERT_HAS_EXPIRED'}});},'TLS']
 ];
 for(const [result,code] of cases){let calls=0;await assert.rejects(readModelCatalog(async()=>{calls++;return result();},FREE_MODELS.gemma),error=>error.code===code&&!error.message.includes('secret'));assert.equal(calls,1);}
});
async function fixture(upstream) {
  let clock = Date.UTC(2026, 9, 20, 10); const calls = [];
  const dir = mkdtempSync(join(tmpdir(), 'pk-router-')); mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), '<!doctype html>');
  const options = { singleAi:false, now: () => clock, accountsEnabled: true, origin: 'http://localhost:5173', dataDir: join(dir, 'private'), dist: join(dir, 'dist'),
    aiFetch: async (url, init) => { calls.push([url, init]); return upstream ? upstream(url, init) : init.method === 'GET' ? catalog(url) : completion(JSON.parse(init.body).model === FREE_MODELS.deepseek ? null : visual()); } };
  let app = createApp(options);prepareLegal(app); const password = token(); await provisionOwner(app.store, 'router_owner', password);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  function client() {
    const cookies = new Map(); let csrf = '', accountId = '';
    return async (path, method = 'GET', data, headers = {}) => new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path, method,
        headers: { Host: 'localhost:5173', Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-PK-Account': accountId,
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers } }, res => {
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
  const owner = client(); await owner('/api/admin/login', 'POST', { login: 'router_owner', password });
  return { get app() { return app; }, calls, owner, client, password, advance: ms => { clock += ms; },
    configure: (patch = {}, headers = {}) => owner('/api/admin/ai/openrouter', 'PUT', { apiKey: 'fake-openrouter-key-for-tests', analysisModel: FREE_MODELS.gemma,
      editModel: FREE_MODELS.deepseek, dailyLimit: 40, enabled: true, trialEnabled: true, password, ...patch }, headers),
    register: async (email = 'router@example.test') => { const user = client(); await user('/api/account/session'); const password = token();
      const registered = await user('/api/account/register', 'POST', { email, password, confirmPassword: password, ...legalAcceptance });
      assert.equal(registered.status, 201); return { user, id: registered.data.user.id }; },
    restart: async () => { await new Promise(resolve => app.server.close(resolve)); app = createApp(options);prepareLegal(app); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); },
    close: async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(dir, { recursive: true, force: true }); } };
}

test('OpenRouter credentials are owner-only, encrypted, independent and never cause an automatic inference', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.client()('/api/admin/ai/openrouter')).status, 401);
    assert.equal((await f.configure({ password: 'wrong' })).status, 403);
    assert.equal((await f.configure({}, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await f.configure({ endpoint: 'https://localhost/' })).status, 400);
    assert.equal((await f.configure({ analysisModel: 'qwen/qwen3.8-27b' })).status, 400);
    assert.equal((await f.configure({ editModel: 'openai/expensive-model' })).status, 400);
    assert.equal((await f.configure({ dailyLimit: 51 })).status, 400);
    const before = f.app.store.get('SELECT secret FROM settings').secret;
    assert.equal((await f.configure()).status, 200); assert.equal(f.calls.length, 0);
    const secret = f.app.store.get('SELECT secret FROM ai_openrouter_config').secret;
    assert.notEqual(secret, 'fake-openrouter-key-for-tests'); assert.equal(f.app.store.unseal(secret), 'fake-openrouter-key-for-tests');
    assert.equal(f.app.store.get('SELECT secret FROM settings').secret, before);
    const settings = await f.owner('/api/admin/ai/openrouter'); assert.ok(!settings.raw.includes('fake-openrouter-key-for-tests')); assert.equal(settings.data.analysisVerified, false);
    assert.equal((await f.configure({ apiKey: '' })).status, 200); assert.equal(f.app.store.get('SELECT secret FROM ai_openrouter_config').secret, secret);
    const { user } = await f.register(); assert.equal((await user('/api/admin/ai/analytics')).status, 401);
    assert.equal((await user('/api/admin/ai/openrouter/catalog')).status, 401);
    await f.configure({ apiKey: '', removeKey: true, enabled: false, trialEnabled: false });
    assert.equal((await f.owner('/api/admin/ai/openrouter')).data.keyConfigured, false);
    assert.equal(f.app.store.get('SELECT secret FROM settings').secret, before);
  } finally { await f.close(); }
});

test('Unavailable free endpoints block media upload without spending coins or a generation attempt', async () => {
  const f = await fixture(async (url, init) => { assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, undefined); return catalog(url, [FREE_MODELS.qwen]); });
  try {
    await f.configure({ analysisModel: FREE_MODELS.qwen }); const { user } = await f.register();
    const result = await user('/api/ai/edit-plan', 'POST', analyze()); assert.equal(result.status, 503); assert.match(result.data.error, /бесплатного API/);
    assert.equal(f.app.store.get('SELECT count(*) AS n FROM ai_runs').n, 0);
    assert.equal((await user('/api/ai/status?service=source-analysis')).data.billing.remainingCoins, 3);
    const check = await f.owner('/api/admin/ai/openrouter/catalog'); assert.equal(check.status, 200); assert.equal(check.data.items.find(m => m.model === FREE_MODELS.qwen).available, false);
    assert.equal(f.calls.filter(([, init]) => init.method === 'POST').length, 0);
  } finally { await f.close(); }
});

test('Visual analysis returns advice only, labels unavailable audio honestly and DeepSeek receives text context only', async () => {
  const f = await fixture();
  try {
    await f.configure(); const { user } = await f.register();
    const noConsent = analyze(); delete noConsent.mediaConsent; assert.equal((await user('/api/ai/edit-plan', 'POST', noConsent)).status, 400);
    assert.equal((await user('/api/ai/edit-plan', 'POST', { service: 'deepseek-edit', request: request() })).status, 422);
    const first = analyze(); first.request.project.ratio = '16:9'; first.request.project.mode = 'video';
    const result = await user('/api/ai/edit-plan', 'POST', first); assert.equal(result.status, 200, result.raw);
    assert.equal(result.data.plan, null); assert.equal(result.data.analysis.scope, 'visual'); assert.equal(result.data.analysis.speech, ''); assert.equal(result.data.analysis.audio, '');
    assert.equal(result.data.analysis.events[0].speech, ''); assert.equal(result.data.analysis.events[0].audio, ''); assert.equal(result.data.analysis.advice.length, 1);
    assert.equal(result.data.billing.remainingCoins, 2); assert.equal(result.data.billing.chargedCoins, 1);
    const post = f.calls.find(([, i]) => i.method === 'POST'), payload = JSON.parse(post[1].body);
    assert.equal(post[0], OPENROUTER_BASE + '/chat/completions'); assert.equal(post[1].redirect, 'error');
    assert.equal(payload.model, FREE_MODELS.gemma); assert.equal(payload.messages[1].content[1].video_url.url, 'data:video/mp4;base64,' + media().data);
    assert.deepEqual(payload.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 }); assert.equal(payload.provider.allow_fallbacks, false);
    assert.equal((await user('/api/ai/edit-plan', 'POST', first)).status, 409);
    const second = await user('/api/ai/edit-plan', 'POST', { service: 'deepseek-edit', request: request(), context: result.data.analysis });
    assert.equal(second.status, 200, second.raw); assert.equal(second.data.billing.remainingCoins, 1); assert.ok(second.data.plan);
    const edit = JSON.parse(f.calls.filter(([, i]) => i.method === 'POST')[1][1].body); assert.equal(edit.model, FREE_MODELS.deepseek);
    assert.equal(edit.messages[1].content.length, 1); const input = JSON.parse(edit.messages[1].content[0].text);
    assert.equal(input.media, null); assert.equal(input.previousAnalysis.scope, 'visual'); assert.equal(input.previousAnalysis.advice.length, 1);
    assert.equal(JSON.stringify(edit).includes(media().data), false);
    const usage = await f.owner('/api/admin/ai/analytics?days=7'); assert.equal(usage.data.totals.attempts, 2); assert.equal(usage.data.totals.users, 1);
    assert.equal(usage.data.totals.inputTokens, 240); assert.equal(usage.data.totals.reportedCostUsd, 0); assert.equal(usage.data.totals.coins, 2);
    assert.equal(usage.data.models.length, 2); assert.equal(usage.raw.includes('Человек показывает товар'), false); assert.equal(usage.raw.includes(media().data), false);
    assert.equal((await f.owner('/api/admin/ai/openrouter')).data.analysisVerified, true);
    await f.restart(); assert.equal((await user('/api/ai/status?service=deepseek-edit')).data.billing.remainingCoins, 1);
    const other = analyze(); other.request.projectId = other.request.project.id = 'p2'; assert.equal((await user('/api/ai/edit-plan', 'POST', other)).status, 402);
  } finally { await f.close(); }
});

test('Provider errors refund gift coins, count site attempts, retain safe HTTP metrics and never retry or fall back', async () => {
  let postCalls = 0; const f = await fixture(async (url, init) => init.method === 'GET' ? catalog(url) : (++postCalls, new Response('private upstream key', { status: 429 })));
  try {
    await f.configure({ dailyLimit: 2 }); const { user } = await f.register();
    for (let n = 0; n < 2; n++) { const result = await user('/api/ai/edit-plan', 'POST', analyze()); assert.equal(result.status, 429); assert.ok(!result.raw.includes('private upstream')); }
    assert.equal((await user('/api/ai/status?service=source-analysis')).data.billing.remainingCoins, 3);
    assert.equal((await user('/api/ai/edit-plan', 'POST', analyze())).status, 429); assert.equal(postCalls, 2);
    const data = (await f.owner('/api/admin/ai/analytics?days=1')).data;
    assert.equal(data.totals.failed, 2); assert.equal(data.totals.coins, 0); assert.equal(data.quota.remaining, 0); assert.equal(data.totals.reportedCostUsd, null);
    const items = (await f.owner('/api/admin/ai/usage')).data.items; assert.ok(items.every(r => r.upstream_status === 429 && r.coin_charge === 0 && r.duration_ms >= 0));
    await f.restart(); assert.equal((await f.owner('/api/admin/ai/openrouter')).data.quota.used, 2);
    f.advance(14 * 3600000 + 1); assert.equal((await f.owner('/api/admin/ai/analytics?days=1')).status, 401);
    await f.owner('/api/admin/login', 'POST', { login: 'router_owner', password: f.password });
    assert.equal((await f.owner('/api/admin/ai/openrouter')).data.quota.used, 0);
  } finally { await f.close(); }
});

test('Stale config or revoked sessions reject results, refund once and preserve metered provider usage', async () => {
  let f, change = 'settings'; f = await fixture(async (url, init) => {
    if (init.method === 'GET') return catalog(url);
    if (change === 'settings') f.app.store.run('UPDATE ai_openrouter_config SET revision=? WHERE id=1', token());
    else f.app.store.run('DELETE FROM sessions');
    return completion(visual());
  });
  try {
    await f.configure(); const { user } = await f.register();
    assert.equal((await user('/api/ai/edit-plan', 'POST', analyze())).status, 409);
    assert.equal((await user('/api/ai/status?service=source-analysis')).data.billing.remainingCoins, 3);
    let row = f.app.store.get('SELECT * FROM ai_runs'); assert.equal(row.coin_charge, 0); assert.equal(row.input_tokens, 120); assert.equal(row.provider_cost_usd, 0);
    change = 'session'; assert.equal((await f.owner('/api/ai/edit-plan', 'POST', analyze())).status, 401);
    row = f.app.store.get('SELECT count(*) AS n FROM ai_runs'); assert.equal(row.n, 2);
  } finally { await f.close(); }
});

test('Paid or malformed catalog providers fail closed and unsupported media never reaches a provider', async () => {
  const f = await fixture(async (url, init) => { assert.equal(init.method, 'GET'); const r = await catalog(url).json(); r.data.endpoints[0].pricing.prompt = '1'; return json(r); });
  try {
    await f.configure(); const r = analyze(); r.media.mime = 'audio/wav'; assert.equal((await f.owner('/api/ai/edit-plan', 'POST', r)).status, 422);
    assert.equal((await f.owner('/api/ai/edit-plan', 'POST', { ...analyze(), service: 'deepseek-edit' })).status, 422);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.owner('/api/ai/edit-plan', 'POST', analyze())).status, 503);
    assert.equal(f.app.store.get('SELECT count(*) AS n FROM ai_runs').n, 0);
    assert.equal((await f.owner('/api/admin/ai/analytics?days=90')).status, 400);
  } finally { await f.close(); }
});

test('Capacity calculations distinguish quota from performance and owner attempts share the same budget', async () => {
  const f = await fixture();
  try {
    await f.configure(); await f.owner('/api/ai/edit-plan', 'POST', { service: 'deepseek-edit', request: request() });
    const data = (await f.owner('/api/admin/ai/analytics?days=7')).data;
    assert.equal(data.totals.users, 0); assert.equal(data.totals.coins, 0); assert.equal(data.quota.used, 1);
    assert.deepEqual(data.capacity.map(c => [c.requests, c.fitsSiteLimit, c.fitsProviderFreeLimit]), [[20, true, true], [30, true, true], [60, false, false]]);
  } finally { await f.close(); }
});

test('Truncated output refunds the trial but keeps consumed tokens and reported cost in analytics', async () => {
  const f = await fixture(async (url, init) => init.method === 'GET' ? catalog(url) : json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }], usage: { prompt_tokens: 500, completion_tokens: 4096, cost: 0 } }));
  try {
    await f.configure(); const { user } = await f.register();
    assert.equal((await user('/api/ai/edit-plan', 'POST', analyze())).status, 502);
    const usage = (await f.owner('/api/admin/ai/analytics')).data;
    assert.equal(usage.totals.failed, 1); assert.equal(usage.totals.inputTokens, 500); assert.equal(usage.totals.outputTokens, 4096);
    assert.equal(usage.totals.coins, 0); assert.equal(usage.totals.reportedCostUsd, 0);
    assert.equal((await user('/api/ai/status?service=source-analysis')).data.billing.remainingCoins, 3);
  } finally { await f.close(); }
});

test('An unavailable DeepSeek stays blocked until the owner explicitly selects a different free planner', async () => {
  const f = await fixture(async (url, init) => init.method === 'GET' ? catalog(url, [FREE_MODELS.deepseek]) : completion());
  try {
    await f.configure();
    assert.equal((await f.owner('/api/ai/edit-plan', 'POST', { service: 'deepseek-edit', request: request() })).status, 503);
    assert.equal(f.calls.filter(([, init]) => init.method === 'POST').length, 0);
    assert.equal((await f.configure({ editModel: FREE_MODELS.gemma, apiKey: '' })).status, 200);
    assert.equal((await f.owner('/api/ai/edit-plan', 'POST', { service: 'deepseek-edit', request: request() })).status, 200);
    const body = JSON.parse(f.calls.find(([, init]) => init.method === 'POST')[1].body);
    assert.equal(body.model, FREE_MODELS.gemma); assert.equal(body.messages[1].content.length, 1);
  } finally { await f.close(); }
});

test('Concurrent requests cannot exceed the provider budget and an unknown catalog never receives media', async () => {
  let ready, release; const started = new Promise(resolve => { ready = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(async (url, init) => {
    if (init.method === 'GET') return catalog(url);
    ready(); await gate; return completion(visual());
  });
  try {
    await f.configure({ dailyLimit: 1 });
    const pending = f.owner('/api/ai/edit-plan', 'POST', analyze()); await started;
    assert.equal((await f.owner('/api/ai/edit-plan', 'POST', analyze())).status, 429);
    release(); assert.equal((await pending).status, 200);
    assert.equal(f.calls.filter(([, init]) => init.method === 'POST').length, 1);
    assert.equal((await f.owner('/api/admin/ai/openrouter')).data.quota.used, 1);
  } finally { release(); await f.close(); }
  const broken = await fixture(async (_, init) => { assert.equal(init.method, 'GET'); throw Error('network'); });
  try {
    await broken.configure(); assert.equal((await broken.owner('/api/ai/edit-plan', 'POST', analyze())).status, 503);
    assert.equal(broken.app.store.get('SELECT count(*) AS n FROM ai_runs').n, 0);
  } finally { await broken.close(); }
});
