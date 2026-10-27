import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {AI_OPERATIONS,operationGuide} from '../ai-contract.mjs';
import {usingAccounts} from './account-fixture.mjs';
import {POLZA_MODEL,POLZA_ENDPOINT} from '../polza.mjs';

const bundle=await build({stdin:{contents:"export * from './src/editor/ai';export * from './src/editor/model';",resolveDir:new URL('../..',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function project(){
 const p=api.newProject();p.clips=[api.normalizeClip({id:'v1',assetId:'a1',duration:6}),api.normalizeClip({id:'v2',assetId:'a2',duration:4}),api.normalizeClip({id:'logo',assetId:'a3',kind:'image',duration:2})];
 p.audio=[api.normalizeClip({id:'music',assetId:'a4',kind:'audio',duration:12})];p.texts=[api.normalizeCaption({id:'title',text:'Title',from:0,to:3})];return p;
}
const edits=[{type:'reorder',ids:['v2','v1','logo']},{type:'layer',id:'logo',layer:1,at:2},
 {type:'fades',track:'audio',id:'music',fadeIn:.5,fadeOut:1},{type:'transform',id:'v1',patch:{visualIn:.25,visualOut:.3}},
 {type:'captionStyle',id:'title',patch:{size:.08,color:'#ffffff',background:true,align:'center',weight:700}},
 {type:'captionEdit',id:'title',text:'Новый ритм',from:0,to:2},{type:'captionStyled',text:'Запишись',from:8,to:10,fontId:'system',style:{x:.5,y:.8,size:.06,color:'#ffffff'}},
 {type:'master',value:.8},{type:'duplicate',track:'text',id:'title'}];
const reply=operations=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:null,summary:'Собрать рекламу клуба.',operations})}}],usage:{prompt_tokens:200,completion_tokens:100}}),{headers:{'Content-Type':'application/json'}});
const configure=f=>f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-contract-fixture-key',aiEnabled:true,trialEnabled:false,analyticsEnabled:false,password:f.password});
test('the editor and server advertise exactly the same commands',async()=>{
 const request=await api.createAiRequest(project(),'Мини-реклама клуба');
 assert.deepEqual([...request.capabilities].sort(),Object.keys(AI_OPERATIONS).sort());
 const guide=operationGuide(request);assert.deepEqual(Object.keys(guide).sort(),Object.keys(AI_OPERATIONS).sort());
 for(const [type,spec] of Object.entries(guide)){assert.deepEqual(spec.fields,['type',...AI_OPERATIONS[type]]);assert.ok(spec.description.length>20);}
});
test('a multi-track ad plan passes HTTP validation and the real editor evaluator atomically',()=>{
 let r,calls=0;return usingAccounts(async f=>{
  await configure(f);const original=project(),before=JSON.stringify(original);r=await api.createAiRequest(original,'Собери рекламу: порядок, логотип, звук и титры.');
  const response=await f.owner('/api/ai/edit-plan','POST',{request:r});assert.equal(response.status,200,response.raw);assert.equal(calls,1);
  const next=await api.applyAiPlan(original,r,api.validateAiPlan(response.data.plan,r));
  assert.equal(JSON.stringify(original),before);assert.deepEqual([...next.clips.filter(c=>!c.layer).map(c=>c.id)],['v2','v1']);
  assert.equal(next.clips.find(c=>c.id==='logo').layer,1);assert.equal(next.clips.find(c=>c.id==='logo').at,2);
  assert.equal(next.clips.find(c=>c.id==='v1').visualOut,.3);assert.equal(next.audio[0].fadeOut,1);assert.equal(next.master,.8);
  assert.equal(next.texts[0].text,'Новый ритм');assert.equal(next.texts[0].size,.08);assert.equal(next.texts[1].text,'Запишись');assert.equal(next.texts.length,3);
  const h=new api.History(original);h.commit(next);h.undo();assert.equal(JSON.stringify(h.value),before);
 },{aiFetch:async(_url,init)=>{calls++;const payload=JSON.parse(init.body),input=JSON.parse(payload.messages[1].content[0].text);assert.equal(input.allowedOperations.layer.fields.join(','),'type,id,layer,at');assert.equal(Object.keys(input.allowedOperations).length,18);return reply(edits);}});
});
test('commands absent from an older client stay forbidden and are not retried',()=>{
 let calls=0;return usingAccounts(async f=>{
  await configure(f);const r=await api.createAiRequest(project(),'Оформи титры');r.capabilities=['ratio'];
  const result=await f.owner('/api/ai/edit-plan','POST',{request:r});assert.equal(result.status,502);assert.match(result.data.error,/captionStyle/);assert.equal(calls,1);assert.equal(f.store.get('SELECT result FROM ai_runs').result,'failed');
 },{aiFetch:async()=>{calls++;return reply([{type:'captionStyle',id:'title',patch:{size:.08}}]);}});
});
test('new commands reject malformed targets, ranges and style injection without changing the project',async()=>{
 const p=project(),before=JSON.stringify(p),r=await api.createAiRequest(p,'Оформи ролик');
 const invalid=[{type:'reorder',ids:['v1','v1','logo']},{type:'layer',id:'logo',layer:1.5,at:0},{type:'layer',id:'logo',layer:9,at:0},
  {type:'fades',track:'audio',id:'music',fadeIn:20,fadeOut:0},{type:'captionStyle',id:'title',patch:{color:'url(https://invalid.test)'}},
  {type:'captionStyle',id:'v1',patch:{size:.05}},{type:'captionEdit',id:'title',text:'Test',from:5,to:2},{type:'master',value:2},
  {type:'transform',id:'v1',patch:{visualIn:6}}];
 for(const op of invalid){assert.throws(()=>api.validateAiPlan({version:1,requestId:r.requestId,projectId:r.projectId,revision:r.revision,summary:'Test',operations:[{type:'master',value:.5},op]},r));assert.equal(JSON.stringify(p),before);}
});
