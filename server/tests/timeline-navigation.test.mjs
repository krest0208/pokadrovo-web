import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({stdin:{contents:"export * from './src/editor/timeline-navigation';export {Editor} from './src/editor/editor';export * from './src/editor/model';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',loader:{'.css':'empty'}});
function fixture(){
 const frames=new Map();let id=0;
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,crypto,console,setTimeout,clearTimeout,URL,Blob,requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i)});
 const api=module.exports,scroll=new EventTarget();scroll.scrollLeft=620;scroll.clientHeight=300;scroll.getBoundingClientRect=()=>({left:10,width:1000});
 let zoom=1,applies=0,busy=false;
 const nav=new api.TimelineNavigation(scroll,{getBoundingClientRect:()=>({width:104})},()=>zoom,value=>{zoom=value;applies++;},()=>busy);
 function wheel(patch={}){const event=new Event('wheel',{cancelable:true});Object.assign(event,{clientX:514,deltaX:0,deltaY:-120,deltaMode:0,buttons:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...patch});scroll.dispatchEvent(event);return event;}
 return {api,nav,scroll,wheel,get zoom(){return zoom;},get applies(){return applies;},set busy(v){busy=v;},flush(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}};
}
test('wheel zoom coalesces updates and preserves the time under the pointer',()=>{
 const f=fixture(),time=(f.scroll.scrollLeft+400)/62;
 try{assert.equal(f.wheel().defaultPrevented,true);f.wheel();assert.equal(f.applies,0);f.flush();assert.equal(f.applies,1);assert.ok(f.zoom>1);assert.ok(Math.abs((f.scroll.scrollLeft+400)/(62*f.zoom)-time)<1e-9);
  f.wheel({deltaY:120});f.flush();assert.ok(f.zoom>1);assert.ok(Math.abs((f.scroll.scrollLeft+400)/(62*f.zoom)-time)<1e-9);
 }finally{f.nav.dispose();}
});
test('fine wheel input, line/page units, slider changes and zoom limits remain usable',()=>{
 const f=fixture();try{
  f.wheel({deltaY:-1});f.flush();assert.ok(f.zoom>1,'high-resolution wheels must not stall');
  f.wheel({deltaY:-3,deltaMode:1});f.flush();assert.ok(f.zoom>1.05);
  for(let i=0;i<20;i++){f.wheel({deltaY:-1,deltaMode:2});f.flush();}assert.equal(f.zoom,3);
  f.nav.setZoom(.1);assert.equal(f.zoom,.35);f.nav.setZoom(2);assert.equal(f.zoom,2);
  f.wheel();f.nav.setZoom(1.5);f.flush();assert.equal(f.zoom,1.5,'slider cancels pending wheel zoom');
 }finally{f.nav.dispose();}
});
test('browser zoom, horizontal/modified gestures, track labels and drag gestures are not intercepted',()=>{
 const f=fixture();try{
  for(const patch of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{deltaX:200},{clientX:30},{buttons:1},{deltaY:0}])assert.equal(f.wheel(patch).defaultPrevented,false);
  f.busy=true;assert.equal(f.wheel().defaultPrevented,false);f.flush();assert.equal(f.applies,0);
 }finally{f.nav.dispose();}
});
test('leaving cancels queued zoom and removes the wheel listener',()=>{
 const f=fixture();f.wheel();f.nav.dispose();f.flush();assert.equal(f.applies,0);assert.equal(f.wheel().defaultPrevented,false);
});
test('overlay placement copies the media onto independent tracks and supports undo',()=>{
 const f=fixture(),{Editor,History,normalizeProject,normalizeClip,fromAsset,videoLength}=f.api;
 try{
  const original=normalizeProject({id:'layers',clips:[normalizeClip({id:'base',assetId:'base',duration:10})],audio:[],texts:[]});
  const e=Object.create(Editor.prototype);e.history=new History(original);e.cursor=2;e.overlayRows=1;e.exporting=e.loading=e.disposed=false;e.render=()=>{};e.showPanel=()=>{};e.$=()=>({scrollTop:100});e.status=()=>{};e.commit=p=>e.history.commit(p);
  const image={id:'photo',kind:'image',name:'photo.png',duration:5,width:100,height:100,url:'blob:fixture'};
  assert.equal(e.overlaySlot(),1);e.placeAsset(image,e.overlaySlot());e.placeAsset(image,e.overlaySlot());
  assert.equal(videoLength(e.project),10);assert.equal(e.project.clips.length,3);
  assert.deepEqual(Array.from(e.project.clips.slice(1),c=>c.layer),[1,2]);assert.equal(e.project.clips[1].at,2);assert.equal(e.project.clips[1].zoom,.4);assert.notEqual(e.project.clips[1].id,e.project.clips[2].id);
  e.history.undo();assert.equal(e.project.clips.length,2);assert.equal(e.project.clips[0].id,'base');
  for(let layer=2;layer<=8;layer++)e.history.value.clips.push({...fromAsset(image),layer});assert.equal(e.overlaySlot(),null);
 }finally{f.nav.dispose();}
});
test('dropping library media on an overlay uses drop time and never moves the original',()=>{
 const f=fixture(),{Editor,History,normalizeProject,normalizeClip}=f.api;
 try{
  const e=Object.create(Editor.prototype);e.history=new History(normalizeProject({clips:[normalizeClip({id:'base',assetId:'base',duration:10})],audio:[],texts:[]}));e.cursor=0;e.zoom=1;e.overlayRows=1;e.exporting=e.loading=e.disposed=false;
  const asset={id:'photo',kind:'image',name:'photo.png',duration:5,width:100,height:100,url:'blob:fixture'};e.opts={assets:new Map([['photo',asset]])};e.showPanel=()=>{};e.$=()=>({scrollTop:0,getBoundingClientRect:()=>({left:100})});e.commit=p=>e.history.commit(p);
  let prevented=false;e.drop({preventDefault(){prevented=true;},target:{closest:()=>({dataset:{drop:'video',layer:'3'}})},clientX:286,dataTransfer:{files:[],getData:type=>type==='application/x-pokadrovo-asset'?'photo':''}});
  assert.equal(prevented,true);assert.equal(e.project.clips[0].layer,0);assert.equal(e.project.clips[1].layer,3);assert.equal(e.project.clips[1].at,3);assert.equal(e.opts.assets.get('photo'),asset);
 }finally{f.nav.dispose();}
});
