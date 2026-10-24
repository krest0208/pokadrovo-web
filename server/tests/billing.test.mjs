import {prepareLegal,legalAcceptance} from './legal-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {request as http} from 'node:http';
import {createApp} from '../app.mjs';
import {provisionOwner,token} from '../security.mjs';
import {signature,rubles} from '../billing.mjs';
import {OMNI_MODEL} from '../ai.mjs';
const origin='https://pokadrovo.test';
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'pk-billing-'));mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist/index.html'),'<!doctype html>');
 let clock=Date.now(),failure=false,calls=0;
 const options={origin,dataDir:join(dir,'private'),dist:join(dir,'dist'),accountsEnabled:true,siteAgentAutoStart:false,now:()=>clock,aiFetch:async()=>{calls++;return failure?new Response('failure',{status:502}):new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:null,summary:'Сохранить формат.',operations:[{type:'ratio',value:'9:16'}]})}}]}),{headers:{'Content-Type':'application/json'}});}};
 let app=createApp(options);prepareLegal(app);const password=token();await provisionOwner(app.store,'billing_owner',password);
 async function listen(){app.server.listen(0,'127.0.0.1');await once(app.server,'listening');}await listen();
 function client(){const jar=new Map();let csrf='',account='';const send=(path,method='GET',data,headers={})=>new Promise((resolve,reject)=>{
  const raw=typeof data==='string'?data:data===undefined?undefined:JSON.stringify(data);
  const req=http({hostname:'127.0.0.1',port:app.server.address().port,path,method,headers:{Host:'pokadrovo.test',Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,'X-PK-Account':account,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{for(const cookie of res.headers['set-cookie']||[]){const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}const raw=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(raw);}catch{value=raw;}if(value.csrf)csrf=value.csrf;if(value.user)account=value.user.id;if(path==='/api/admin/login'&&res.statusCode===200)account='owner';resolve({status:res.statusCode,data:value,raw,headers:res.headers});});});req.on('error',reject);if(raw!==undefined)req.write(raw);req.end();});return send;}
 const owner=client(),guest=client();assert.equal((await owner('/api/admin/login','POST',{login:'billing_owner',password})).status,200);
 const keys={testPassword1:token(),testPassword2:token(),password1:token(),password2:token()};
 let config={merchantLogin:'test-shop',algorithm:'sha256',...keys,enabled:false,approved:false,fiscalReady:false,legalReady:false,offerUrl:origin+'/legal/payments',termsVersion:legalAcceptance.legalVersion,tax:'none',paymentMethod:'full_prepayment',paymentObject:'service',prices:{start:'49.90',author:'199.00',studio:'499.00'}};
 async function save(values={}){config={...config,...values};return owner('/api/admin/billing','PUT',{...config,password});}
 async function user(name='one'){const send=client();await send('/api/account/session');const p=token();const r=await send('/api/account/register','POST',{email:name+'@billing.test',password:p,confirmPassword:p,...legalAcceptance});assert.equal(r.status,201,r.raw);return {send,id:r.data.user.id};}
 const callback=(id,overrides={},secret)=>{const order=app.store.get('SELECT * FROM payment_orders WHERE id=?',id);const d={OutSum:(order.amount_minor/100).toFixed(6),InvId:String(id),Shp_order:order.nonce,Shp_test:String(order.is_test),...overrides};d.SignatureValue=signature([d.OutSum,d.InvId,secret||app.store.unseal(order.secret2),'Shp_order='+d.Shp_order,'Shp_test='+d.Shp_test],order.algorithm);return new URLSearchParams(d).toString();};
 const postResult=(id,overrides={},secret)=>guest('/api/billing/robokassa/result','POST',callback(id,overrides,secret),{'Content-Type':'application/x-www-form-urlencoded',Origin:'https://auth.robokassa.ru','X-CSRF-Token':'','X-PK-Account':''});
 async function verified(){assert.equal((await save()).status,200);const o=await owner('/api/admin/billing/test-order','POST',{packageId:'start',requestId:token()});assert.equal(o.status,201,o.raw);assert.equal((await postResult(o.data.id)).data,'OK'+o.data.id);}
 async function live(){await verified();const r=await save({enabled:true,approved:true,fiscalReady:true,legalReady:true});assert.equal(r.status,200,r.raw);}
 async function order(user,pkg='start',more={}){const c=await user('/api/billing/catalog');return user('/api/billing/orders','POST',{packageId:pkg,requestId:token(),version:c.data.version,acceptedTerms:true,...more});}
 return {get app(){return app;},owner,guest,user,save,verified,live,order,postResult,callback,keys,password,time:()=>clock,advance:ms=>clock+=ms,fail:value=>failure=value,get calls(){return calls;},
  configureAi:()=>owner('/api/admin/settings','PUT',{provider:'qwen',model:OMNI_MODEL,endpoint:'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',apiKey:token(),aiEnabled:true,trialEnabled:false,analyticsEnabled:false,password}),
  restart:async()=>{await new Promise(r=>app.server.close(r));app=createApp(options);prepareLegal(app);await listen();},
  close:async()=>{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}};
}

test('money parsing uses integer kopecks, rejects float coercion and preserves six-decimal callbacks',()=>{
 assert.equal(rubles('49.900000'),4990);assert.equal(rubles('0.01'),1);
 for(const x of [49.90,'-1','0','1e3','1,20','1.000001','1000001','NaN',' 1.00','1.234'])assert.throws(()=>rubles(x));
 assert.equal(signature(['hello'],'sha256'),'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('payments default closed; owner settings require CSRF and password; secrets never leave encrypted storage',async()=>{
 const f=await fixture();try{
  assert.equal((await f.guest('/api/billing/catalog')).data.available,false);
  const u=await f.user();assert.equal((await f.order(u.send)).status,503);assert.equal((await u.send('/api/admin/billing')).status,401);
  assert.equal((await f.owner('/api/admin/billing','PUT',{}, {'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.owner('/api/admin/billing','PUT',{password:'wrong'})).status,403);
  assert.equal((await f.save()).status,200);
  const safe=await f.owner('/api/admin/billing');for(const secret of Object.values(f.keys))assert.ok(!safe.raw.includes(secret));
  const stored=f.app.store.get("SELECT value FROM meta WHERE key='robokassa_config'").value;for(const secret of Object.values(f.keys))assert.ok(!stored.includes(secret));
  assert.equal((await f.save({enabled:true,approved:true,fiscalReady:true,legalReady:true})).status,400);
 }finally{await f.close();}
});

test('test gateway form is signed with encoded receipt and separate passwords; callbacks never grant real coins',async()=>{
 const f=await fixture();try{
  await f.save();const o=await f.owner('/api/admin/billing/test-order','POST',{packageId:'start',requestId:token()});assert.equal(o.status,201);
  const row=f.app.store.get('SELECT * FROM payment_orders WHERE id=?',o.data.id),form=JSON.parse(row.form_fields);
  assert.equal(form.IsTest,'1');assert.equal(form.Shp_test,'1');assert.equal(form.OutSum,'49.90');
  assert.equal(form.SignatureValue,signature(['test-shop','49.90',String(row.id),form.Receipt,f.keys.testPassword1,'Shp_order='+row.nonce,'Shp_test=1']));
  assert.equal(JSON.parse(decodeURIComponent(form.Receipt)).items[0].sum,49.90);
  const page=await f.owner(o.data.checkoutPath);assert.equal(page.status,200);assert.match(page.raw,/https:\/\/auth.robokassa.ru\/Merchant\/Index.aspx/);assert.match(page.headers['content-security-policy'],/form-action https:\/\/auth.robokassa.ru/);
  for(const secret of Object.values(f.keys))assert.ok(!page.raw.includes(secret));
  assert.equal((await f.postResult(row.id,{},f.keys.password2)).status,403);
  assert.equal((await f.postResult(row.id)).data,'OK'+row.id);assert.equal((await f.postResult(row.id)).data,'OK'+row.id);
  assert.equal(f.app.store.get('SELECT count(*) n FROM coin_ledger').n,0);assert.equal((await f.owner('/api/admin/billing')).data.testVerified,true);
  await f.restart();assert.equal((await f.postResult(row.id)).status,200);assert.equal(f.app.store.get('SELECT count(*) n FROM coin_ledger').n,0);
 }finally{await f.close();}
});

test('test proof is invalidated by key changes and old callbacks cannot revalidate a changed configuration',async()=>{
 const f=await fixture();try{await f.save();const pending=await f.owner('/api/admin/billing/test-order','POST',{packageId:'start',requestId:token()});await f.save({testPassword1:token()});await f.postResult(pending.data.id);assert.equal((await f.owner('/api/admin/billing')).data.testVerified,false);
 }finally{await f.close();}
});

test('live orders bind approved server price, account and terms; retries are idempotent and account data stays private',async()=>{
 const f=await fixture();try{
  await f.live();const a=await f.user('a'),b=await f.user('b');const c=(await a.send('/api/billing/catalog')).data;
  const payload={packageId:'start',requestId:token(),version:c.version,acceptedTerms:true};
  for(const extra of [{amountRub:'0.01'},{coins:999999},{accountId:b.id},{isTest:true}])assert.equal((await a.send('/api/billing/orders','POST',{...payload,...extra})).status,400);
  assert.equal((await a.send('/api/billing/orders','POST',{...payload,acceptedTerms:false})).status,400);
  assert.equal((await a.send('/api/billing/orders','POST',{...payload,version:'stale'})).status,409);
  assert.equal((await a.send('/api/billing/orders','POST',payload,{'X-PK-Account':b.id})).status,409);
  assert.equal((await a.send('/api/billing/orders','POST',payload,{'X-CSRF-Token':''})).status,403);
  const o=await a.send('/api/billing/orders','POST',payload);assert.equal(o.status,201);assert.equal(o.data.priceRub,'49.90');assert.equal(o.data.coins,100);
  assert.equal((await a.send('/api/billing/orders','POST',payload)).data.id,o.data.id);
  assert.equal((await a.send('/api/billing/orders','POST',{...payload,packageId:'author'})).status,409);
  assert.equal((await b.send(o.data.checkoutPath)).status,404);assert.equal((await b.send('/api/billing/orders')).data.items.length,0);
  assert.equal((await f.guest(o.data.checkoutPath)).status,401);
  assert.equal(JSON.parse(f.app.store.get('SELECT form_fields FROM payment_orders WHERE id=?',o.data.id).form_fields).IsTest,undefined);
 }finally{await f.close();}
});

test('only exact signed ResultURL can credit, once across concurrent deliveries and restart; browser returns cannot credit',async()=>{
 const f=await fixture();try{
  await f.live();const u=await f.user(),o=(await f.order(u.send)).data;
  await f.guest('/api/billing/robokassa/success?InvId='+o.id);await f.guest('/api/billing/robokassa/fail','POST','InvId='+o.id,{'Content-Type':'application/x-www-form-urlencoded'});
  assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id),undefined);
  assert.equal((await f.postResult(o.id,{OutSum:'0.01'})).status,403);
  assert.equal((await f.postResult(o.id,{Shp_test:'1'})).status,403);
  assert.equal((await f.postResult(o.id,{Shp_order:'wrong'})).status,403);
  assert.equal((await f.postResult(o.id,{},token())).status,403);
  const body=f.callback(o.id);
  for(const suffix of ['&OutSum=49.90','&shp_order=extra','&Shp_unknown=x'])assert.equal((await f.guest('/api/billing/robokassa/result','POST',body+suffix,{'Content-Type':'application/x-www-form-urlencoded'})).status,400);
  assert.equal((await f.guest('/api/billing/robokassa/result?'+body)).status,405);
  assert.equal((await f.guest('/api/billing/robokassa/result','POST',{})).status,415);
  const rs=await Promise.all([f.postResult(o.id),f.postResult(o.id)]);for(const r of rs)assert.equal(r.data,'OK'+o.id);
  assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,100);
  await f.restart();assert.equal((await f.postResult(o.id)).status,200);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,100);
  assert.equal(f.app.store.get("SELECT count(*) n FROM coin_ledger WHERE reference=?",'payment:'+o.id).n,1);
 }finally{await f.close();}
});

test('disabling sales and rotating technical passwords do not drop a previously issued paid invoice',async()=>{
 const f=await fixture();try{await f.live();const u=await f.user(),o=(await f.order(u.send)).data;await f.save({enabled:false,password2:token()});assert.equal((await f.order(u.send)).status,503);assert.equal((await f.postResult(o.id)).status,200);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,100);
 }finally{await f.close();}
});

test('enabling real payments requires distinct keys, legal and fiscal readiness and prices',async()=>{
 const f=await fixture();try{
  await f.verified();const ready={enabled:true,approved:true,fiscalReady:true,legalReady:true};
  assert.equal((await f.save({...ready,password1:f.keys.testPassword1})).status,400);
  assert.equal((await f.save({...ready,password1:f.keys.password1,legalReady:false})).status,400);
  assert.equal((await f.save({...ready,prices:{start:'1'}})).status,400);
  assert.equal((await f.save({...ready,prices:{start:'1',author:'2',studio:'3'},offerUrl:'https://evil.test/offer'})).status,400);
 }finally{await f.close();}
});

test('recorded refunds revoke coins proportionally and idempotently, reject over-refunds and cannot be undone by duplicate payment',async()=>{
 const f=await fixture();try{
  await f.live();const u=await f.user(),o=(await f.order(u.send)).data;await f.postResult(o.id);
  const record=(amountRub,reference='refund-1',extra={})=>f.owner('/api/admin/billing/refunds','POST',{orderId:o.id,amountRub,reference,confirmed:true,password:f.password,...extra});
  assert.equal((await record('10','refund-1',{confirmed:false})).status,400);
  assert.equal((await record('10')).status,200);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,80);
  assert.equal((await record('10')).status,200);assert.equal((await record('11')).status,409);
  assert.equal((await record('49.90','refund-over')).status,400);
  assert.equal((await record('39.90','refund-2')).status,200);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,0);
  await f.postResult(o.id);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,0);
  assert.equal((await u.send('/api/billing/orders')).data.items[0].status,'refunded');
 }finally{await f.close();}
});
const aiRequest=()=>({version:1,requestId:token(),projectId:'paid-project',revision:'pk1-test',prompt:'Сохрани вертикальный формат ролика.',project:{id:'paid-project',schema:4,mode:'reels',ratio:'9:16',clips:[{id:'v1',assetId:'a1',kind:'video',name:'clip.mp4',duration:10,start:0,end:10,speed:1}],audio:[],texts:[]},cursor:0,selection:{track:'video',id:'v1'},capabilities:['ratio'],fontIds:['system']});

test('purchased coins work with the gift trial disabled, failures refund exactly once and restart releases held coins',async()=>{
 const f=await fixture();try{
  await f.live();const u=await f.user(),o=(await f.order(u.send)).data;await f.postResult(o.id);assert.equal((await f.configureAi()).status,200);
  const run=async()=>u.send('/api/ai/edit-plan','POST',{service:'reels-trial',request:aiRequest()});
  const r=await run();assert.equal(r.status,200,r.raw);assert.equal(r.data.access.kind,'paid_coins');assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,99);assert.equal(f.app.store.get('SELECT * FROM ai_trial_usage WHERE account_id=?',u.id),undefined);
  f.fail(true);assert.equal((await run()).status,502);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,99);
  const pending=token();f.app.store.run('UPDATE coin_wallets SET coins=coins-1 WHERE account_id=?',u.id);f.app.store.run("INSERT INTO coin_ledger(account_id,delta,reference,at) VALUES(?,-1,?,?)",u.id,'ai:'+pending,Date.now());
  f.app.store.run("INSERT INTO ai_runs(request_id,at,result,model,account_id,mode,access_kind,coin_charge,project_id) VALUES(?,?,'started',?,?,'reels-trial','paid_coins',1,'paid-project')",pending,Date.now(),OMNI_MODEL,u.id);
  await f.restart();assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,99);await f.restart();assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,99);
  assert.equal(f.app.store.get('SELECT count(*) n FROM coin_ledger WHERE reference=?','ai-refund:'+pending).n,1);
 }finally{await f.close();}
});

test('eligible gifts are spent before purchased coins; expiry switches to paid without extending the trial',async()=>{
 const f=await fixture();try{
  await f.live();const u=await f.user(),o=(await f.order(u.send)).data;await f.postResult(o.id);await f.configureAi();
  const now=f.time();f.app.store.run("INSERT INTO meta(key,value) VALUES('ai_trial_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'");
  f.app.store.run('INSERT INTO ai_trial_usage(account_id,project_id,started,expires,used,successes,media_analyzed) VALUES(?,?,?,?,0,1,1)',u.id,'paid-project',now,now+100000);
  const run=()=>u.send('/api/ai/edit-plan','POST',{service:'reels-trial',request:aiRequest()});
  assert.equal((await run()).data.access.kind,'free_trial');assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,100);
  f.advance(100001);const r=await run();assert.equal(r.status,200,r.raw);assert.equal(r.data.access.kind,'paid_coins');assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,99);assert.equal(f.app.store.get('SELECT used FROM ai_trial_usage WHERE account_id=?',u.id).used,1);
 }finally{await f.close();}
});

test('refund after consumption creates debt, blocks paid spending and still acknowledges old payment deliveries',async()=>{
 const f=await fixture();try{
  await f.live();const u=await f.user(),o=(await f.order(u.send)).data;await f.postResult(o.id);await f.configureAi();
  assert.equal((await u.send('/api/ai/edit-plan','POST',{request:aiRequest()})).status,200);
  assert.equal((await f.owner('/api/admin/billing/refunds','POST',{orderId:o.id,amountRub:'49.90',reference:'consumed-refund',confirmed:true,password:f.password})).status,200);
  assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,-1);
  const calls=f.calls;assert.equal((await u.send('/api/ai/edit-plan','POST',{request:aiRequest()})).status,503);assert.equal(f.calls,calls);
  await f.postResult(o.id);assert.equal(f.app.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',u.id).coins,-1);
 }finally{await f.close();}
});
