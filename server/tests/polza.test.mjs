import test from 'node:test';
import assert from 'node:assert/strict';
import {usingAccounts} from './account-fixture.mjs';
import {token} from '../security.mjs';
import {validateAiMedia,OMNI_MODEL} from '../ai.mjs';
import {POLZA_ENDPOINT,POLZA_MODEL,PREPARED_MEDIA,validatePolzaEndpoint} from '../polza.mjs';

const job=()=>({version:1,requestId:token(),projectId:'sample-project',revision:'pk1-samples',prompt:'Предложи монтаж и сохрани смысл речи.',project:{id:'sample-project',schema:4,mode:'video',ratio:'16:9',clips:[{id:'v1',assetId:'a1',kind:'video',name:'fixture.mp4',duration:10,start:0,end:10,speed:1}],audio:[],texts:[]},cursor:0,selection:null,capabilities:['ratio'],fontIds:['system']});
function wav(){const b=Buffer.alloc(44+16000*10*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b.toString('base64');}
const samples=()=>({clipId:'v1',assetId:'a1',mime:PREPARED_MEDIA,data:wav(),frames:[{at:0,data:Buffer.from([255,216,255,217]).toString('base64')},{at:5,data:Buffer.from([255,216,255,217]).toString('base64')}]});
const configure=f=>f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-polza-fixture-key',aiEnabled:true,trialEnabled:true,analyticsEnabled:false,password:f.password});
const result=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({analysis:{summary:'Короткая история.',speech:'Тестовая речь.',audio:'Голос.',events:[{from:0,to:5,visual:'Первый кадр.',speech:'Речь.',audio:'Голос.'}],limitations:[]},summary:'Сохранить формат.',operations:[{type:'ratio',value:'16:9'}]})}}],usage:{prompt_tokens:100,completion_tokens:60,cost:3.5}}),{headers:{'Content-Type':'application/json'}});
test('Polza endpoint is fixed to HTTPS and rejects arbitrary hosts, ports and redirects',()=>{
 assert.equal(validatePolzaEndpoint(POLZA_ENDPOINT+'/'),POLZA_ENDPOINT);
 for(const url of ['http://polza.ai/api/v1','https://polza.ai.evil.test/api/v1','https://user:pass@polza.ai/api/v1','https://polza.ai:444/api/v1','https://polza.ai/api/v1?x=1','https://127.0.0.1/api/v1'])assert.throws(()=>validatePolzaEndpoint(url));
});
test('prepared media validates actual WAV duration, ordered JPEG samples and strict frame caps',()=>{
 const r=job(),media=samples();assert.equal(validateAiMedia(media,r,true).duration,10);assert.throws(()=>validateAiMedia(media,r));
 for(const frames of [[{at:10,data:media.frames[0].data}],[{at:0,data:'eHh4eA=='}],[...media.frames].reverse(),Array.from({length:13},(_,i)=>({at:i/2,data:media.frames[0].data}))])assert.throws(()=>validateAiMedia({...media,frames},r,true));
});
test('Polza uses one authenticated call with raw audio and timestamped images; provider costs never become USD',()=>usingAccounts(async f=>{
 assert.equal((await configure(f)).status,200);const a=await f.signup();
 const status=await a.send('/api/ai/status');assert.equal(status.data.mediaTransport,'frames-audio');assert.equal(status.data.modes[0].label,'Смонтировать с ИИ');assert.equal(status.data.model,undefined);
 const response=await a.send('/api/ai/edit-plan','POST',{request:job(),media:samples(),mediaConsent:true});assert.equal(response.status,200);assert.match(response.data.analysis.limitations[0],/12/);
 const run=f.store.get('SELECT * FROM ai_runs');assert.equal(run.provider,'polza');assert.equal(run.model,POLZA_MODEL);assert.equal(run.input_tokens,100);assert.equal(run.provider_cost_usd,null);
 assert.equal(f.store.get('SELECT media_analyzed FROM ai_trial_usage WHERE account_id=?',a.id).media_analyzed,1);
},{aiFetch:async(url,init)=>{
 assert.equal(url,POLZA_ENDPOINT+'/chat/completions');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer synthetic-polza-fixture-key');const payload=JSON.parse(init.body);assert.equal(payload.model,POLZA_MODEL);assert.equal(payload.provider.allow_fallbacks,false);
 const parts=payload.messages[1].content;assert.equal(parts.filter(p=>p.type==='image_url').length,2);assert.equal(parts.some(p=>p.type==='video_url'),false);assert.equal(parts.find(p=>p.type==='input_audio').input_audio.data,wav());return result();
}}));
test('missing consent, direct MP4 and invalid samples never contact the provider',()=>usingAccounts(async f=>{
 await configure(f);assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:job(),media:samples()})).status,400);
 const bad=samples();bad.frames[0].at=-1;assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:job(),media:bad,mediaConsent:true})).status,400);
 assert.equal(f.store.get('SELECT count(*) n FROM ai_runs').n,0);
},{aiFetch(){throw Error('Invalid input must not be transmitted');}}));
test('old credentials are retained but cannot make calls in production, and switching requires a new key',()=>usingAccounts(async f=>{
 f.store.run('UPDATE settings SET provider=?,model=?,secret=?,updated=? WHERE id=1','qwen',OMNI_MODEL,f.store.seal('synthetic-old-vendor-key'),Date.now());
 f.store.run("INSERT INTO meta(key,value) VALUES('ai_enabled','1'),('ai_endpoint','https://dashscope-intl.aliyuncs.com/compatible-mode/v1')");
 const status=await f.owner('/api/ai/status');assert.equal(status.data.available,false);
 assert.equal((await f.owner('/api/ai/edit-plan','POST',{request:job()})).status,503);
 assert.equal((await f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,aiEnabled:true,analyticsEnabled:false,password:f.password})).status,400);
 assert.equal(f.store.unseal(f.store.get('SELECT secret FROM settings').secret),'synthetic-old-vendor-key');
},{aiFetch(){throw Error('Old credentials must not call any provider');}}));
test('empty upstream balance is not retried, and held user trial requests are released',()=>{
 let calls=0;return usingAccounts(async f=>{await configure(f);const a=await f.signup();const response=await a.send('/api/ai/edit-plan','POST',{request:job(),media:samples(),mediaConsent:true});assert.equal(response.status,503);assert.match(response.data.error,/балансе/i);assert.equal(calls,1);assert.equal(f.store.get('SELECT count(*) n FROM ai_trial_usage').n,0);},{aiFetch:async()=>{calls++;return new Response('{}',{status:402});}});
});
test('silent MP4 samples send no fabricated audio and return a visual analysis',()=>usingAccounts(async f=>{
 await configure(f);const response=await f.owner('/api/ai/edit-plan','POST',{request:job(),media:{...samples(),audioPresent:false},mediaConsent:true});
 assert.equal(response.status,200,response.raw);assert.equal(response.data.analysis.scope,'visual');assert.equal(response.data.analysis.speech,'');assert.equal(response.data.analysis.events[0].audio,'');assert.match(response.data.analysis.limitations[0],/нет звуковой/);
},{aiFetch:async(_url,init)=>{const payload=JSON.parse(init.body),parts=payload.messages[1].content;
 assert.equal(parts.some(part=>part.type==='input_audio'),false);assert.equal(parts.filter(part=>part.type==='image_url').length,2);assert.equal(JSON.parse(parts[0].text).media.audioPresent,false);return result();
}}));
