import test from 'node:test';
import assert from 'node:assert/strict';
import {usingAccounts} from './account-fixture.mjs';
import {POLZA_MODEL,POLZA_ENDPOINT,PREPARED_MEDIA} from '../polza.mjs';
import {validateAiPlan,normalizeProject} from '../../shared/editor-ai-runtime.mjs';
import {generateAiRuntime} from '../../tools/generate-ai-runtime.mjs';
import {token} from '../security.mjs';

const configure=f=>f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-validation-key',aiEnabled:true,trialEnabled:true,analyticsEnabled:false,password:f.password});
const job=()=>({version:1,requestId:token(),projectId:'validation',revision:'pk1-test',prompt:'Сделай монтаж.',project:normalizeProject({id:'validation',schema:4,ratio:'16:9',clips:[{id:'v1',assetId:'a1',duration:20}],audio:[],texts:[]}),cursor:0,capabilities:['speed','trim','split','volume','layer','fades','caption','transform','cutRange','remove','ratio'],fontIds:['system']});
const answer=operations=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:null,summary:'Тест проверки.',operations})}}],usage:{prompt_tokens:123,completion_tokens:45}}),{headers:{'Content-Type':'application/json'}});

test('the shipped server evaluator is generated from the current real editor, without runtime dependencies',()=>generateAiRuntime({check:true}));

test('HTTP refuses numeric, timing, sequential-target and final-duration failures before marking an edit successful',()=>{
 const invalid=[
  [{type:'speed',track:'video',id:'v1',value:0}],
  [{type:'trim',track:'video',id:'v1',start:0,end:21}],
  [{type:'split',track:'video',id:'v1',offset:20}],
  [{type:'volume',track:'video',id:'v1',value:.4,muted:'false'}],
  [{type:'layer',id:'v1',layer:1.5,at:0}],
  [{type:'fades',track:'video',id:'v1',fadeIn:25,fadeOut:0}],
  [{type:'caption',text:'Текст',from:5,to:2,fontId:'system'}],
  [{type:'transform',id:'v1',patch:{cropLeft:.8,cropRight:.8}}],
  [{type:'cutRange',from:19,to:21}],
  [{type:'remove',track:'video',id:'v1'},{type:'speed',track:'video',id:'v1',value:1.5}],
  [{type:'speed',track:'video',id:'v1',value:.25}]
 ];let calls=0;
 return usingAccounts(async f=>{
  await configure(f);
  for(const operations of invalid){const r=job();const result=await f.owner('/api/ai/edit-plan','POST',{request:r});assert.equal(result.status,502,JSON.stringify({operations,response:result.data}));}
  assert.equal(calls,invalid.length);assert.equal(f.store.get("SELECT count(*) n FROM ai_runs WHERE result='ok'").n,0);
  assert.equal(f.store.get("SELECT count(*) n FROM ai_runs WHERE result='failed' AND input_tokens=123 AND output_tokens=45 AND coin_charge=0").n,invalid.length);
 },{aiFetch:async()=>answer(invalid[calls++])});
});

test('server result can be applied with the same evaluator and overlapping ripple cuts are evaluated in order',()=>usingAccounts(async f=>{
 await configure(f);const r=job(),before=JSON.stringify(r.project);
 const result=await f.owner('/api/ai/edit-plan','POST',{request:r});assert.equal(result.status,200,result.raw);
 assert.equal(validateAiPlan(result.data.plan,r).operations.length,3);assert.equal(JSON.stringify(r.project),before);
},{aiFetch:async()=>answer([{type:'cutRange',from:14,to:16},{type:'cutRange',from:3,to:5},{type:'caption',text:'Готово',from:0,to:2,fontId:'system'}])}));

test('reordering after removing a clip validates the remaining timeline rather than the original snapshot',()=>usingAccounts(async f=>{
 await configure(f);const r=job();r.capabilities.push('reorder');r.project.clips.push({...r.project.clips[0],id:'v2',assetId:'a2'});
 const result=await f.owner('/api/ai/edit-plan','POST',{request:r});assert.equal(result.status,200,result.raw);assert.equal(validateAiPlan(result.data.plan,r).operations.length,2);
},{aiFetch:async()=>answer([{type:'remove',track:'video',id:'v2'},{type:'reorder',ids:['v1']}])}));

test('an unusable follow-up does not consume a customer trial action but retains provider token accounting',()=>{
 let calls=0;return usingAccounts(async f=>{
  await configure(f);const user=await f.signup();
  const wav=Buffer.alloc(44+20*32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const media={clipId:'v1',assetId:'a1',mime:PREPARED_MEDIA,data:wav.toString('base64'),frames:[{at:0,data:Buffer.from([255,216,255,217]).toString('base64')}]};
  assert.equal((await user.send('/api/ai/edit-plan','POST',{request:job(),media,mediaConsent:true})).status,200);
  const follow=job(),result=await user.send('/api/ai/edit-plan','POST',{request:follow});assert.equal(result.status,502,result.raw);
  const trial=f.store.get('SELECT used,successes FROM ai_trial_usage WHERE account_id=?',user.id);assert.equal(trial.used,1);assert.equal(trial.successes,1);
  const run=f.store.get('SELECT result,coin_charge,input_tokens FROM ai_runs WHERE request_id=?',follow.requestId);assert.equal(run.result,'failed');assert.equal(run.coin_charge,0);assert.equal(run.input_tokens,123);assert.equal(calls,2);
 },{aiFetch:async()=>{calls++;if(calls>1)return answer([{type:'speed',track:'video',id:'v1',value:0}]);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:{summary:'Контрольный файл',speech:'',audio:'',events:[],limitations:[]},summary:'Разбор готов.',operations:[]})}}]}),{headers:{'Content-Type':'application/json'}});}});
});
