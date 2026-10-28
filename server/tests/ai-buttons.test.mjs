import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {providerFailure} from '../ai-provider-error.mjs';
import {usingAccounts} from './account-fixture.mjs';
import {POLZA_ENDPOINT,POLZA_MODEL} from '../polza.mjs';
import {token} from '../security.mjs';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({stdin:{contents:"export * from './src/editor/audio-samples';export {AiPanel} from './src/editor/ai-panel';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',loader:{'.css':'empty'}});
function runtime(options={}){
 const state={decode:0,closed:0,disconnected:0,plays:0,processor:null,removed:0};
 const output={duration:.3,getChannelData:()=>new Float32Array(4800).fill(.1)};
 class Offline{
  decodeAudioData(){state.decode++;return options.decodeError?Promise.reject(Error('Unsupported container')):Promise.resolve(output);}
  createBufferSource(){return {connect(){},start(){}};}
  startRendering(){return Promise.resolve(output);}
 }
 class Media extends EventTarget{
  currentTime=0;paused=true;volume=1;muted=false;
  setAttribute(){}removeAttribute(){state.removed++;}pause(){this.paused=true;}
  load(){if(this.src)queueMicrotask(()=>this.onloadeddata?.());}
  async play(){state.plays++;this.paused=false;options.onPlay?.();
   queueMicrotask(()=>{if(options.hang)return;for(let i=0;i<3;i++)state.processor?.onaudioprocess?.({inputBuffer:{length:2048,numberOfChannels:1,getChannelData:()=>new Float32Array(2048).fill(.2)}});this.currentTime=.3;this.ontimeupdate?.();this.dispatchEvent(new Event('ended'));});
  }
 }
 const node=()=>({connect(){},disconnect(){state.disconnected++;}});
 class Audio{
  sampleRate=16000;state='running';
  createGain(){return {...node(),gain:{value:1}};}
  createMediaElementSource(){return node();}
  createScriptProcessor(){return state.processor={...node(),onaudioprocess:null};}
  resume(){return Promise.resolve();}
  createBuffer(_channels,length,rate){return {duration:length/rate,copyToChannel(){}};}
  close(){state.closed++;return Promise.resolve();}
 }
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,crypto,console,DOMException,AbortController,setTimeout,clearTimeout,queueMicrotask,window:{AudioContext:Audio},document:{createElement:()=>new Media()},OfflineAudioContext:Offline});
 return {...module.exports,state};
}
function box(type,...parts){const payload=Buffer.concat(parts),out=Buffer.alloc(payload.length+8);out.writeUInt32BE(out.length);out.write(type,4);payload.copy(out,8);return out;}
function mp4(sound=false){const handler=type=>{const data=Buffer.alloc(12);data.write(type,8);return box('trak',box('mdia',box('hdlr',data)));};return Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',handler('vide'),...(sound?[handler('soun')]:[]))]);}
const ab=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const asset=(bytes=mp4(true))=>({kind:'video',duration:.3,url:'blob:synthetic',blob:{arrayBuffer:async()=>ab(bytes)}});
test('MP4 sound detection distinguishes silent, audible and unknown containers without decoder guesses',()=>{
 const m=runtime();assert.equal(m.mp4AudioPresence(ab(mp4())),false);assert.equal(m.mp4AudioPresence(ab(mp4(true))),true);
 for(const bytes of [Buffer.alloc(0),Buffer.from('not mp4'),mp4().subarray(0,-3)])assert.equal(m.mp4AudioPresence(ab(bytes)),null);
});
test('silent MP4 prepares a duration-matched placeholder without attempting to decode missing audio',async()=>{
 const m=runtime({decodeError:true}),out=await m.readAudioSamples(asset(mp4()),new AbortController().signal);
 assert.equal(out.audioPresent,false);assert.equal(out.samples.length,4800);assert.equal(m.state.decode,0);assert.equal(m.state.plays,0);
});
test('normal decode stays fast; decoder failure uses local playback, reports progress and releases resources',async()=>{
 const fast=runtime();assert.equal((await fast.readAudioSamples(asset(),new AbortController().signal)).audioPresent,true);assert.equal(fast.state.plays,0);
 const fallback=runtime({decodeError:true}),messages=[];const result=await fallback.readAudioSamples(asset(),new AbortController().signal,s=>messages.push(s));
 assert.equal(result.audioPresent,true);assert.equal(result.samples.length,4800);assert.equal(fallback.state.plays,1);assert.equal(fallback.state.closed,1);assert.ok(fallback.state.disconnected>=3);assert.ok(messages.some(s=>s.includes('100%')));
});
test('cancelling local playback rejects before any provider call and cleans up',async()=>{
 const controller=new AbortController(),m=runtime({decodeError:true,hang:true,onPlay:()=>controller.abort()});
 await assert.rejects(m.readAudioSamples(asset(),controller.signal),e=>e.name==='AbortError');assert.equal(m.state.closed,1);assert.ok(m.state.removed>0);
});
function panel(overrides={}){
 const {AiPanel}=runtime(),messages=[];let calls=0;
 const p=Object.create(AiPanel.prototype);Object.assign(p,{available:true,requiresMedia:false,disposed:false,generation:0,abort:null,input:{value:'Измени скорость.'},port:{provider:{service:'reels-trial',createPlan:async()=>{calls++;return {plan:{operations:[]},analysis:null};}}},build:async()=>({}),renderPlan(){},renderAnalysis(){},refresh(){},say(message){messages.push(message);},checkConnection:async()=>{},validatePlan:plan=>plan,...overrides});
 return {p,messages,get calls(){return calls;}};
}
test('both click paths are locked before awaiting build, including rapid double clicks',async()=>{
 const f=panel();let release;f.p.build=()=>new Promise(resolve=>{release=resolve;});
 const first=f.p.send();await f.p.send();assert.equal(f.calls,0);release({});await first;assert.equal(f.calls,1);assert.equal(f.p.abort,null);
});
test('preparation failure re-enables both buttons; cancellation while building cannot send later',async()=>{
 const f=panel({prepareMedia:async()=>{throw Error('Synthetic preparation failure');}});await f.p.send(true);assert.equal(f.calls,0);assert.equal(f.p.abort,null);assert.ok(f.messages.some(message=>message.endsWith('Synthetic preparation failure')));
 await f.p.send();assert.equal(f.calls,1);
 const cancelled=panel();let release;cancelled.p.build=()=>new Promise(resolve=>{release=resolve;});const run=cancelled.p.send();cancelled.p.cancel();release({});await run;assert.equal(cancelled.calls,0);
});
test('upstream failures are bounded and classified without exposing raw credentials or prompts',async()=>{
 for(const [status,message,code] of [[400,'response_format anyOf invalid','schema'],[422,'input_audio unsupported','media'],[402,'balance','balance'],[401,'bad key','access'],[429,'quota','rate_limit'],[503,'offline','unavailable']]){
  const failure=await providerFailure(new Response(JSON.stringify({error:{message:message+' private_key private_prompt'}}),{status}));assert.equal(failure.code,code);assert.ok(!failure.message.includes('private_'));
 }
 assert.equal((await providerFailure(new Response('x'.repeat(20000),{status:400}))).code,'request');
});
test('provider rejection releases a held trial once and stores only a safe failure category',()=>{
 let calls=0;return usingAccounts(async f=>{
  await f.owner('/api/admin/settings','PUT',{provider:'polza',model:POLZA_MODEL,endpoint:POLZA_ENDPOINT,apiKey:'synthetic-buttons-test-key',aiEnabled:true,trialEnabled:true,analyticsEnabled:false,password:f.password});
  const job={version:1,requestId:token(),projectId:'buttons',revision:'pk1-test',prompt:'Тест',project:{id:'buttons',schema:4,mode:'video',ratio:'16:9',clips:[{id:'v1',assetId:'a1',kind:'video',name:'fixture.mp4',duration:2,start:0,end:2,speed:1}],audio:[],texts:[]},cursor:0,capabilities:['ratio'],fontIds:['system']};
  const response=await f.owner('/api/ai/edit-plan','POST',{request:job});assert.equal(response.status,502);assert.match(response.data.error,/AI_SCHEMA/);assert.equal(calls,1);
  const run=f.store.get('SELECT result,provider_error_code,coin_charge FROM ai_runs');assert.equal(run.provider_error_code,'schema');assert.equal(run.result,'failed');assert.equal(run.coin_charge,0);
 },{aiFetch:async()=>{calls++;return new Response(JSON.stringify({error:{message:'response_format unsupported anyOf private_key'}}),{status:400});}});
});
