import {prepareLegal} from './legal-fixture.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../app.mjs';
import { OWNER_PATH } from '../owner-route.mjs';
import { hashPassword, checkPassword, token, totp, newTotpSecret, verifyTotp, provisionOwner, openStore } from '../security.mjs';

const password = 'test-only-' + token();
let encoded;
before(async () => { encoded = await hashPassword(password); });
async function fixture({ provision = true, origin = 'http://localhost:5173' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pk-owner-test-')); mkdirSync(join(dir,'dist'));
  writeFileSync(join(dir,'dist/index.html'), '<!doctype html><title>Test site</title>');
  let time = Date.now();
  const { server, store } = createApp({ origin, dataDir:join(dir,'private'), dist:join(dir,'dist'), now:()=>time });
  prepareLegal({store,origin});
  if (provision) store.run('INSERT INTO owner(id,login,password,created) VALUES(1,?,?,?)', 'owner', encoded, time);
  server.listen(0, '127.0.0.1'); await once(server,'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, { method='GET', data, cookie='', csrf='', headers={} }={}) => {
    return await new Promise((ok,no)=>{
      const encodedBody=data!==undefined?JSON.stringify(data):undefined;
      const q=httpRequest(base+path,{method,headers:{host:new URL(origin).host,origin:origin,'content-type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...headers}}, response=>{
        const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
          const raw=Buffer.concat(chunks).toString();let body;try{body=JSON.parse(raw);}catch{body=raw;}
          const hs=new Headers();for(const [key,v] of Object.entries(response.headers)) if(v!==undefined)hs.set(key,Array.isArray(v)?v.join(', '):v);
          ok({status:response.statusCode,body,raw,headers:hs,cookie:hs.get('set-cookie')?.split(';')[0]||''});
        });
      });q.on('error',no);if(encodedBody)q.write(encodedBody);q.end();
    });
  };
  const login=async(extra={})=>{const r=await request('/api/admin/login',{method:'POST',data:{login:'owner',password,...extra}});assert.equal(r.status,200,r.raw);return {cookie:r.cookie,csrf:r.body.csrf};};
  return {dir,store,request,login,advance:ms=>{time+=ms;},now:()=>time,close:async()=>{await new Promise(ok=>server.close(ok));rmSync(dir,{recursive:true,force:true});}};
}
async function using(fn, opts) { const f=await fixture(opts);try{await fn(f);}finally{await f.close();} }

test('passwords are salted scrypt hashes, not reversible plaintext',async()=>{
 assert.ok(encoded.startsWith('scrypt$131072$8$1$'));assert.equal(await checkPassword(password,encoded),true);assert.equal(await checkPassword('wrong',encoded),false);
 await assert.rejects(()=>hashPassword('short'));assert.equal(await checkPassword('x'.repeat(513),encoded),false);
});
test('TOTP validates a single time step and rejects replay',()=>{
 const s=newTotpSecret(),time=Date.now(),step=Math.floor(time/30000),code=totp(s,step);
 assert.equal(verifyTotp(s,code,time),step);assert.equal(verifyTotp(s,code,time,step),null);assert.equal(verifyTotp(s,'bad',time),null);
});
test('setup is closed to public requests and only one owner exists',async()=>using(async f=>{
 assert.equal((await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password}})).status,503);
 assert.equal((await f.request('/api/admin/setup',{method:'POST',data:{login:'intruder',password}})).status,401);
 await provisionOwner(f.store,'owner',password);
 await assert.rejects(()=>provisionOwner(f.store,'other',password));
 assert.equal(f.store.get('SELECT count(*) n FROM owner').n,1);
}, {provision:false}));
test('every private endpoint rejects a guest, forged cookie and localStorage-style bearer',async()=>using(async f=>{
 for(const path of ['/api/admin/session','/api/admin/overview','/api/admin/settings','/api/admin/audit']){
  assert.equal((await f.request(path)).status,401,path);
  assert.equal((await f.request(path,{cookie:'pk-owner-local='+token(),headers:{Authorization:'Bearer owner'}})).status,401,path);
 }
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',data:{apiKey:'injected'}})).status,401);
}));
test('login returns an HttpOnly Strict cookie, never a bearer token',async()=>using(async f=>{
 const r=await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password}});
 assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
 assert.equal(r.body.token,undefined);assert.ok(r.body.csrf);assert.ok(!r.raw.includes(password));assert.match(r.headers.get('cache-control'),/no-store/);
}));
test('wrong username and wrong password share a generic error',async()=>using(async f=>{
 const a=await f.request('/api/admin/login',{method:'POST',data:{login:'intruder',password}});
 const b=await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password:'wrong'}});
 assert.equal(a.status,401);assert.deepEqual(a.body,b.body);
}));
test('cross-origin login, cross-site mutation and missing CSRF are denied',async()=>using(async f=>{
 assert.equal((await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password},headers:{Origin:'https://evil.example'}})).status,403);
 const auth=await f.login();
 assert.equal((await f.request('/api/admin/logout',{method:'POST',cookie:auth.cookie,data:{}})).status,403);
 assert.equal((await f.request('/api/admin/logout',{method:'POST',...auth,data:{},headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.request('/api/admin/logout',{method:'POST',...auth,data:{},headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await f.request('/api/admin/session',auth)).status,200);
}));
test('a second login revokes the first session; logout revokes the second',async()=>using(async f=>{
 const a=await f.login(),b=await f.login();
 assert.equal((await f.request('/api/admin/session',a)).status,401);assert.equal((await f.request('/api/admin/session',b)).status,200);
 const out=await f.request('/api/admin/logout',{method:'POST',...b,data:{}});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await f.request('/api/admin/session',b)).status,401);
}));
test('idle sessions expire after 30 minutes',async()=>using(async f=>{const a=await f.login();f.advance(30*60000+1);assert.equal((await f.request('/api/admin/session',a)).status,401);}));
test('sessions have a 12-hour absolute expiry even while active',async()=>using(async f=>{
 const a=await f.login();for(let i=0;i<24;i++){f.advance(29*60000);assert.equal((await f.request('/api/admin/session',a)).status,200);}f.advance(25*60000);assert.equal((await f.request('/api/admin/session',a)).status,401);
}));
test('brute-force limiting persists across requests',async()=>using(async f=>{
 for(let i=0;i<8;i++)assert.equal((await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password:'bad'}})).status,401);
 const locked=await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password}});assert.equal(locked.status,429);assert.equal(locked.headers.get('retry-after'),'900');
 f.advance(16*60000);await f.login();
}));
test('HTTPS configuration sets Secure Host-prefixed session cookie',async()=>using(async f=>{
 const a=await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password}});
 assert.match(a.cookie,/^__Host-pk-owner=/);assert.match(a.headers.get('set-cookie'),/; Secure/);assert.ok(a.headers.get('strict-transport-security'));
}, {origin:'https://studio.example'}));
test('public HTTP origins and wrong Host are rejected',async()=>{
 assert.throws(()=>createApp({origin:'http://public.example'}),/HTTPS/);
 await using(async f=>assert.equal((await f.request('/',{headers:{Host:'attacker.example'}})).status,421));
});
test('admin shell has CSP and source/private paths cannot be downloaded',async()=>using(async f=>{
 const shell=await f.request(OWNER_PATH);assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal(shell.headers.get('x-frame-options'),'DENY');
 for(const path of ['/.pokadrovo-private/master.key','/.env','/server/security.mjs','/owner-assets/../security.mjs','/%2e%2e%2fprivate%2fowner.sqlite']) assert.equal((await f.request(path)).status,404,path);
}));
test('API key is encrypted, write-only and password-confirmed',async()=>using(async f=>{
 const a=await f.login(),key='unit-test-key-'+token(),data={provider:'openai',model:'test-model',apiKey:key,password,analyticsEnabled:true};
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',...a,data:{...data,password:'bad'}})).status,403);
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',...a,data})).status,200);
 const db=f.store.get('SELECT secret FROM settings WHERE id=1');assert.notEqual(db.secret,key);assert.equal(f.store.unseal(db.secret),key);
 const view=await f.request('/api/admin/settings',a);assert.equal(view.body.keyConfigured,true);assert.equal(view.body.connected,false);assert.ok(!view.raw.includes(key));assert.equal(view.body.secret,undefined);
 assert.ok(!JSON.stringify(f.store.all('SELECT * FROM audit')).includes(key));
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',...a,data:{...data,apiKey:'',provider:'google'}})).status,400);
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',...a,data:{...data,apiKey:'',removeKey:true}})).status,200);
 assert.equal(f.store.get('SELECT secret FROM settings WHERE id=1').secret,null);
}));
test('invalid settings and arbitrary provider URLs are rejected',async()=>using(async f=>{
 const a=await f.login();
 for(const patch of [{provider:'http://127.0.0.1:22'},{model:'<script>alert(1)</script>'},{apiKey:'bad\nkey\n123456'}]){
  const r=await f.request('/api/admin/settings',{method:'PUT',...a,data:{provider:'openai',model:'model',password,analyticsEnabled:true,...patch}});assert.equal(r.status,400);
 }
}));
test('password rotation revokes sessions and old password',async()=>using(async f=>{
 const a=await f.login(),next='different-test-only-'+token();
 assert.equal((await f.request('/api/admin/password',{method:'POST',...a,data:{password,newPassword:next,confirmPassword:next}})).status,200);
 assert.equal((await f.request('/api/admin/session',a)).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password}})).status,401);
 await f.login({password:next});
}));
test('second factor setup requires confirmation; login requires fresh TOTP',async()=>using(async f=>{
 const a=await f.login();
 const begin=await f.request('/api/admin/totp/begin',{method:'POST',...a,data:{password}});assert.equal(begin.status,200);assert.match(begin.body.secret,/^[A-Z2-7]{32}$/);
 assert.equal(f.store.get('SELECT totp FROM owner WHERE id=1').totp,null);
 const code=totp(begin.body.secret,Math.floor(f.now()/30000));
 assert.equal((await f.request('/api/admin/totp/confirm',{method:'POST',...a,data:{code}})).status,200);
 assert.equal((await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password}})).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password,code}})).status,401);
 f.advance(31000);const nextCode=totp(begin.body.secret,Math.floor(f.now()/30000));await f.login({code:nextCode});
 assert.ok(!JSON.stringify(f.store.all('SELECT * FROM audit')).includes(begin.body.secret));
}));
test('TOTP setup and API write are unavailable without an owner session',async()=>using(async f=>{
 for(const path of ['/api/admin/totp/begin','/api/admin/totp/confirm','/api/admin/totp/disable','/api/admin/password'])assert.equal((await f.request(path,{method:'POST',data:{password}})).status,401);
}));
test('metrics require consent, signature, origin and fixed event types',async()=>using(async f=>{
 const headers={'X-PK-Metrics':'1'};
 assert.equal((await f.request('/api/metrics/event',{method:'POST',headers,data:{kind:'site_view',id:token()}})).status,401);
 assert.equal((await f.request('/api/metrics/start',{method:'POST',headers,data:{consent:false}})).status,400);
 const start=await f.request('/api/metrics/start',{method:'POST',headers,data:{consent:true}});assert.equal(start.status,200);
 assert.equal((await f.request('/api/metrics/event',{method:'POST',headers,cookie:start.cookie,data:{kind:'purchase',id:token()}})).status,400);
 assert.equal((await f.request('/api/metrics/event',{method:'POST',headers:{...headers,Origin:'https://evil.example'},cookie:start.cookie,data:{kind:'site_view',id:token()}})).status,403);
}));
test('counts come from real requests/events, duplicates are idempotent and project identifiers are hashed',async()=>using(async f=>{
 const headers={'X-PK-Metrics':'1'},start=await f.request('/api/metrics/start',{method:'POST',headers,data:{consent:true}});
 const event={kind:'site_view',id:token(),device:'desktop',prompt:'PRIVATE TEXT MUST NOT BE STORED'};
 const metric=async data=>{const r=await f.request('/api/metrics/event',{method:'POST',headers,cookie:start.cookie,data});assert.equal(r.status,200,r.raw);};
 await f.request('/');await f.request('/');await f.request(OWNER_PATH);
 await metric(event);await metric(event);await metric({kind:'editor_open',id:token(),mode:'reels'});
 await metric({kind:'project_saved',id:token(),project:'test-project-id'});await metric({kind:'project_saved',id:token(),project:'test-project-id'});
 await metric({kind:'export_completed',id:token(),format:'webm'});
 const a=await f.login(),summary=await f.request('/api/admin/overview?days=7',a);
 assert.equal(summary.body.metrics.pageRequests,2);assert.equal(summary.body.metrics.uniqueBrowsers,1);assert.equal(summary.body.metrics.visits,1);assert.equal(summary.body.metrics.projects,1);assert.equal(summary.body.metrics.projectSaves,2);assert.equal(summary.body.metrics.exports,1);assert.equal(summary.body.series.length,7);assert.equal(summary.body.integrations.payments,false);
 const stored=JSON.stringify(f.store.all('SELECT * FROM events'));assert.ok(!stored.includes('test-project-id'));assert.ok(!stored.includes('PRIVATE TEXT'));
 assert.equal((await f.request('/api/admin/overview?days=10000',a)).status,400);
}));
test('DNT/GPC disable event collection, opt-out deletes visitor-linked events',async()=>using(async f=>{
 const headers={'X-PK-Metrics':'1'};
 for(const extra of [{DNT:'1'},{'Sec-GPC':'1'}]){const r=await f.request('/api/metrics/start',{method:'POST',headers:{...headers,...extra},data:{consent:true}});assert.equal(r.body.disabled,true);assert.equal(r.cookie,'');}
 const start=await f.request('/api/metrics/start',{method:'POST',headers,data:{consent:true}});
 await f.request('/api/metrics/event',{method:'POST',headers,cookie:start.cookie,data:{kind:'site_view',id:token()}});
 assert.equal(f.store.get('SELECT count(*) n FROM events').n,1);
 const off=await f.request('/api/metrics/forget',{method:'POST',headers,cookie:start.cookie,data:{}});assert.equal(off.status,200);assert.equal(f.store.get('SELECT count(*) n FROM events').n,0);assert.match(off.headers.get('set-cookie'),/Max-Age=0/);
}));
test('owner can disable all aggregate/event recording',async()=>using(async f=>{
 const a=await f.login();await f.request('/api/admin/settings',{method:'PUT',...a,data:{provider:'openai',model:'',password,analyticsEnabled:false}});
 await f.request('/');assert.equal(f.store.get('SELECT count(*) n FROM page_days').n,0);
 const r=await f.request('/api/metrics/start',{method:'POST',headers:{'X-PK-Metrics':'1'},data:{consent:true}});assert.equal(r.body.disabled,true);
}));
test('oversize JSON and unsupported content types fail safely',async()=>using(async f=>{
 const a=await f.request('/api/admin/login',{method:'POST',data:{payload:'x'.repeat(20000)}});assert.equal(a.status,413);
 const b=await f.request('/api/admin/login',{method:'POST',data:{login:'owner',password},headers:{'Content-Type':'text/plain'}});assert.equal(b.status,415);
}));
test('private encryption key loss fails closed rather than silently resetting secrets',async()=>using(async f=>{
 const key=join(f.dir,'private/master.key');const bytes=readFileSync(key);rmSync(key);
 assert.throws(()=>openStore(join(f.dir,'private')),/Missing master.key/);writeFileSync(key,bytes,{mode:0o600});
}));
