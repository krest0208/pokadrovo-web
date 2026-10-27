import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelMessage,editingResponseFormat} from '../ai-response.mjs';
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
test('response schema follows client capabilities and distinguishes media from text requests',()=>{
 const request={capabilities:['ratio','transform'],fontIds:['system']},format=editingResponseFormat(request,false);
 assert.equal(format.type,'json_schema');assert.equal(format.json_schema.strict,true);
 assert.equal(format.json_schema.schema.properties.analysis.type,'null');
 const variants=format.json_schema.schema.properties.operations.items.anyOf;
 assert.deepEqual(variants.map(v=>v.properties.type.enum[0]),['ratio','transform']);
 assert.equal(variants[0].additionalProperties,false);assert.deepEqual(variants[1].properties.patch.properties.zoom.type,['number','null']);
 assert.equal(editingResponseFormat(request,true).json_schema.schema.properties.analysis.type,'object');
});

const job=()=>({version:1,requestId:token(),projectId:'json-fixture',revision:'pk1-test',prompt:'Сохрани формат.',project:{id:'json-fixture',schema:4,mode:'video',ratio:'16:9',clips:[{id:'v1',assetId:'a1',kind:'video',name:'fixture.mp4',duration:2,start:0,end:2,speed:1}],audio:[],texts:[]},cursor:0,selection:null,capabilities:['ratio','transform'],fontIds:['system']});
const media=()=>{const bytes=Buffer.alloc(44+16000*2*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return {clipId:'v1',assetId:'a1',mime:PREPARED_MEDIA,data:bytes.toString('base64'),frames:[{at:0,data:Buffer.from([255,216,255,217]).toString('base64')}]};};
test('HTTP accepts formatted complete plans, rejects incomplete ones once, retains usage and refunds failed trial requests',()=>{
 const calls=[];
 const transform={...plan,operations:[{type:'transform',id:'v1',patch:{...Object.fromEntries(TRANSFORM_FIELDS.map(k=>[k,null])),zoom:1.2}}]};
 const answers=[choice('```json\n'+JSON.stringify(plan)+'\n```'),choice(JSON.stringify(transform)),choice(JSON.stringify(plan),'length'),choice('{"analysis":null'),choice('{"analysis":')];
 return usingAccounts(async f=>{
  await f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-format-fixture-key',aiEnabled:true,trialEnabled:true,analyticsEnabled:false,password:f.password});
  const first=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(first.status,200,first.raw);assert.equal(first.data.plan.operations[0].value,'16:9');
  const second=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(second.status,200,second.raw);assert.deepEqual(second.data.plan.operations[0].patch,{zoom:1.2});
  const third=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(third.status,502);assert.match(third.data.error,/лимита длины/);
  const fourth=await f.owner('/api/ai/edit-plan','POST',{request:job()});assert.equal(fourth.status,502);assert.match(fourth.data.error,/повреждённый/);
  const a=await f.signup();const fifth=await a.send('/api/ai/edit-plan','POST',{request:job(),media:media(),mediaConsent:true});assert.equal(fifth.status,502,fifth.raw);
  assert.equal(calls.length,5);assert.equal(f.store.get('SELECT count(*) n FROM ai_trial_usage WHERE account_id=?',a.id).n,0);
  const run=f.store.get('SELECT result,coin_charge,input_tokens,output_tokens FROM ai_runs WHERE account_id=?',a.id);assert.equal(run.result,'failed');assert.equal(run.coin_charge,0);assert.equal(run.input_tokens,100);assert.equal(run.output_tokens,4096);
  assert.equal(calls[0].response_format.type,'json_schema');assert.equal(calls[0].max_tokens,4096);assert.equal(calls[0].provider.allow_fallbacks,false);assert.equal(calls[0].reasoning.effort,'none');
  assert.equal(calls[4].response_format.json_schema.schema.properties.analysis.type,'object');
 },{aiFetch:async(_url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[answers[calls.length-1]],usage:{prompt_tokens:100,completion_tokens:4096}}),{headers:{'Content-Type':'application/json'}});}});
});
