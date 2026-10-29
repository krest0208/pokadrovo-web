import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {usingAccounts} from './account-fixture.mjs';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({absWorkingDir:root,stdin:{contents:"export * from './src/editor/model';export {PlaybackEngine} from './src/editor/engine';export {hitsMedia} from './src/editor/geometry';export {wavSamples,sampleTimes} from './src/editor/media-samples';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',loader:{'.css':'empty'}});
class ImageFixture{naturalWidth=100;naturalHeight=100;decode(){return Promise.resolve();}}
const mod={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,crypto,Image:ImageFixture,HTMLImageElement:ImageFixture,HTMLMediaElement:class{},HTMLVideoElement:class{},cancelAnimationFrame(){},setTimeout,clearTimeout});
const m=mod.exports,clip=(id,patch={})=>m.normalizeClip({id,assetId:id,kind:'image',duration:10,...patch});
test('overlay positions do not ripple the main sequence; layer order and visibility are deterministic',()=>{
 const p=m.newProject();p.clips=[clip('base'),clip('upper',{layer:2,at:3}),clip('next'),clip('lower',{layer:1,at:2})];
 assert.equal(m.videoLength(p),20);assert.equal(m.totalLength(p),20);
 assert.equal(m.positions(p).find(c=>c.clip.id==='next').at,10);
 assert.deepEqual(Array.from(m.visibleClips(p,4),c=>c.clip.id),['base','lower','upper']);
 assert.equal(m.currentClip(p,4).clip.id,'base');assert.equal(m.visibleClips(p,13).some(c=>c.clip.id==='upper'),false);
 p.clips.push(clip('tail',{at:25,layer:1}));assert.equal(m.totalLength(p),35);
 assert.equal(m.normalizeClip({layer:999}).layer,8);assert.equal(m.normalizeClip({layer:-1}).layer,0);
});
test('overlay split, ripple cut, undo and JSON roundtrip preserve timing and source geometry',()=>{
 const p=m.newProject();p.clips=[clip('base'),clip('overlay',{layer:2,at:2,speed:2,x:20,zoom:.4})];
 const [a,b]=m.splitClip(p.clips[1],1);assert.equal(b.at,3);assert.equal(b.start,2);assert.equal(b.layer,2);
 const cut=m.cutRange(p,3,4),overlays=cut.clips.filter(c=>c.layer);assert.equal(overlays.length,2);assert.equal(overlays[1].at,3);assert.equal(overlays[1].start,4);assert.equal(overlays[1].zoom,.4);
 const history=new m.History(p);history.commit(cut);history.undo();assert.equal(history.value.clips[1].at,2);history.redo();assert.equal(history.value.clips.filter(c=>c.layer).length,2);
 const restored=m.normalizeProject(JSON.parse(JSON.stringify(p)));assert.equal(restored.clips[1].layer,2);assert.equal(restored.clips[1].x,20);assert.equal(m.totalLength(restored),10);
});
test('shared preview/export compositor draws active layers in order, including overlay-only projects',async()=>{
 const calls=[],ctx=new Proxy({drawImage(image){calls.push(image.src);}},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)}),canvas={width:100,height:100,getContext:()=>ctx};
 const p=m.newProject();p.clips=[clip('base'),clip('upper',{layer:2,at:2}),clip('lower',{layer:1,at:2})];
 const assets=new Map(p.clips.map(c=>[c.assetId,{id:c.assetId,url:c.id}]));const engine=new m.PlaybackEngine(canvas,assets,()=>{});
 await engine.prepare(p);calls.length=0;await engine.seek(3);assert.deepEqual(calls,['base','lower','upper']);
 calls.length=0;await engine.seek(1);assert.deepEqual(calls,['base']);
 const only=m.newProject();only.clips=[clip('lower',{layer:1,at:2})];await engine.prepare(only);calls.length=0;await engine.seek(3);assert.deepEqual(calls,['lower']);calls.length=0;await engine.seek(m.totalLength(only));assert.deepEqual(calls,['lower']);engine.dispose();
});
test('account storage retains overlay layer, time and transforms without leaking extra fields',()=>usingAccounts(async f=>{
 const a=await f.signup(),p=m.newProject();p.clips=[clip('base'),{...clip('overlay',{layer:3,at:4,zoom:.4}),apiKey:'must-not-persist'}];
 assert.equal((await a.send('/api/account/projects','PUT',{project:p})).status,200);
 const saved=(await a.send('/api/account/projects')).data.projects[0];assert.equal(saved.clips[1].layer,3);assert.equal(saved.clips[1].at,4);assert.equal(saved.clips[1].zoom,.4);assert.equal(saved.clips[1].apiKey,undefined);
}));
test('media preparation creates PCM mono WAV and at most 12 time-ordered samples',()=>{
 const wav=m.wavSamples(new Float32Array([-1,0,1])),v=new DataView(wav.buffer);
 assert.equal(v.getUint32(24,true),16000);assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(48,true),32767);
 const times=m.sampleTimes(60);assert.equal(times.length,12);assert.equal(times[0],0);assert.equal(times.at(-1),59.99);
 for(const duration of [.04,.1,1,5,12,30,60]){const samples=m.sampleTimes(duration);assert.ok(samples.length>=2&&samples.length<=12);assert.equal(samples[0],0);assert.ok(Math.abs(samples.at(-1)-(duration-.01))<1e-8);assert.ok(samples.every((at,i)=>at>=0&&at<duration&&(!i||at>samples[i-1])));}
 for(const duration of [0,.01,NaN,Infinity,61])assert.throws(()=>m.sampleTimes(duration));
});

test('preview hit testing selects the actual image footprint, rotation and masks rather than the whole canvas',()=>{
 const c=clip('overlay',{zoom:.4,x:25,y:20}),asset={width:100,height:100};assert.equal(m.hitsMedia(c,asset,75,70,100,100),true);assert.equal(m.hitsMedia(c,asset,20,20,100,100),false);assert.equal(m.hitsMedia({...c,opacity:0},asset,75,70,100,100),false);
 assert.equal(m.hitsMedia({...c,shape:'ellipse'},asset,94,89,100,100),false);assert.equal(m.hitsMedia({...c,rotation:45},asset,100,95,100,100),false);
});
