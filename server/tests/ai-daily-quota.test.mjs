import test from 'node:test';
import assert from 'node:assert/strict';
import {usingAccounts} from './account-fixture.mjs';
import {token} from '../security.mjs';
import {POLZA_MODEL,POLZA_ENDPOINT} from '../polza.mjs';
import {AI_LIMITS} from '../ai.mjs';

const job=()=>({version:1,requestId:token(),projectId:'quota-project',revision:'pk1-quota',prompt:'Сохрани формат.',project:{id:'quota-project',mode:'video',ratio:'16:9',clips:[{id:'v1',assetId:'a1',kind:'video',name:'fixture.mp4',duration:2,start:0,end:2,speed:1}],audio:[],texts:[]},cursor:0,selection:null,capabilities:['ratio'],fontIds:['system']});
const configure=f=>f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-quota-key',aiEnabled:true,trialEnabled:true,analyticsEnabled:false,password:f.password});
const reply=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:null,summary:'Формат сохранён.',operations:[{type:'ratio',value:'16:9'}]})}}]}),{headers:{'Content-Type':'application/json'}});
function seed(f,account,count){for(let i=0;i<count;i++)f.store.run('INSERT INTO ai_runs(request_id,at,result,model,provider,task,account_id,mode) VALUES(?,?,?,?,?,?,?,?)',token(),f.now(),'failed',POLZA_MODEL,'polza','edit',account,'reels-trial');}

test('existing failed owner attempts remain counted without taking the users daily quota',()=>{
 let calls=0;return usingAccounts(async f=>{
  await configure(f);const a=await f.signup();seed(f,'owner',12);
  f.store.run('INSERT INTO rates(id,attempts,reset) VALUES(?,?,?)','ai-pilot:'+new Date(f.now()).toISOString().slice(0,10),12,f.now()+86400000);
  let owner=(await f.owner('/api/ai/status')).data,customer=(await a.send('/api/ai/status')).data;
  assert.equal(owner.dailyQuota.used,12);assert.equal(owner.dailyQuota.limit,60);assert.equal(owner.available,true);
  assert.equal(customer.dailyQuota.used,0);assert.equal(customer.dailyQuota.limit,12);assert.equal(customer.available,true);
  const response=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(response.status,200,response.raw);assert.equal(calls,1);
  owner=(await f.owner('/api/ai/status')).data;customer=(await a.send('/api/ai/status')).data;
  assert.equal(owner.dailyQuota.used,13);assert.equal(customer.dailyQuota.used,0);
  const metrics=(await f.owner('/api/admin/ai/analytics?days=7')).data;
  assert.equal(metrics.dailyQuota.owner.used,13);assert.equal(metrics.dailyQuota.users.used,0);
  // The public status only exposes the current authenticated role's quota.
  assert.equal(customer.dailyQuota.scope,'users');assert.equal(owner.dailyQuota.scope,'owner');
 },{aiFetch:async()=>{calls++;return reply();}});
});

test('an exhausted user quota blocks before sending, rolls back trial reservation and cannot be promoted by body fields',()=>usingAccounts(async f=>{
 await configure(f);const a=await f.signup();seed(f,a.id,12);
 f.store.run('INSERT INTO ai_trial_usage(account_id,project_id,started,expires,used,successes,media_analyzed) VALUES(?,?,?,?,?,?,?)',a.id,'quota-project',f.now(),f.now()+86400000,1,1,1);
 const state=(await a.send('/api/ai/status')).data;assert.equal(state.available,false);assert.equal(state.dailyQuota.remaining,0);assert.match(state.reason,/пользователей/);
 const response=await a.send('/api/ai/edit-plan','POST',{request:job(),owner:true,role:'owner',dailyLimit:1000000});assert.equal(response.status,429,response.raw);
 assert.equal(f.store.get('SELECT used FROM ai_trial_usage WHERE account_id=?',a.id).used,1);assert.equal(f.store.get('SELECT count(*) n FROM ai_runs').n,12);
 assert.equal((await f.owner('/api/ai/status')).data.available,true);
},{aiFetch(){throw Error('Quota rejection must never call provider');}}));

test('owner cap is enforced and durable attempts reset only at the UTC day boundary',()=>usingAccounts(async f=>{
 await configure(f);seed(f,'owner',AI_LIMITS.ownerDailyRequests);
 const state=(await f.owner('/api/ai/status')).data;assert.equal(state.dailyQuota.used,60);assert.equal(state.dailyQuota.remaining,0);assert.equal(state.available,false);assert.match(state.reason,/администратора/);
 const response=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(response.status,429);assert.equal(f.store.get('SELECT count(*) n FROM ai_runs').n,60);
 f.advance(state.dailyQuota.resetsAt-f.now()+1);
 assert.equal((await f.owner('/api/admin/login','POST',{login:'test_owner',password:f.password})).status,200);
 const next=(await f.owner('/api/ai/status')).data;assert.equal(next.dailyQuota.used,0);assert.equal(next.dailyQuota.remaining,60);assert.equal(next.available,true);assert.equal(f.store.get('SELECT count(*) n FROM ai_runs').n,60);
},{aiFetch(){throw Error('An exhausted cap must not call provider');}}));
