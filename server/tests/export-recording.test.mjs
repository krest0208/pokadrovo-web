import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export {exportProject} from './src/editor/engine';export {normalizeProject} from './src/editor/model';",resolveDir:new URL('../..',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser'});
function runtime({hidden=false,hangPaint=false}={}){
 const order=[],timers=new Map();let n=0,clock=0,closed=0,stopped=0;
 const node=()=>({connect(){},disconnect(){},gain:{value:1,setTargetAtTime(){}},threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}});
 const videoTrack={requestFrame(){order.push('request-frame');},stop(){stopped++;}},audioTrack={stop(){stopped++;}};
 class Image{naturalWidth=640;naturalHeight=360;decode(){return Promise.resolve();}}
 class Audio{state='running';createGain(){return node();}createDynamicsCompressor(){return node();}createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[audioTrack]}};}close(){closed++;return Promise.resolve();}}
 class Stream{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}}
 class Recorder{state='inactive';start(){order.push('start');this.state='recording';}stop(){order.push('stop');this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(256)])});this.onstop?.();}}
 const ctx=new Proxy({drawImage(){order.push('draw');}},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 const canvas={getContext:()=>ctx,captureStream(){order.push('capture-stream');return {getVideoTracks:()=>[videoTrack]};}};
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,crypto,Blob,DOMException,console,AudioContext:Audio,Image,HTMLImageElement:Image,HTMLMediaElement:class{},HTMLVideoElement:class{},MediaStream:Stream,MediaRecorder:Recorder,performance:{now:()=>clock+=200},document:{hidden,createElement:()=>canvas},requestAnimationFrame(callback){const id=++n;if(!hangPaint)timers.set(id,setTimeout(()=>{timers.delete(id);order.push('paint');callback();},0));return id;},cancelAnimationFrame(id){clearTimeout(timers.get(id));timers.delete(id);},setTimeout,clearTimeout});
 const api=module.exports,p=api.normalizeProject({id:'export',ratio:'16:9',clips:[{id:'card',assetId:'image',kind:'image',duration:1}]});
 return {...api,p,assets:new Map([['image',{id:'image',url:'synthetic-card'}]]),order,get closed(){return closed;},get stopped(){return stopped;}};
}
const format={mime:'video/webm',ext:'webm'};
test('recording starts only after the opening frame reaches the capture track and includes a painted final frame',async()=>{
 const m=runtime(),progress=[];const blob=await m.exportProject(m.p,m.assets,format,720,v=>progress.push(v),new AbortController().signal);
 const start=m.order.indexOf('start'),stop=m.order.indexOf('stop');
 assert.ok(start>m.order.indexOf('capture-stream'));assert.ok(m.order.slice(0,start).filter(v=>v==='paint').length>=2);
 assert.ok(m.order.slice(0,start).includes('request-frame'));assert.ok(m.order.slice(start,stop).includes('paint'));assert.equal(m.order[stop-1],'paint');
 assert.ok(blob.size>=128);assert.equal(progress.at(-1),1);assert.equal(m.closed,1);assert.equal(m.stopped,2);
});
test('cancelling while the first frame is pending stops both tracks and never starts a recorder',async()=>{
 const m=runtime({hangPaint:true}),controller=new AbortController(),pending=m.exportProject(m.p,m.assets,format,720,()=>{},controller.signal);
 setTimeout(()=>controller.abort(),10);await assert.rejects(pending,e=>e.name==='AbortError');assert.ok(!m.order.includes('start'));assert.equal(m.closed,1);assert.equal(m.stopped,2);
});
test('a hidden tab does not begin a silently incomplete recording',async()=>{
 const m=runtime({hidden:true});await assert.rejects(m.exportProject(m.p,m.assets,format,720,()=>{},new AbortController().signal),/keep this tab visible/);assert.ok(!m.order.includes('start'));assert.equal(m.closed,1);assert.equal(m.stopped,2);
});
