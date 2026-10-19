import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app.mjs';
import { provisionOwner, token } from '../security.mjs';
import { AI_LIMITS, OMNI_MODEL, validateOmniEndpoint, validateAiMedia, validateAiRequest } from '../ai.mjs';

const endpoint = 'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const request = () => ({ version: 1, requestId: token(), projectId: 'p1', revision: 'pk1-test', prompt: 'Опиши изображение и звуки. Предложи нужные правки.',
  project: { id: 'p1', schema: 4, clips: [{ id: 'v1', assetId: 'asset1', kind: 'video', name: 'sample.mp4', duration: 10, start: 0, end: 10, speed: 1 }], audio: [], texts: [] },
  cursor: 0, selection: { track: 'video', id: 'v1' }, capabilities: ['ratio', 'caption', 'trim'], fontIds: ['system'] });
function mp4(seconds = 10) {
  const ftyp = Buffer.alloc(24); ftyp.writeUInt32BE(24, 0); ftyp.write('ftypisom', 4);
  const mvhd = Buffer.alloc(108); mvhd.writeUInt32BE(108, 0); mvhd.write('mvhd', 4); mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(seconds * 1000, 24);
  const moov = Buffer.alloc(8); moov.writeUInt32BE(116, 0); moov.write('moov', 4);
  return Buffer.concat([ftyp, moov, mvhd]);
}
function media(seconds = 10) { return { clipId: 'v1', assetId: 'asset1', mime: 'video/mp4', data: mp4(seconds).toString('base64') }; }
const analysis = () => ({ summary: 'Человек показывает дорогу и рассказывает о поездке.', speech: 'Мы приехали.', audio: 'Слышен голос и проезжающая машина.',
  events: [{ from: 0, to: 5, visual: 'Дорога и автомобиль.', audio: 'Гул двигателя.', speech: 'Мы приехали.' }], limitations: ['Номер автомобиля неразборчив.'] });
function response(value = { analysis: null, summary: 'Изменить формат.', operations: [{ type: 'ratio', value: '9:16' }] }, extra = {}) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 1234, completion_tokens: 321 }, ...extra }), { headers: { 'Content-Type': 'application/json' } });
}

async function fixture(aiFetch) {
  const dir = mkdtempSync(join(tmpdir(), 'pk-ai-')); mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), '<!doctype html>');
  const app = createApp({ accountsEnabled: true, origin: 'http://localhost:5173', dataDir: join(dir, 'private'), dist: join(dir, 'dist'), aiFetch });
  const password = token(); await provisionOwner(app.store, 'test_owner', password);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  function client() {
    const cookies = new Map(); let csrf = '';
    return async (path, method = 'GET', data, headers = {}) => new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path, method,
        headers: { Host: 'localhost:5173', Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...headers }
      }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
          for (const line of res.headers['set-cookie'] || []) { const [k,v] = line.split(';')[0].split('='); if (v) cookies.set(k,v); else cookies.delete(k); }
          const raw = Buffer.concat(chunks).toString(); let value; try { value = JSON.parse(raw); } catch { value = raw; }
          if (value.csrf) csrf = value.csrf;
          resolve({ status: res.statusCode, data: value, raw });
        });
      }); req.on('error', reject); if (data !== undefined) req.write(JSON.stringify(data)); req.end();
    });
  }
  const owner = client(); await owner('/api/admin/login', 'POST', { login: 'test_owner', password });
  const configure = async (values = {}) => owner('/api/admin/settings', 'PUT', { provider: 'qwen', model: OMNI_MODEL, endpoint, apiKey: 'test-only-not-a-real-provider-key', aiEnabled: true, analyticsEnabled: false, password, ...values });
  return { app, owner, client, configure, password, close: async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(dir, { recursive: true, force: true }); } };
}

test('Omni destinations and file-duration limits are validated without fetching URLs', () => {
  assert.equal(validateOmniEndpoint(endpoint + '/'), endpoint);
  for (const url of ['http://localhost/compatible-mode/v1','https://evil.example/compatible-mode/v1','https://dashscope-intl.aliyuncs.com.evil.test/compatible-mode/v1',endpoint+'?key=x',endpoint+'#x','https://u:p@dashscope.aliyuncs.com/compatible-mode/v1']) assert.throws(() => validateOmniEndpoint(url));
  const r = validateAiRequest(request()); assert.equal(validateAiMedia(media(), r).duration, 10);
  assert.throws(() => validateAiMedia(media(61), r), /60 секунд/);
  assert.throws(() => validateAiMedia({ ...media(), data: 'https://private.example/file.mp4' }, r));
  assert.throws(() => validateAiMedia({ ...media(), assetId: 'someone-else' }, r));
  assert.throws(() => validateAiMedia({ ...media(), data: Buffer.from('not a video').toString('base64') }, r));
});

test('Omni HTTP pilot is owner-only, CSRF-protected, opt-in and does not disclose the key', async () => {
  const calls = []; const f = await fixture(async (...args) => { calls.push(args); return response(); });
  try {
    const guest = f.client(); assert.equal((await guest('/api/ai/edit-plan', 'POST', { request: request() })).status, 401);
    const status = await guest('/api/ai/status'); assert.equal(status.data.available, false); assert.equal(status.data.configured, false);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()})).status,503);
    assert.equal((await f.configure({endpoint:'https://evil.example/compatible-mode/v1'})).status,400);
    assert.equal((await f.configure()).status,200);
    const settings = await f.owner('/api/admin/settings'); assert.equal(settings.data.connected,false); assert.equal(settings.data.configured,true); assert.ok(!settings.raw.includes('test-only-not-a-real-provider-key'));
    assert.equal((await f.owner('/api/ai/status')).data.available,true);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()},{'X-CSRF-Token':'wrong'})).status,403);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()},{Origin:'https://evil.example'})).status,403);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request(),media:media()})).status,400);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request(),media:media(61),mediaConsent:true})).status,400);
    const user = f.client(); await user('/api/account/session');
    const p=token(); assert.equal((await user('/api/account/register','POST',{email:'trial@example.test',password:p,confirmPassword:p,acceptPrivacy:true})).status,201);
    assert.equal((await user('/api/ai/edit-plan','POST',{request:request()})).status,403);
    assert.equal((await user('/api/admin/ai/usage')).status,401);
    assert.equal(calls.length,0);
    const r=request(), result=await f.owner('/api/ai/edit-plan','POST',{request:r});
    assert.equal(result.status,200); assert.equal(result.data.plan.requestId,r.requestId); assert.equal(result.data.analysis,null);
    assert.deepEqual(result.data.usage,{inputTokens:1234,outputTokens:321});
    assert.equal((await f.owner('/api/admin/settings')).data.connected,true);
    const [url, init]=calls[0]; assert.equal(url,endpoint+'/chat/completions'); assert.equal(init.redirect,'error'); assert.ok(init.signal instanceof AbortSignal);
    const payload=JSON.parse(init.body); assert.equal(payload.model,OMNI_MODEL); assert.equal(payload.stream,false); assert.equal(payload.response_format.type,'json_object'); assert.equal(payload.messages[1].content.length,1);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:r})).status,409); assert.equal(calls.length,1);
    assert.equal((await f.configure({removeKey:true,apiKey:'',aiEnabled:false})).status,200);
    assert.equal((await f.owner('/api/ai/status')).data.available,false);
  } finally { await f.close(); }
});

test('Omni transmits the selected video including audio as data, validates its analysis, and stores usage only', async () => {
  let payload, mode='good';
  const f=await fixture(async (_url,init)=>{
    payload=JSON.parse(init.body);
    if(mode==='provider-error')return new Response('private provider details and fake key',{status:401});
    if(mode==='invalid-operation')return response({analysis:analysis(),summary:'Bad',operations:[{type:'execute',url:'https://evil.example'}]});
    if(mode==='invalid-time')return response({analysis:{...analysis(),events:[{...analysis().events[0],to:70}]},summary:'Bad',operations:[]});
    if(mode==='truncated')return response(undefined,{choices:[{finish_reason:'length',message:{content:'{}'}}]});
    return response({analysis:analysis(),summary:'Смысл понятен. Изменений пока не требуется.',operations:[]});
  });
  try {
    await f.configure();
    const result=await f.owner('/api/ai/edit-plan','POST',{request:request(),media:media(),mediaConsent:true});
    assert.equal(result.status,200); assert.equal(result.data.plan,null); assert.equal(result.data.analysis.clipId,'v1'); assert.equal(result.data.analysis.events[0].audio,'Гул двигателя.');
    assert.equal(payload.messages[1].content[1].type,'video_url'); assert.equal(payload.messages[1].content[1].video_url.url,'data:;base64,'+media().data);
    const usage=await f.owner('/api/admin/ai/usage'); assert.equal(usage.data.items[0].media_seconds,10); assert.equal(usage.data.items[0].input_tokens,1234); assert.ok(!usage.raw.includes('Мы приехали')); assert.ok(!usage.raw.includes(media().data));
    const columns=f.app.store.all('PRAGMA table_info(ai_runs)').map(c=>c.name); assert.ok(!columns.includes('media')); assert.ok(!columns.includes('prompt'));
    mode='invalid-operation';const unsafe=await f.owner('/api/ai/edit-plan','POST',{request:request(),media:media(),mediaConsent:true});assert.equal(unsafe.status,200);assert.equal(unsafe.data.plan,null);assert.ok(unsafe.data.analysis);assert.match(unsafe.data.summary,/правки не прошли проверку/);
    for(const value of ['provider-error','invalid-time','truncated']){mode=value;const bad=await f.owner('/api/ai/edit-plan','POST',{request:request(),media:media(),mediaConsent:true});assert.equal(bad.status,502,value);assert.ok(!bad.raw.includes('private provider details'));}
  }finally{await f.close();}
});

test('Omni reserves a bounded daily quota and never retries a paid request automatically', async () => {
  let calls=0; const f=await fixture(async()=>{calls++;return response();});
  try{
    await f.configure();
    for(let i=0;i<AI_LIMITS.dailyRequests;i++)assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()})).status,200);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()})).status,429); assert.equal(calls,AI_LIMITS.dailyRequests);
  }finally{await f.close();}
});

test('Omni drops a result when its owner session is revoked during inference', async () => {
  let f; f=await fixture(async()=>{f.app.store.run('DELETE FROM sessions');return response();});
  try{await f.configure();const result=await f.owner('/api/ai/edit-plan','POST',{request:request()});assert.equal(result.status,401);assert.ok(!result.raw.includes('operations'));}
  finally{await f.close();}
});
