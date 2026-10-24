import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request as http} from 'node:http';
import {createApp} from '../app.mjs';
import {token,provisionOwner} from '../security.mjs';
import {legalDefaults} from '../legal.mjs';
import {prepareLegal,legalTestConfig,legalAcceptance} from './legal-fixture.mjs';

async function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'pk-legal-'));mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist/index.html'),'<!doctype html><title>Test</title>');
 const app=createApp({origin:'http://localhost:5173',dataDir:join(dir,'private'),dist:join(dir,'dist'),accountsEnabled:true,guestEditingEnabled:true,siteAgentAutoStart:false});
 const password=token();await provisionOwner(app.store,'legal_owner',password);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 function client(){const jar=new Map();let csrf='',account='';return async(path,method='GET',data,headers={})=>new Promise((resolve,reject)=>{
  const req=http({host:'127.0.0.1',port:app.server.address().port,path,method,headers:{Host:'localhost:5173',Origin:'http://localhost:5173','Content-Type':'application/json','X-CSRF-Token':csrf,'X-PK-Account':account,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{for(const line of res.headers['set-cookie']||[]){const [k,v]=line.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}const raw=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(raw);}catch{value=raw;}if(value.csrf)csrf=value.csrf;if(value.user)account=value.user.id;resolve({status:res.statusCode,data:value,raw,headers:res.headers});});});req.on('error',reject);if(data!==undefined)req.write(JSON.stringify(data));req.end();});}
 const owner=client(),guest=client();await owner('/api/admin/login','POST',{login:'legal_owner',password});
 async function register(email='one@example.test',patch={}){const c=client();await c('/api/account/session');const p=token();const result=await c('/api/account/register','POST',{email,password:p,confirmPassword:p,...legalAcceptance,...patch});return {c,result,password:p};}
 try{await fn({...app,owner,guest,register,password});}finally{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}
}

test('unpublished identity blocks new collection, preserves guest editing and owner login, serves clearly marked documents',()=>fixture(async f=>{
 const state=await f.guest('/api/legal');assert.equal(state.data.ready,false);assert.equal(state.data.salesReady,false);assert.equal((await f.guest('/api/health')).data.analyticsEnabled,false);
 const telemetry=await f.guest('/api/metrics/start','POST',{consent:true},{'X-PK-Metrics':'1'});assert.equal(telemetry.data.disabled,true);
 assert.equal((await f.register()).result.status,503);assert.equal(f.store.get('SELECT count(*) n FROM users').n,0);
 assert.equal((await f.guest('/studio')).status,200);assert.equal((await f.owner('/api/admin/session')).status,200);
 for(const slug of ['', '/terms','/privacy','/consent','/payments','/cookies','/content','/contacts']){const page=await f.guest('/legal'+slug);assert.equal(page.status,200);assert.match(page.raw,/Проект документов/);assert.match(page.raw,/noindex,follow/);assert.doesNotMatch(page.raw,/<script|fonts.googleapis/);}
 const css=await f.guest('/legal-assets/legal.css');assert.equal(css.status,200);assert.match(css.headers['content-type'],/text\/css/);
}));

test('legal settings require owner, same-origin CSRF and reauthentication; incomplete or false publication is rejected',()=>fixture(async f=>{
 assert.equal((await f.guest('/api/admin/legal')).status,401);
 assert.equal((await f.owner('/api/admin/legal','PUT',{...legalTestConfig,password:f.password},{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await f.owner('/api/admin/legal','PUT',{...legalTestConfig,password:'wrong'})).status,403);
 assert.equal((await f.owner('/api/admin/legal','PUT',{...legalDefaults,published:true,password:f.password})).status,400);
 assert.equal((await f.owner('/api/admin/legal','PUT',{...legalTestConfig,phone:'x',password:f.password})).status,400);
 const saved=await f.owner('/api/admin/legal','PUT',{...legalTestConfig,password:f.password});assert.equal(saved.status,200);assert.equal(saved.data.ready,true);assert.equal(saved.raw.includes(f.password),false);
}));

test('each legal choice and exact revision are enforced by server and saved atomically with the account',()=>fixture(async f=>{
 prepareLegal(f);
 for(const patch of [{acceptTerms:false},{acceptPrivacy:false},{adultConfirmed:false},{legalVersion:''}]){const r=(await f.register('one@example.test',patch)).result;assert.ok([400,409].includes(r.status),r.raw);}
 assert.equal(f.store.get('SELECT count(*) n FROM users').n,0);
 const {result}=await f.register();assert.equal(result.status,201,result.raw);
 const row=f.store.get('SELECT * FROM account_legal_acceptances WHERE account_id=?',result.data.user.id);
 assert.equal(row.version,legalAcceptance.legalVersion);assert.equal(row.terms,1);assert.equal(row.consent,1);assert.equal(row.adult,1);assert.ok(row.accepted_at>0);
}));

test('published revisions are immutable, operator text is escaped, stale registration cannot accept new terms',()=>fixture(async f=>{
 prepareLegal(f);const version=(await f.guest('/api/legal')).data.version;
 const next=await f.owner('/api/admin/legal','PUT',{...legalTestConfig,operatorName:'Новое имя <script>alert(1)</script>',password:f.password});assert.equal(next.status,200);assert.notEqual(next.data.version,version);
 const current=await f.guest('/legal/contacts');assert.match(current.raw,/&lt;script&gt;/);assert.doesNotMatch(current.raw,/<script>/);
 const old=await f.guest('/legal/contacts?version='+version);assert.match(old.raw,/Тестовый оператор/);assert.doesNotMatch(old.raw,/Новое имя/);
 assert.equal((await f.register()).result.status,409);
 assert.equal((await f.guest('/legal/contacts?version=unknown')).status,404);
}));

test('privacy requests are authenticated, confirmed, CSRF protected and isolated; no irreversible deletion happens',()=>fixture(async f=>{
 prepareLegal(f);const a=await f.register(),b=await f.register('two@example.test');assert.equal(a.result.status,201);
 assert.equal((await f.guest('/api/account/privacy-requests')).status,401);
 assert.equal((await a.c('/api/account/privacy-requests','POST',{kind:'erase',confirmed:true},{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await a.c('/api/account/privacy-requests','POST',{kind:'erase',confirmed:false})).status,400);
 const sent=await a.c('/api/account/privacy-requests','POST',{kind:'erase',confirmed:true});assert.equal(sent.status,201);
 assert.equal((await a.c('/api/account/privacy-requests')).data.items.length,1);assert.equal((await b.c('/api/account/privacy-requests')).data.items.length,0);
 const admin=await f.owner('/api/admin/legal');assert.equal(admin.status,200,admin.raw);assert.equal(admin.data.requests.length,1);assert.equal(admin.data.requests[0].email,'one@example.test');assert.equal(f.store.get('SELECT count(*) n FROM users').n,2);
}));

test('unpublishing stops new registration but preserves existing login, balances and statutory records',()=>fixture(async f=>{
 prepareLegal(f);const a=await f.register();assert.equal(a.result.status,201);
 await f.owner('/api/admin/legal','PUT',{...legalTestConfig,published:false,password:f.password});
 assert.equal((await f.register('two@example.test')).result.status,503);
 const c=f.guest;await c('/api/account/session');const login=await c('/api/account/login','POST',{email:'one@example.test',password:a.password});assert.equal(login.status,200);
 assert.equal((await a.c('/api/ai/edit-plan','POST',{})).status,503);
 assert.equal(f.store.get('SELECT count(*) n FROM account_legal_acceptances').n,1);assert.equal((await c('/api/billing/catalog')).data.available,false);
}));


test('updated document templates require renewed operator review and cannot create unarchived consent versions',()=>fixture(async f=>{
 prepareLegal(f);const accepted=(await f.guest('/api/legal')).data.version;const previous={...legalTestConfig,reviewedEdition:'previous-edition'};f.store.run("UPDATE meta SET value=? WHERE key='legal_config'",JSON.stringify(previous));
 const state=(await f.guest('/api/legal')).data;assert.equal(state.ready,false);assert.equal(state.requiresReview,true);assert.equal((await f.register()).result.status,503);assert.match((await f.guest('/legal')).raw,/Проект документов/);
 const settings=(await f.owner('/api/admin/legal')).data;assert.equal(settings.config.documentsApproved,false);assert.equal((await f.guest('/legal/terms?version='+accepted)).status,200);
 assert.equal((await f.owner('/api/admin/legal','PUT',{...settings.config,password:f.password})).status,400);const published=await f.owner('/api/admin/legal','PUT',{...legalTestConfig,password:f.password});assert.equal(published.status,200);assert.equal(published.data.ready,true);assert.equal((await f.guest('/legal/terms?version='+published.data.version)).status,200);
}));
