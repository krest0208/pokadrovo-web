import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelMessage,editingResponseFormat,modelDefaults,editingOutputGuide} from '../ai-response.mjs';
import {TRANSFORM_FIELDS} from '../ai-contract.mjs';
import {POLZA_MODEL,POLZA_ENDPOINT,PREPARED_MEDIA} from '../polza.mjs';
import {usingAccounts} from './account-fixture.mjs';
import {token} from '../security.mjs';

const plan={analysis:null,summary:'Сохранить формат.',operations:[{type:'ratio',value:'16:9'}]};
const choice=(content,finish_reason='stop')=>({finish_reason,message:{content}});
test('intact plain, BOM and single fenced JSON responses are readable without another call',()=>{
 const json=JSON.stringify(plan);
 for(const content of [json,'\ufeff  '+json+'\n','```json\n'+json+'\n```','```\r\n'+json+'\r\n```'])assert.deepEqual(parseModelMessage(choice(content)),plan);
});
test('truncated, multiple, prose-wrapped and non-object responses are never repaired into edits',()=>{
 for(const content of ['{"summary":"unfinished',JSON.stringify(plan).slice(0,-1),'prefix '+JSON.stringify(plan),JSON.stringify(plan)+'\n{}','null','[]','```json\n{}\n```\n```json\n{}\n```'])assert.throws(()=>parseModelMessage(choice(content)));
 assert.throws(()=>parseModelMessage(choice(JSON.stringify(plan),'length')),/лимита длины/);
 assert.throws(()=>parseModelMessage(choice(JSON.stringify(plan),'content_filter')),/не завершила/);
});
test('structured patch nulls omit only known properties and never hide unknown fields',()=>{
 const patch=Object.fromEntries(TRANSFORM_FIELDS.map(key=>[key,null]));patch.zoom=1.2;patch.injected=null;
 const value=parseModelMessage(choice(JSON.stringify({...plan,operations:[{type:'transform',id:'v1',patch}]})),true);
 assert.deepEqual(value.operations[0].patch,{zoom:1.2,injected:null});
});
test('active provider uses compatible JSON mode without a rejected strict schema',()=>{
 assert.deepEqual(editingResponseFormat(),{type:'json_object'});
});
test('wire arguments decode to the existing editor protocol and cannot inject or override a command',()=>{
 const response=ops=>choice(JSON.stringify({...plan,operations:ops}));
 assert.deepEqual(parseModelMessage(response([{action:'speed',parameters:JSON.stringify({track:'video',id:'v1',value:1.5})}]),true).operations,[{type:'speed',track:'video',id:'v1',value:1.5}]);
 for(const parameters of ['{','[]','null','{"type":"remove"}','{"__proto__":{}}','{"injected":null}'])assert.throws(()=>parseModelMessage(response([{action:'ratio',parameters}]),true));
 assert.throws(()=>parseModelMessage(response([{action:'shell',parameters:'{}'}]),true));
});
test('native instructions use real IDs and one editor protocol without nested argument strings',()=>{
 const r=job(),guide=editingOutputGuide(r);assert.match(guide,/БЕЗ action, parameters/);assert.match(guide,/"id":"v1"/);assert.match(guide,/"visualIn":0.2/);
 assert.ok(!guide.includes('example_clip_id'));assert.match(guide,/не задание/);
});
test('omitted flags preserve existing clip state; unknown fields and numeric edits are never invented',()=>{
 const r=job();r.project.clips[0].muted=true;
 const value=modelDefaults({analysis:null,summary:'Громкость',operations:[{type:'volume',id:'v1',value:.4},{type:'speed',id:'v1',value:1.25},{type:'trim',id:'absent',extra:1}]},r);
 assert.deepEqual(value.operations[0],{type:'volume',id:'v1',track:'video',value:.4,muted:true});
 assert.deepEqual(value.operations[1],{type:'speed',id:'v1',track:'video',value:1.25});
 assert.deepEqual(value.operations[2],{type:'trim',id:'absent',extra:1});
 const explicit=modelDefaults({operations:[{type:'volume',track:'video',id:'v1',value:.4,muted:false},{type:'speed',track:'wrong',id:'v1',value:1.25}]},r);assert.equal(explicit.operations[0].muted,false);assert.equal(explicit.operations[1].track,'wrong');
 r.project.audio=[{id:'v1'}];assert.equal(modelDefaults({operations:[{type:'speed',id:'v1',value:1.25}]},r).operations[0].track,undefined);
});
test('omitted analysis details remain unknown and never become invented speech or timestamps',()=>{
 const value=modelDefaults({analysis:{summary:'Надпись на синем фоне',events:[{from:0,to:1,visual:'Надпись'}]},operations:[{type:'caption',text:'Тест',from:0,to:1}]},job());
 assert.deepEqual(value.analysis,{summary:'Надпись на синем фоне',speech:'',audio:'',events:[{from:0,to:1,visual:'Надпись',audio:'',speech:''}],limitations:[]});
 assert.equal(value.operations[0].fontId,'system');
 const invalid=modelDefaults({analysis:{speech:123,events:[{visual:'Кадр'}]},operations:[]},job());assert.equal(invalid.analysis.summary,undefined);assert.equal(invalid.analysis.speech,123);assert.equal(invalid.analysis.events[0].from,undefined);
});

const job=()=>({version:1,requestId:token(),projectId:'json-fixture',revision:'pk1-test',prompt:'Сохрани формат.',project:{id:'json-fixture',schema:4,mode:'video',ratio:'16:9',clips:[{id:'v1',assetId:'a1',kind:'video',name:'fixture.mp4',duration:2,start:0,end:2,speed:1}],audio:[],texts:[]},cursor:0,selection:null,capabilities:['ratio','transform'],fontIds:['system']});
const media=()=>{const bytes=Buffer.alloc(44+16000*2*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return {clipId:'v1',assetId:'a1',mime:PREPARED_MEDIA,data:bytes.toString('base64'),frames:[{at:0,data:Buffer.from([255,216,255,217]).toString('base64')}]};};
test('HTTP accepts formatted complete plans, rejects incomplete ones once, retains usage and refunds failed trial requests',()=>{
 const calls=[];
 const transform={...plan,operations:[{type:'transform',id:'v1',patch:{...Object.fromEntries(TRANSFORM_FIELDS.map(k=>[k,null])),zoom:1.2}}]};
 const wirePlan={...plan,analysis:{summary:'',speech:'',audio:'',events:[],limitations:[]},operations:[{action:'ratio',parameters:'{"value":"16:9"}'}]};
 const answers=[choice('```json\n'+JSON.stringify(wirePlan)+'\n```'),choice(JSON.stringify(transform)),choice(JSON.stringify(plan),'length'),choice('{"analysis":null'),choice('{"analysis":')];
 return usingAccounts(async f=>{
  await f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-format-fixture-key',aiEnabled:true,trialEnabled:true,analyticsEnabled:false,password:f.password});
  const first=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(first.status,200,first.raw);assert.equal(first.data.plan.operations[0].value,'16:9');
  const second=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(second.status,200,second.raw);assert.deepEqual(second.data.plan.operations[0].patch,{zoom:1.2});
  const third=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(third.status,502);assert.match(third.data.error,/лимита длины/);
  const fourth=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(fourth.status,502);assert.match(fourth.data.error,/повреждённый/);
  const a=await f.signup();const fifth=await a.send('/api/ai/edit-plan','POST',{request:job(),media:media(),mediaConsent:true});assert.equal(fifth.status,502,fifth.raw);
  assert.equal(calls.length,5);assert.equal(f.store.get('SELECT count(*) n FROM ai_trial_usage WHERE account_id=?',a.id).n,0);
  const run=f.store.get('SELECT result,coin_charge,input_tokens,output_tokens FROM ai_runs WHERE account_id=?',a.id);assert.equal(run.result,'failed');assert.equal(run.coin_charge,0);assert.equal(run.input_tokens,100);assert.equal(run.output_tokens,4096);
  assert.deepEqual(calls[0].response_format,{type:'json_object'});assert.equal(calls[0].max_tokens,4096);assert.equal(calls[0].provider.allow_fallbacks,false);assert.equal(calls[0].reasoning.effort,'none');
  assert.deepEqual(calls[4].response_format,{type:'json_object'});
 },{aiFetch:async(_url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[answers[calls.length-1]],usage:{prompt_tokens:100,completion_tokens:4096}}),{headers:{'Content-Type':'application/json'}});}});
});
