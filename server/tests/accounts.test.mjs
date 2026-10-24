import {OWNER_PATH} from '../owner-route.mjs';
import {prepareLegal,legalAcceptance} from './legal-fixture.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createApp } from '../app.mjs';
import { hashPassword, token, digest, newTotpSecret, totp } from '../security.mjs';
import { authorizeUrl, createOAuthClient } from '../oauth.mjs';

const password = 'test-only-' + token();let encoded;
before(async()=>{encoded=await hashPassword(password);});
async function fixture(extra={}){
 const dir=mkdtempSync(join(tmpdir(),'pk-accounts-'));mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist/index.html'),'<!doctype html><title>Test</title>');
 let time=Date.now();const origin=extra.origin||'http://localhost:5173';
 const app=createApp({accountsEnabled:true,socialLoginEnabled:true,guestEditingEnabled:false,origin,dataDir:join(dir,'private'),dist:join(dir,'dist'),now:()=>time,...extra});prepareLegal(app);
 app.store.run('INSERT INTO owner(id,login,password,created) VALUES(1,?,?,?)','owner',encoded,time);
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const clients=[];
 const client=()=>{let jar=new Map(),csrf='',userId='';const c={async request(path,{method='GET',data,headers={},rawCookies}={}){return new Promise((ok,no)=>{
  const q=httpRequest({host:'127.0.0.1',port:app.server.address().port,path,method,headers:{Host:new URL(origin).host,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,'X-PK-Account':userId,Cookie:rawCookies===undefined?[...jar].map(([k,v])=>k+'='+v).join('; '):rawCookies,...headers}},r=>{const chunks=[];r.on('data',x=>chunks.push(x));r.on('end',()=>{for(const line of r.headers['set-cookie']||[]){const [k,v]=line.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}const raw=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(raw);}catch{data=raw;}if(data.csrf)csrf=data.csrf;if(data.user)userId=data.user.id;ok({status:r.statusCode,body:data,headers:r.headers,raw});});});q.on('error',no);if(data!==undefined)q.write(JSON.stringify(data));q.end();});},
   async init(){return c.request('/api/account/session');},
   async signup(email='one@example.test'){await c.init();return c.request('/api/account/register',{method:'POST',data:{name:'Test Creator',email,password,confirmPassword:password,...legalAcceptance}});},
   async admin(){const r=await c.request('/api/admin/login',{method:'POST',data:{login:'owner',password}});await c.init();return r;},
   setCsrf(v){csrf=v;},setId(v){userId=v;},cookies(){return [...jar].map(([k,v])=>k+'='+v).join('; ');}
  };clients.push(c);return c;};
 return {...app,client,advance:n=>{time+=n;},now:()=>time,close:async()=>{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}};
}
async function using(fn,opts){const f=await fixture(opts);try{await fn(f);}finally{await f.close();}}
const documentOf=(id='project-1')=>({id,schema:4,name:'Test project',mode:'video',ratio:'16:9',clips:[],audio:[],texts:[],brief:'Private brief',title:'',created:Date.now(),modified:Date.now(),master:1});

test('public session is anonymous with CSRF and disabled unconfigured providers',()=>using(async f=>{const c=f.client(),r=await c.init();assert.equal(r.status,200);assert.equal(r.body.user,null);assert.ok(r.body.csrf);assert.equal(r.body.providers.length,3);assert.ok(r.body.providers.every(p=>!p.ready));}));
test('registration requires same-origin, CSRF, privacy acknowledgement and strong matching passwords',()=>using(async f=>{const c=f.client();await c.init();const data={name:'User',email:'a@example.test',password,confirmPassword:password,...legalAcceptance};assert.equal((await c.request('/api/account/register',{method:'POST',data,headers:{Origin:'https://evil.example'}})).status,403);assert.equal((await c.request('/api/account/register',{method:'POST',data,headers:{'X-CSRF-Token':'wrong'}})).status,403);for(const patch of [{acceptPrivacy:false},{password:'short',confirmPassword:'short'},{confirmPassword:'wrong'},{email:'bad'},{name:'x'}])assert.equal((await c.request('/api/account/register',{method:'POST',data:{...data,...patch}})).status,400);assert.equal(f.store.get('SELECT count(*) n FROM users').n,0);}));
test('registration stores salted hashes, returns a user role and HttpOnly session, not a bearer token',()=>using(async f=>{const c=f.client(),r=await c.signup();assert.equal(r.status,201,r.raw);assert.equal(r.body.user.role,'user');assert.equal(r.body.user.emailVerified,false);assert.equal(r.body.token,undefined);assert.ok(r.headers['set-cookie'].some(v=>v.includes('HttpOnly')&&v.includes('SameSite=Lax')));const u=f.store.get('SELECT * FROM users');assert.notEqual(u.password,password);assert.equal(r.raw.includes(u.password),false);assert.equal((await c.init()).body.user.id,u.id);}));
test('public registration never grants admin even with forged role or owner id',()=>using(async f=>{const c=f.client();await c.init();const r=await c.request('/api/account/register',{method:'POST',data:{name:'Fake owner',email:'fake@example.test',password,confirmPassword:password,...legalAcceptance,role:'owner',id:'owner',admin:true}});assert.equal(r.status,201);assert.notEqual(r.body.user.id,'owner');for(const path of ['/api/admin/overview','/api/admin/users','/api/admin/oauth','/api/admin/settings'])assert.equal((await c.request(path)).status,401,path);assert.equal(f.store.get('SELECT count(*) n FROM owner').n,1);}));
test('guests and forged cookies cannot open studio, profile or private projects',()=>using(async f=>{const c=f.client();for(const path of ['/studio','/profile']){const r=await c.request(path);assert.equal(r.status,303);assert.equal(r.headers.location,'/?auth=login');}assert.equal((await c.request('/api/account/projects')).status,401);assert.equal((await c.request('/api/account/projects',{rawCookies:'pk-user-local='+token()})).status,401);assert.equal((await c.request('/api/account/projects',{method:'PUT',data:{project:documentOf()}})).status,401);}));
test('email login is case normalized; duplicate registration does not replace an account',()=>using(async f=>{const a=f.client(),b=f.client();assert.equal((await a.signup('One@example.test')).status,201);assert.equal((await b.signup('one@example.test')).status,409);assert.equal(f.store.get('SELECT count(*) n FROM users').n,1);const r=await b.request('/api/account/login',{method:'POST',data:{email:'ONE@example.test',password}});assert.equal(r.status,200);assert.equal(r.body.user.email,'one@example.test');}));
test('unknown email and wrong password share one error',()=>using(async f=>{const a=f.client();await a.signup();const b=f.client();await b.init();const r1=await b.request('/api/account/login',{method:'POST',data:{email:'none@example.test',password:'wrong'}}),r2=await b.request('/api/account/login',{method:'POST',data:{email:'one@example.test',password:'wrong'}});assert.equal(r1.status,401);assert.deepEqual(r1.body,r2.body);}));
test('login rate limit rejects repeated attempts',()=>using(async f=>{const c=f.client();await c.init();for(let i=0;i<12;i++)await c.request('/api/account/login',{method:'POST',data:{email:'bad@example.test',password:''}});assert.equal((await c.request('/api/account/login',{method:'POST',data:{email:'bad@example.test',password:''}})).status,429);}));
test('user profile updates require CSRF and only change own display name',()=>using(async f=>{const c=f.client(),r=await c.signup();assert.equal((await c.request('/api/account/profile',{method:'PATCH',headers:{'X-CSRF-Token':'bad'},data:{name:'Other'}})).status,403);const changed=await c.request('/api/account/profile',{method:'PATCH',data:{name:'New Name',role:'owner',email:'replace@example.test'}});assert.equal(changed.status,200);assert.equal(changed.body.user.name,'New Name');assert.equal(changed.body.user.email,r.body.user.email);assert.equal(changed.body.user.role,'user');}));
test('password change rejects the wrong current password and revokes every device',()=>using(async f=>{const a=f.client(),b=f.client();await a.signup();await b.init();await b.request('/api/account/login',{method:'POST',data:{email:'one@example.test',password}});const next='new-test-'+token();assert.equal((await a.request('/api/account/password',{method:'POST',data:{password:'wrong',newPassword:next,confirmPassword:next}})).status,403);assert.equal((await a.request('/api/account/password',{method:'POST',data:{password,newPassword:next,confirmPassword:next}})).status,200);assert.equal((await a.init()).body.user,null);assert.equal((await b.init()).body.user,null);assert.equal((await b.request('/api/account/login',{method:'POST',data:{email:'one@example.test',password:next}})).status,200);}));
test('logout and session expiry invalidate server access',()=>using(async f=>{const c=f.client();await c.signup();assert.equal((await c.request('/api/account/logout',{method:'POST',data:{}})).status,200);assert.equal((await c.init()).body.user,null);await c.request('/api/account/login',{method:'POST',data:{email:'one@example.test',password}});f.advance(86400001);assert.equal((await c.init()).body.user,null);}));
test('project documents are isolated per account, reject stale account headers, and exclude Blob/token fields',()=>using(async f=>{const a=f.client(),b=f.client();const u=(await a.signup()).body.user;await b.signup('two@example.test');const p=documentOf();p.secret='not allowed';p.clips=[{id:'clip-1',assetId:'a1',kind:'image',name:'photo',duration:5,start:0,end:5,speed:1,url:'https://private.example',apiKey:'private-key'}];assert.equal((await a.request('/api/account/projects',{method:'PUT',data:{project:p}})).status,200);const ra=await a.request('/api/account/projects');assert.equal(ra.body.projects.length,1);assert.equal(ra.body.projects[0].secret,undefined);assert.equal(ra.body.projects[0].clips[0].url,undefined);assert.equal((await b.request('/api/account/projects')).body.projects.length,0);assert.equal((await b.request('/api/account/projects/project-1',{method:'DELETE'})).status,404);assert.equal((await b.request('/api/account/projects',{method:'PUT',headers:{'X-PK-Account':u.id},data:{project:p}})).status,409);assert.equal((await a.request('/api/account/projects/project-1',{method:'DELETE'})).status,200);}));
test('owner session also works for profile and editor but user sessions never work for admin',()=>using(async f=>{const c=f.client();await c.admin();assert.equal((await c.init()).body.user.role,'owner');assert.equal((await c.request('/studio')).status,200);assert.equal((await c.request('/api/account/projects',{method:'PUT',data:{project:documentOf()}})).status,200);const users=await c.request('/api/admin/users');assert.equal(users.status,200);assert.equal(users.body.count,0);}));
test('admin has real registration stats, paginated search and no password leakage',()=>using(async f=>{const a=f.client();await a.signup();const admin=f.client();await admin.admin();const r=await admin.request('/api/admin/users?q=Test');assert.equal(r.status,200,r.raw);assert.equal(r.body.count,1);assert.equal(r.body.items[0].password,undefined);const overview=await admin.request('/api/admin/overview?days=7');assert.equal(overview.body.integrations.users,true);assert.equal(overview.body.users.total,1);assert.equal(overview.body.users.registered,1);}));
test('admin username can be edited without replacing the password; old session is revoked',()=>using(async f=>{const c=f.client();await c.admin();assert.equal((await c.request('/api/admin/password',{method:'POST',data:{password,newLogin:'newowner'}})).status,200);assert.equal((await c.request('/api/admin/session')).status,401);assert.equal((await c.request('/api/admin/login',{method:'POST',data:{login:'newowner',password}})).status,200);}));
test('OAuth settings require owner reauthentication, encrypt secrets and do not return them',()=>using(async f=>{const c=f.client();await c.admin();const secret='fake-client-secret-'+token();const data={provider:'google',clientId:'test.apps.googleusercontent.com',clientSecret:secret,enabled:true,password};assert.equal((await c.request('/api/admin/oauth',{method:'PUT',data:{...data,password:'wrong'}})).status,403);assert.equal((await c.request('/api/admin/oauth',{method:'PUT',data})).status,200);const r=await c.request('/api/admin/oauth');assert.equal(r.raw.includes(secret),false);const stored=f.store.get('SELECT secret FROM oauth_config WHERE provider=?','google');assert.notEqual(stored.secret,secret);assert.equal(f.store.unseal(stored.secret),secret);}));
test('OAuth start is disabled before configuration; Google start adds PKCE, nonce, state and a bound callback',()=>using(async f=>{const c=f.client();await c.init();assert.equal((await c.request('/api/account/oauth/google',{method:'POST',data:{}})).status,503);f.store.run('UPDATE oauth_config SET client_id=?,secret=?,enabled=1,updated=1 WHERE provider=?','client',f.store.seal('test-secret'),'google');const r=await c.request('/api/account/oauth/google',{method:'POST',data:{}});assert.equal(r.status,200);const url=new URL(r.body.url);assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('nonce'));assert.ok(url.searchParams.get('state'));assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:5173/auth/google/callback');assert.ok(!r.raw.includes('test-secret'));assert.equal(f.store.get('SELECT count(*) n FROM oauth_states').n,1);}));
test('OAuth callback rejects forged state, missing browser binding and replay without contacting provider',()=>using(async f=>{const c=f.client();await c.init();assert.equal((await c.request('/auth/google/callback?state=bad&code=bad')).headers.location,'/?auth=login&authError=provider');const state=token();f.store.run('INSERT INTO oauth_states(id,binding,provider,payload,created,expires) VALUES(?,?,?,?,?,?)',digest(state),digest('other-browser'),'google',f.store.seal('{}'),f.now(),f.now()+60000);assert.equal((await c.request('/auth/google/callback?state='+state+'&code=bad')).headers.location,'/?auth=login&authError=provider');}));
test('Meta OAuth stays disabled on HTTP and Instagram states professional account limitation',()=>using(async f=>{f.store.run('UPDATE oauth_config SET client_id=?,secret=?,version=?,enabled=1 WHERE provider=?','123',f.store.seal('test-secret'),'v23.0','instagram');const s=await f.client().init();const ig=s.body.providers.find(p=>p.id==='instagram');assert.equal(ig.ready,false);assert.equal(ig.professionalOnly,true);}));
test('public HTTPS user cookies use secure host prefix',()=>using(async f=>{const c=f.client();const r=await c.signup();assert.equal(r.status,201);assert.ok(r.headers['set-cookie'].some(s=>s.startsWith('__Host-pk-user=')&&s.includes('; Secure')));},{origin:'https://studio.example'}));
test('Google token verification rejects wrong signature, audience, nonce and expired claims',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=keys.publicKey.export({format:'jwk'});jwk.kid='test-key';const at=Date.now();let badSignature=false;let claims={iss:'https://accounts.google.com',sub:'12345',aud:'client',nonce:'nonce',iat:Math.floor(at/1000),exp:Math.floor(at/1000)+300};
 const jwt=()=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),keys.privateKey).toString('base64url');};
 const mock=async url=>new Response(JSON.stringify(String(url).includes('/certs')?{keys:[jwk]}:String(url).includes('/userinfo')?{sub:'12345',name:'Test',email:'verified@example.test',email_verified:true}:{access_token:'test',id_token:badSignature?jwt().split('.').slice(0,2).join('.')+'.'+Buffer.alloc(256).toString('base64url'):jwt()}));
 const c=createOAuthClient(mock),cfg={clientId:'client',clientSecret:'fake'};assert.equal((await c.exchange('google',cfg,'code','http://localhost/cb','verifier','nonce',at)).subject,'12345');badSignature=true;await assert.rejects(()=>c.exchange('google',cfg,'code','http://localhost/cb','verifier','nonce',at));badSignature=false;
 const original={...claims};for(const patch of [{aud:'other'},{nonce:'other'},{exp:0},{iss:'https://evil.example'}]){claims={...original,...patch};await assert.rejects(()=>c.exchange('google',cfg,'code','http://localhost/cb','verifier','nonce',at));}
});
test('Google callback creates a user, does not link by matching email, and consumes state once',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=keys.publicKey.export({format:'jwk'});jwk.kid='k';let nonce='';
 const mock=async url=>{if(String(url).includes('/certs'))return new Response(JSON.stringify({keys:[jwk]}));if(String(url).includes('/userinfo'))return new Response(JSON.stringify({sub:'google-identity',name:'Google Name',email:'one@example.test',email_verified:true}));const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'k'})).toString('base64url'),p=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',sub:'google-identity',aud:'client',nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url');const id_token=h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),keys.privateKey).toString('base64url');return new Response(JSON.stringify({access_token:'fake',id_token}));};
 await using(async f=>{const a=f.client(),b=f.client();const original=(await a.signup()).body.user.id;f.store.run('UPDATE oauth_config SET client_id=?,secret=?,enabled=1,updated=1 WHERE provider=?','client',f.store.seal('fake'),'google');await b.init();const r=await b.request('/api/account/oauth/google',{method:'POST',data:{}}),url=new URL(r.body.url);nonce=url.searchParams.get('nonce');const cb='/auth/google/callback?state='+url.searchParams.get('state')+'&code=valid';assert.equal((await b.request(cb)).headers.location,'/?signedIn=1');const user=(await b.init()).body.user;assert.notEqual(user.id,original);assert.equal(user.email,null);assert.equal(f.store.get('SELECT count(*) n FROM users').n,2);assert.equal((await b.request(cb)).headers.location,'/?auth=login&authError=provider');},{oauthFetch:mock});
});
test('all provider authorization URLs point to fixed hosts and minimal scopes',()=>{const config={clientId:'123',graphVersion:'v23.0'};for(const provider of ['google','facebook','instagram']){const u=new URL(authorizeUrl(provider,config,'https://app.example/callback','state','challenge','nonce'));assert.equal(u.protocol,'https:');assert.ok(!u.search.includes('content_publish'));} });

test('guest mode opens studio and projects while registration, OAuth and private APIs stay closed',()=>using(async f=>{
 const c=f.client(),r=await c.init();assert.equal(r.body.accountsEnabled,false);assert.equal(r.body.user,null);assert.equal(r.body.csrf,'');assert.deepEqual(r.body.providers,[]);
 for(const path of ['/','/studio','/projects','/profile','/%73tudio'])assert.equal((await c.request(path)).status,200,path);
 for(const path of ['/api/account/register','/api/account/login','/api/account/oauth/google'])assert.equal((await c.request(path,{method:'POST',data:{}})).status,404,path);
 assert.equal((await c.request('/auth/google/callback?state=fake&code=fake')).status,404);
 for(const path of ['/api/admin/settings','/api/admin/users','/api/account/projects'])assert.equal((await c.request(path)).status,401,path);
 assert.equal((await c.request('/api/account/projects',{method:'PUT',data:{project:documentOf()}})).status,401);
 assert.equal(f.store.get('SELECT count(*) n FROM users').n,0);
},{accountsEnabled:false}));

test('guest mode keeps owner login, encrypted AI settings and owner project storage operational',()=>using(async f=>{
 const c=f.client();await c.admin();const s=await c.init();assert.equal(s.body.user.role,'owner');assert.equal(s.body.accountsEnabled,false);
 const key='test-key-'+token();const saved=await c.request('/api/admin/settings',{method:'PUT',data:{provider:'openai',model:'test-model',apiKey:key,password,analyticsEnabled:true}});assert.equal(saved.status,200);
 const settings=await c.request('/api/admin/settings');assert.equal(settings.body.keyConfigured,true);assert.equal(settings.body.connected,false);assert.equal(settings.raw.includes(key),false);
 assert.equal((await c.request('/api/account/projects',{method:'PUT',data:{project:documentOf()}})).status,200);
 assert.equal((await c.request('/api/account/projects')).body.projects.length,1);
 const shell=await c.request(OWNER_PATH);assert.equal(shell.status,200);assert.match(shell.raw,/Подключение нейросети/);
},{accountsEnabled:false}));

test('email-only registration needs no display name and keeps guest editing separate from private APIs',()=>using(async f=>{
 const c=f.client(),r=await c.init();
 assert.equal(r.body.accountsEnabled,true);assert.equal(r.body.guestEditingEnabled,true);assert.equal(r.body.socialLoginEnabled,false);assert.deepEqual(r.body.providers,[]);
 for(const path of ['/studio','/projects','/%73tudio'])assert.equal((await c.request(path)).status,200,path);
 assert.equal((await c.request('/profile')).status,303);
 assert.equal((await c.request('/api/account/projects')).status,401);
 const registered=await c.request('/api/account/register',{method:'POST',data:{email:'  EDITOR@EXAMPLE.TEST  ',password,confirmPassword:password,...legalAcceptance}});
 assert.equal(registered.status,201,registered.raw);assert.equal(registered.body.user.name,'Автор');assert.equal(registered.body.user.email,'editor@example.test');assert.equal(registered.body.user.role,'user');
 assert.deepEqual(registered.body.providers,[]);assert.equal(registered.body.guestEditingEnabled,true);
 assert.equal((await c.request('/profile')).status,200);
 assert.equal((await c.request('/api/account/projects',{method:'PUT',data:{project:documentOf('email-project')}})).status,200);
 await c.request('/api/account/logout',{method:'POST',data:{}});await c.init();
 assert.equal((await c.request('/api/account/projects')).status,401);
 assert.equal((await c.request('/studio')).status,200);
 assert.equal((await c.request('/api/account/login',{method:'POST',data:{email:'editor@example.test',password}})).status,200);
 assert.equal((await c.request('/api/account/projects')).body.projects[0].id,'email-project');
},{socialLoginEnabled:false,guestEditingEnabled:true}));

test('email-only mode blocks configured third-party sign-in, callbacks and owner provider settings',()=>using(async f=>{
 f.store.run('UPDATE oauth_config SET client_id=?,secret=?,version=?,enabled=1,updated=1','configured',f.store.seal('synthetic-secret'),'v23.0');
 const guest=f.client();assert.deepEqual((await guest.init()).body.providers,[]);
 for(const provider of ['google','facebook','instagram']){
  assert.equal((await guest.request('/api/account/oauth/'+provider,{method:'POST',data:{}})).status,404);
  assert.equal((await guest.request('/auth/'+provider+'/callback?state=fake&code=fake')).status,404);
 }
 const admin=f.client();await admin.admin();const s=await admin.request('/api/admin/session');assert.equal(s.body.socialLoginEnabled,false);
 assert.equal((await admin.request('/api/admin/oauth')).status,404);
 assert.equal((await admin.request('/api/admin/oauth',{method:'PUT',data:{provider:'google',enabled:true,password}})).status,404);
 assert.equal(f.store.get('SELECT count(*) n FROM users').n,0);assert.equal(f.store.get('SELECT count(*) n FROM oauth_states').n,0);
},{socialLoginEnabled:false,guestEditingEnabled:true,oauthFetch:()=>{throw Error('Must not contact a provider');}}));

test('direct mode ignores forwarded IPs when applying authentication rate limits',()=>using(async f=>{
 const c=f.client();await c.init();
 for(let i=1;i<=12;i++)assert.equal((await c.request('/api/account/login',{method:'POST',headers:{'X-Forwarded-For':'203.0.113.'+i},data:{email:''}})).status,401);
 assert.equal((await c.request('/api/account/login',{method:'POST',headers:{'X-Forwarded-For':'198.51.100.10'},data:{email:''}})).status,429);
},{socialLoginEnabled:false,trustLoopbackProxy:false}));

test('explicit local-proxy mode separates visitors without accepting forwarded chains',()=>using(async f=>{
 const c=f.client();await c.init();const attempt=address=>c.request('/api/account/login',{method:'POST',headers:{'X-Forwarded-For':address},data:{email:''}});
 for(let i=0;i<12;i++)assert.equal((await attempt('203.0.113.10')).status,401);
 assert.equal((await attempt('203.0.113.10')).status,429);assert.equal((await attempt('203.0.113.11')).status,401);
 for(let i=0;i<12;i++)assert.equal((await attempt('203.0.113.10, 198.51.100.20')).status,401);
 assert.equal((await attempt('203.0.113.12, 198.51.100.21')).status,429);
 assert.equal((await attempt('not-an-ip')).status,429);
},{socialLoginEnabled:false,trustLoopbackProxy:true}));

test('website login gives only the real owner an admin link and a protected owner session',()=>using(async f=>{
 const c=f.client();await c.init();
 assert.equal((await c.request('/api/account/login',{method:'POST',headers:{'X-CSRF-Token':'forged'},data:{email:'owner',password}})).status,403);
 const wrong=await c.request('/api/account/login',{method:'POST',data:{email:'owner',password:'wrong'}});assert.equal(wrong.status,401);assert.equal(wrong.body.adminPath,undefined);
 const r=await c.request('/api/account/login',{method:'POST',data:{email:'owner',password}});
 assert.equal(r.status,200,r.raw);assert.equal(r.body.user.role,'owner');assert.equal(r.body.adminPath,OWNER_PATH);assert.ok(r.headers['set-cookie'].some(v=>v.startsWith('pk-owner-local=')&&v.includes('HttpOnly')&&v.includes('SameSite=Strict')));
 assert.equal((await c.init()).body.adminPath,OWNER_PATH);assert.equal((await c.request('/api/admin/overview')).status,200);
 const ordinary=f.client(),created=await ordinary.signup('normal@example.test');assert.equal(created.status,201);assert.equal(created.body.user.role,'user');assert.equal(created.body.adminPath,undefined);assert.equal((await ordinary.init()).body.adminPath,undefined);assert.equal((await ordinary.request('/api/admin/overview')).status,401);
 await c.request('/api/account/logout',{method:'POST',data:{}});assert.equal((await c.init()).body.adminPath,undefined);assert.equal((await c.request('/api/admin/overview')).status,401);
},{socialLoginEnabled:false,guestEditingEnabled:true}));

test('website owner login clears an earlier user session and expires with the owner session',()=>using(async f=>{
 const c=f.client(),initial=await c.init(),publicCsrf=initial.body.csrf;await c.signup();c.setCsrf(publicCsrf);
 const r=await c.request('/api/account/login',{method:'POST',data:{email:'owner',password}});assert.equal(r.status,200,r.raw);assert.equal(f.store.get('SELECT count(*) n FROM user_sessions').n,0);
 f.advance(30*60000+1);const expired=await c.init();assert.equal(expired.body.user,null);assert.equal(expired.body.adminPath,undefined);assert.equal((await c.request('/api/admin/users')).status,401);
},{socialLoginEnabled:false,guestEditingEnabled:true}));

test('website owner login preserves TOTP and only reveals its challenge after the correct password',()=>using(async f=>{
 const secret=newTotpSecret();f.store.run('UPDATE owner SET totp=? WHERE id=1',f.store.seal(secret));const c=f.client();await c.init();
 const wrong=await c.request('/api/account/login',{method:'POST',data:{email:'owner',password:'wrong'}});assert.equal(wrong.status,401);assert.equal(wrong.body.totpRequired,undefined);
 const challenge=await c.request('/api/account/login',{method:'POST',data:{email:'owner',password}});assert.equal(challenge.status,401);assert.equal(challenge.body.totpRequired,true);assert.equal((await c.init()).body.user,null);assert.equal((await c.request('/api/admin/users')).status,401);
 const code=totp(secret,Math.floor(f.now()/30000));assert.equal((await c.request('/api/account/login',{method:'POST',data:{email:'owner',password,code}})).body.user.role,'owner');
 const other=f.client();await other.init();assert.equal((await other.request('/api/account/login',{method:'POST',data:{email:'owner',password,code}})).status,401);
 assert.equal(f.store.unseal(f.store.get('SELECT totp FROM owner WHERE id=1').totp),secret);
},{socialLoginEnabled:false,guestEditingEnabled:true}));
