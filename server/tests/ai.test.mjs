import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app.mjs';
import { provisionOwner, token } from '../security.mjs';
import { AI_LIMITS, OMNI_MODEL, validateOmniEndpoint, validateAiMedia, validateAiRequest, validateReelsProject } from '../ai.mjs';

import { YANDEX_MODEL, YANDEX_ENDPOINT } from '../yandex.mjs';

const endpoint = 'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const request = () => ({ version: 1, requestId: token(), projectId: 'p1', revision: 'pk1-test', prompt: 'Опиши изображение и звуки. Предложи нужные правки.',
  project: { id: 'p1', schema: 4, mode: 'reels', ratio: '9:16', clips: [{ id: 'v1', assetId: 'asset1', kind: 'video', name: 'sample.mp4', duration: 10, start: 0, end: 10, speed: 1 }], audio: [], texts: [] },
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
  let clock = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'pk-ai-')); mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist/index.html'), '<!doctype html>');
  const options = { now: () => clock, accountsEnabled: true, origin: 'http://localhost:5173', dataDir: join(dir, 'private'), dist: join(dir, 'dist'), aiFetch };
  let app = createApp(options);
  const password = token(); await provisionOwner(app.store, 'test_owner', password);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  function client() {
    const cookies = new Map(); let csrf = '', accountId = '';
    return async (path, method = 'GET', data, headers = {}) => new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path, method,
        headers: { Host: 'localhost:5173', Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-PK-Account': accountId, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...headers }
      }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
          for (const line of res.headers['set-cookie'] || []) { const [k,v] = line.split(';')[0].split('='); if (v) cookies.set(k,v); else cookies.delete(k); }
          const raw = Buffer.concat(chunks).toString(); let value; try { value = JSON.parse(raw); } catch { value = raw; }
          if (value.csrf) csrf = value.csrf;
          if (value.user) accountId = value.user.id;
          if (path === '/api/admin/login' && res.statusCode === 200) accountId = 'owner';
          resolve({ status: res.statusCode, data: value, raw });
        });
      }); req.on('error', reject); if (data !== undefined) req.write(JSON.stringify(data)); req.end();
    });
  }
  const owner = client(); await owner('/api/admin/login', 'POST', { login: 'test_owner', password });
  const configure = async (values = {}) => owner('/api/admin/settings', 'PUT', { provider: 'qwen', model: OMNI_MODEL, endpoint, apiKey: 'test-only-not-a-real-provider-key', aiEnabled: true, analyticsEnabled: false, password, ...values });
  return { get app() { return app; }, owner, client, configure, password, advance: ms => { clock += ms; },
    restart: async () => { await new Promise(resolve => app.server.close(resolve)); app = createApp(options); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); },
    yandex: (values = {}) => owner('/api/admin/ai/yandex', 'PUT', { model: YANDEX_MODEL, folderId: 'b1gtestfolder12345678', apiKey: 'test-only-independent-yandex-key', enabled: true, password, ...values }),
    close: async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(dir, { recursive: true, force: true }); } };
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

test('Omni HTTP pilot is CSRF-protected, opt-in and does not disclose the key', async () => {
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
    assert.equal((await user('/api/ai/edit-plan','POST',{request:request()})).status,503);
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
    for(let i=0;i<AI_LIMITS.dailyRequests;i++){f.advance(61000);assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()})).status,200);}
    f.advance(61000);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request()})).status,429); assert.equal(calls,AI_LIMITS.dailyRequests);
  }finally{await f.close();}
});

test('Omni drops a result when its owner session is revoked during inference', async () => {
  let f; f=await fixture(async()=>{f.app.store.run('DELETE FROM sessions');return response();});
  try{await f.configure();const result=await f.owner('/api/ai/edit-plan','POST',{request:request()});assert.equal(result.status,401);assert.ok(!result.raw.includes('operations'));}
  finally{await f.close();}
});

async function register(f, email = 'trial@example.test') {
  const user = f.client(); await user('/api/account/session'); const password = token();
  const result = await user('/api/account/register', 'POST', { email, password, confirmPassword: password, acceptPrivacy: true });
  assert.equal(result.status, 201); return { user, password, id: result.data.user.id, email };
}
const analyze = () => ({ service: 'reels-trial', request: request(), media: media(), mediaConsent: true });
function yandexResponse(value = { analysis: null, summary: 'Вертикальный формат.', operations: [{ type: 'ratio', value: '9:16' }] }) {
  return new Response(JSON.stringify({ result: { alternatives: [{ status: 'ALTERNATIVE_STATUS_FINAL', message: { role: 'assistant', text: JSON.stringify(value) } }],
    usage: { inputTextTokens: '234', completionTokens: '56', totalTokens: '290' } } }), { headers: { 'Content-Type': 'application/json' } });
}

test('Reels restrictions include audio and text tails, malformed timings and source-independent project duration', () => {
  const project = request().project; assert.doesNotThrow(() => validateReelsProject(project));
  for (const patch of [{ mode: 'video' }, { ratio: '16:9' }, { clips: [{ ...project.clips[0], end: 61 }] },
    { audio: [{ id: 'a', start: 0, end: 10, speed: 1, at: 55 }] }, { texts: [{ id: 't', from: 50, to: 61 }] },
    { clips: [{ ...project.clips[0], speed: 0 }] }, { clips: [{ ...project.clips[0], speed: '1' }] }])
    assert.throws(() => validateReelsProject({ ...project, ...patch }));
});

test('Yandex has independent encrypted credentials, owner-only reauthentication and native JSON protocol', async () => {
  const calls=[]; const f=await fixture(async(url,init)=>{calls.push([url,init]);return yandexResponse();});
  try {
    await f.configure(); const qwenSecret=f.app.store.get('SELECT secret FROM settings').secret;
    assert.equal((await f.yandex({password:'wrong'})).status,403);
    assert.equal((await f.yandex()).status,200);
    const yandexSecret=f.app.store.get('SELECT secret FROM ai_yandex_config').secret;
    assert.notEqual(yandexSecret,'test-only-independent-yandex-key'); assert.equal(f.app.store.unseal(yandexSecret),'test-only-independent-yandex-key');
    assert.equal(f.app.store.get('SELECT secret FROM settings').secret,qwenSecret);
    await f.configure({apiKey:''}); assert.equal(f.app.store.get('SELECT secret FROM ai_yandex_config').secret,yandexSecret);
    const settings=await f.owner('/api/admin/ai/yandex'); assert.equal(settings.data.connected,false); assert.ok(!settings.raw.includes('test-only-independent-yandex-key'));
    const r=request(); r.project.mode='video'; r.project.ratio='16:9'; r.project.clips[0].end=120;
    const result=await f.owner('/api/ai/edit-plan','POST',{service:'yandex-edit',request:r});
    assert.equal(result.status,200,result.raw); assert.deepEqual(result.data.usage,{inputTokens:234,outputTokens:56});
    assert.deepEqual(result.data.access,{kind:'owner_test',customerChargeMinor:0,tariffConfigured:false});
    assert.equal((await f.owner('/api/admin/ai/yandex')).data.connected,true);
    const [url,init]=calls[0],payload=JSON.parse(init.body); assert.equal(url,YANDEX_ENDPOINT); assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Api-Key test-only-independent-yandex-key'); assert.equal(init.headers['x-data-logging-enabled'],'false');
    assert.equal(init.headers['x-folder-id'],'b1gtestfolder12345678'); assert.equal(payload.modelUri,'gpt://b1gtestfolder12345678/yandexgpt-5.1');
    assert.equal(payload.jsonObject,true); assert.equal(payload.completionOptions.stream,false); assert.equal(payload.completionOptions.maxTokens,'4096');
    assert.equal(JSON.parse(payload.messages[1].text).media,null); assert.match(payload.messages[0].text,/Не утверждай, что просмотрел видео/);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{...analyze(),service:'yandex-edit'})).status,422);
    assert.equal(f.app.store.get('SELECT count(*) AS n FROM ai_trial_usage').n,0);
    const user=await register(f); assert.equal((await user.user('/api/admin/ai/yandex')).status,401);
    assert.equal((await user.user('/api/admin/ai/yandex','PUT',{enabled:true})).status,401);
    const before=calls.length;
    const locked=await user.user('/api/ai/edit-plan','POST',{...analyze(),service:'yandex-edit',role:'owner',price:0,free:true,provider:'qwen'});
    assert.equal(locked.status,402); assert.equal(calls.length,before);
    const status=await user.user('/api/ai/status?service=yandex-edit'); assert.equal(status.data.available,false); assert.equal(status.data.tariffConfigured,false); assert.equal(status.data.paymentsEnabled,false);
    await f.yandex({apiKey:'',removeKey:true,enabled:false}); assert.equal(f.app.store.get('SELECT secret FROM settings').secret,qwenSecret);
    assert.equal((await f.owner('/api/ai/status?service=reels-trial')).data.available,true);
  } finally { await f.close(); }
});

test('Free trial is opt-in, binds one Reels and three requests, survives restart and cannot cross accounts', async () => {
  let calls=0; const f=await fixture(async()=>{calls++;return response({analysis:analysis(),summary:'Ролик понятен.',operations:[]});});
  try {
    await f.configure(); const {user,id}=await register(f);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze())).status,503); assert.equal(calls,0);
    await f.configure({trialEnabled:true});
    assert.equal((await user('/api/ai/edit-plan','POST',{request:request()})).status,422);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze(),{'X-PK-Account':'owner'})).status,409);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze(),{'X-CSRF-Token':'wrong'})).status,403);
    const first=analyze(); const a=await user('/api/ai/edit-plan','POST',first); assert.equal(a.status,200,a.raw);
    assert.deepEqual(a.data.access,{kind:'free_trial',customerChargeMinor:0,tariffConfigured:false}); assert.equal(a.data.trial.remaining,2); assert.equal(a.data.trial.requiresMedia,false);
    const start=f.app.store.get('SELECT * FROM ai_trial_usage WHERE account_id=?',id); assert.equal(start.expires-start.started,7*86400000);
    assert.equal((await user('/api/ai/edit-plan','POST',first)).status,409);
    const other=analyze();other.request.projectId='p2';other.request.project.id='p2';
    assert.equal((await user('/api/ai/edit-plan','POST',other)).status,402); assert.equal(calls,1);
    await f.restart(); assert.equal((await user('/api/ai/status')).data.trial.remaining,2);
    // After the initial real media analysis, metadata-only refinements are also allowed.
    f.advance(61000);
    const b=await user('/api/ai/edit-plan','POST',{request:request()});assert.equal(b.status,200,b.raw);assert.equal(b.data.trial.remaining,1);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze())).status,200);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze())).status,402); assert.equal(calls,3);
    const second=await register(f,'second@example.test'); assert.equal((await second.user('/api/ai/status')).data.trial.remaining,3);
    assert.equal((await second.user('/api/ai/edit-plan','POST',analyze(),{'X-PK-Account':id})).status,409);
    assert.equal((await second.user('/api/ai/edit-plan','POST',analyze())).status,200); assert.equal(calls,4);
    const rows=f.app.store.all('SELECT account_id,customer_charge_minor,access_kind FROM ai_runs');
    assert.ok(rows.every(r=>r.customer_charge_minor===0&&r.access_kind==='free_trial')); assert.ok(rows.some(r=>r.account_id===second.id));
  } finally { await f.close(); }
});

test('Provider failures refund trial requests while retaining daily attempt bounds and allow a fresh first project', async () => {
  let calls=0,fail=true; const f=await fixture(async()=>{calls++;return fail?new Response('upstream secret',{status:500}):response({analysis:analysis(),summary:'Готово',operations:[]});});
  try {
    await f.configure({trialEnabled:true});const {user}=await register(f);
    const failed=await user('/api/ai/edit-plan','POST',analyze());assert.equal(failed.status,502);assert.ok(!failed.raw.includes('upstream secret'));
    assert.equal((await user('/api/ai/status')).data.trial.remaining,3);assert.equal(f.app.store.get('SELECT count(*) AS n FROM ai_trial_usage').n,0);
    fail=false; const other=analyze();other.request.projectId='p2';other.request.project.id='p2';assert.equal((await user('/api/ai/edit-plan','POST',other)).status,200);
    fail=true;
    for(let i=0;i<4;i++){const next=analyze();next.request.projectId='p2';next.request.project.id='p2';assert.equal((await user('/api/ai/edit-plan','POST',next)).status,502);}
    assert.equal(calls,6);assert.equal((await user('/api/ai/status')).data.trial.remaining,2);
    const blocked=analyze();blocked.request.projectId='p2';blocked.request.project.id='p2';assert.equal((await user('/api/ai/edit-plan','POST',blocked)).status,429);assert.equal(calls,6);
  } finally { await f.close(); }
});

test('Trial expires without renewal and admins test both models without using a customer trial', async () => {
  let calls=0;const f=await fixture(async(url)=>{calls++;return url===YANDEX_ENDPOINT?yandexResponse():response({analysis:analysis(),summary:'Готово',operations:[]});});
  try {
    await f.configure({trialEnabled:true});await f.yandex();const {user,id,email,password}=await register(f);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze())).status,200);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',analyze())).status,200);
    assert.equal((await f.owner('/api/ai/edit-plan','POST',{service:'yandex-edit',request:request()})).status,200);
    assert.equal(f.app.store.get('SELECT used FROM ai_trial_usage WHERE account_id=?',id).used,1);
    assert.equal(f.app.store.get('SELECT count(*) AS n FROM ai_trial_usage').n,1);
    f.advance(7*86400000+1);await user('/api/account/session');assert.equal((await user('/api/account/login','POST',{email,password})).status,200);
    assert.equal((await user('/api/ai/status')).data.trial.expired,true);
    assert.equal((await user('/api/ai/edit-plan','POST',analyze())).status,402);assert.equal(calls,3);
  } finally { await f.close(); }
});

test('Yandex never falls back to Qwen and rejects stale settings before returning a plan', async () => {
  let calls=0,mode='error';let f;f=await fixture(async()=>{calls++;if(mode==='error')return new Response('private',{status:403});
    f.app.store.run('UPDATE ai_yandex_config SET revision=? WHERE id=1',token());return yandexResponse();});
  try {
    await f.configure();await f.yandex();const invoke=()=>f.owner('/api/ai/edit-plan','POST',{service:'yandex-edit',request:request()});
    const error=await invoke();assert.equal(error.status,502);assert.ok(!error.raw.includes('private'));assert.equal(calls,1);
    mode='stale';assert.equal((await invoke()).status,409);assert.equal(calls,2);assert.equal((await f.owner('/api/admin/ai/yandex')).data.verified,false);
  } finally { await f.close(); }
});

test('AI journal migration preserves earlier pilot records and unrelated provider secrets', async () => {
  const f=await fixture(async()=>response());
  try {
    await f.configure(); const secret=f.app.store.get('SELECT secret FROM settings').secret;
    f.app.store.db.exec(`DROP TABLE ai_runs;
      CREATE TABLE ai_runs(request_id TEXT PRIMARY KEY,at INTEGER NOT NULL,result TEXT NOT NULL,model TEXT NOT NULL,media_seconds REAL,input_tokens INTEGER,output_tokens INTEGER);
      INSERT INTO ai_runs VALUES('legacy',1,'ok','qwen3.8-omni-flash',10,123,45);`);
    await f.restart();const row=f.app.store.get('SELECT * FROM ai_runs WHERE request_id=?','legacy');
    assert.equal(row.input_tokens,123);assert.equal(row.output_tokens,45);assert.equal(row.account_id,'owner');assert.equal(row.access_kind,'owner_test');assert.equal(row.customer_charge_minor,0);
    assert.equal(f.app.store.get('SELECT secret FROM settings').secret,secret);
  } finally { await f.close(); }
});
