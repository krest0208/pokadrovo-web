import test from 'node:test';
import assert from 'node:assert/strict';
import {usingAccounts} from './account-fixture.mjs';
import {token} from '../security.mjs';
import {AI_LIMITS,OMNI_MODEL} from '../ai.mjs';

const request=(seconds=10)=>({version:1,requestId:token(),projectId:'wide-story',revision:'pk1-test',prompt:'Сохрани историю в горизонтальном формате.',project:{id:'wide-story',schema:4,mode:'video',ratio:'16:9',clips:[{id:'v1',assetId:'a1',kind:'video',name:'fixture.mp4',duration:seconds,start:0,end:seconds,speed:1}],audio:[],texts:[]},cursor:0,selection:null,capabilities:['ratio'],fontIds:['system']});

test('production defaults expose only Qwen and deny archived services before any provider call',()=>usingAccounts(async f=>{
 const status=await f.guest('/api/ai/status');assert.equal(status.status,200);assert.deepEqual(status.data.modes.map(m=>m.id),['reels-trial']);
 for(const service of ['source-analysis','deepseek-edit','yandex-edit']){
  assert.equal((await f.guest('/api/ai/status?service='+service)).status,404);
  assert.equal((await f.owner('/api/ai/edit-plan','POST',{service,request:request()})).status,404);
 }
 assert.equal(f.store.get('SELECT count(*) n FROM ai_runs').n,0);
},{aiFetch(){throw Error('An archived service must not contact any provider');}}));

test('sales stay off with no public packages even if old enabled billing settings remain',()=>usingAccounts(async f=>{
 f.store.run("INSERT INTO meta(key,value) VALUES('robokassa_config',?)",JSON.stringify({enabled:true,approved:true,testVerified:true,fiscalReady:true,legalReady:true,prices:{start:100,author:500,studio:1500}}));
 const catalog=await f.guest('/api/billing/catalog');assert.equal(catalog.status,200);assert.equal(catalog.data.available,false);assert.deepEqual(catalog.data.packages,[]);
 const a=await f.signup();assert.equal((await a.send('/api/billing/orders','POST',{packageId:'start',requestId:token(),acceptedTerms:true})).status,503);
 assert.equal(f.store.get('SELECT count(*) n FROM payment_orders').n,0);
}));

test('one Qwen request handles 16:9 plans with bounded duration and no thinking or automatic retries',async()=>{
 const calls=[];
 await usingAccounts(async f=>{
  assert.equal((await f.owner('/api/admin/settings','PUT',{provider:'qwen',model:OMNI_MODEL,endpoint:'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',apiKey:'synthetic-qwen-fixture-key',aiEnabled:true,trialEnabled:false,analyticsEnabled:false,password:f.password})).status,200);
  const result=await f.owner('/api/ai/edit-plan','POST',{service:'reels-trial',request:request()});assert.equal(result.status,200,result.raw);assert.equal(result.data.plan.operations[0].value,'16:9');
  assert.equal(calls.length,1);const [url,init]=calls[0],payload=JSON.parse(init.body);
  assert.match(url,/^https:\/\/test-workspace\.ap-southeast-1\.maas\.aliyuncs\.com\/compatible-mode\/v1\/chat\/completions$/);
  assert.equal(payload.model,OMNI_MODEL);assert.equal(payload.reasoning_effort,'none');assert.equal(init.redirect,'error');assert.match(payload.messages[0].content,/16:9/);
  assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:request(61)})).status,422);assert.equal(calls.length,1);
 },{aiFetch:async(...args)=>{calls.push(args);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:null,summary:'Сохранить формат.',operations:[{type:'ratio',value:'16:9'}]})}}],usage:{prompt_tokens:100,completion_tokens:50}}),{headers:{'Content-Type':'application/json'}});}});
});

test('inline media cap leaves the base64 payload below the vendor 10 MB limit',()=>{
 assert.ok(Math.ceil(AI_LIMITS.maxBytes/3)*4+64<10_000_000);
});
