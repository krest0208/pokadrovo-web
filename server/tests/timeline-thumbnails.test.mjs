import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export * from './src/editor/timeline-thumbnails';",resolveDir:new URL('../..',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node'});
function environment(blocked=false){
 const frames=[],draws=[],images=[];let video;
 class FakeVideo extends EventTarget{
  videoWidth=640;videoHeight=360;value=0;src='';muted=false;playsInline=false;preload='';
  load(){if(!blocked)queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')));}
  set currentTime(value){this.value=value;if(!blocked)queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}get currentTime(){return this.value;}
  pause(){}removeAttribute(){this.src='';}
 }
 const strip={dataset:{assetId:'video',sourceStart:'2',sourceEnd:'8'},children:[],left:0,width:432,
  getBoundingClientRect(){return {left:this.left,right:this.left+this.width,top:0,bottom:39,width:this.width};},
  querySelectorAll(){return this.children;},append(img){img.isConnected=true;img.owner=this;this.children.push(img);},replaceChildren(){for(const child of [...this.children])child.remove();}};
 const scroll=new EventTarget();scroll.getBoundingClientRect=()=>({left:0,right:300,top:0,bottom:200});
 const document={createElement(tag){
  if(tag==='video')return video=new FakeVideo();
  if(tag==='img'){const img={dataset:{},style:{},src:'',isConnected:false,remove(){this.isConnected=false;this.owner.children=this.owner.children.filter(n=>n!==this);}};images.push(img);return img;}
  if(tag==='canvas')return {width:0,height:0,getContext:()=>({drawImage(v){draws.push(v.currentTime);}}),toDataURL:()=>`data:image/jpeg;base64,frame-${draws.at(-1)}`};
  throw Error(tag);
 }};
 const module={exports:{}};
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,console,document,DOMException,AbortController,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},setTimeout,clearTimeout});
 const assets=new Map([['video',{id:'video',kind:'video',duration:10,url:'blob:synthetic-test',thumbnail:'data:image/jpeg;base64,placeholder'}]]);
 const manager=new module.exports.TimelineThumbnails({querySelectorAll:()=>[strip]},scroll,assets);
 return {api:module.exports,manager,strip,scroll,draws,images,get video(){return video;},render(){while(frames.length)frames.shift()();}};
}
const settle=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
test('filmstrip samples respect source trims and scaled clip widths',()=>{
 const e=environment();try{
  assert.equal(e.api.frameTime(2,8,144,0),3.5);assert.equal(e.api.frameTime(2,8,288,0),2.75);
  for(const width of [1,71,144,432,100000])for(const index of e.api.visibleFrames(width,0,300)){const at=e.api.frameTime(2,8,width,index);assert.ok(at>=2&&at<8);}
  assert.equal(e.api.visibleFrames(1000000,500000,500300).length,5);assert.equal(e.api.visibleFrames(500,600,900).length,0);
 }finally{e.manager.dispose();}
});
test('visible frames decode independently, are cached and are recycled after horizontal scroll',async()=>{
 const e=environment();try{
  e.manager.refresh();e.render();await settle();assert.ok(e.draws.length>=4);assert.ok(e.draws.every(t=>t>=2&&t<8));
  assert.ok(e.strip.children.every(img=>img.dataset.frameReady==='true'));const count=e.draws.length;
  e.manager.refresh();e.render();await settle();assert.equal(e.draws.length,count);
  e.strip.width=100000;e.strip.left=-40000;e.scroll.dispatchEvent(new Event('scroll'));e.render();await settle();
  assert.ok(e.strip.children.length<=8);assert.ok(e.strip.children.every(img=>Number(img.dataset.frameIndex)>500));
  assert.equal(e.video.src,'blob:synthetic-test');
 }finally{e.manager.dispose();assert.equal(e.video.src,'');assert.equal(e.manager.cache.size,0);}
});
test('leaving the editor aborts a pending decoder and removes listeners and queued work',async()=>{
 const e=environment(true);e.manager.refresh();e.render();assert.equal(e.manager.busy,true);e.manager.dispose();await settle();
 assert.equal(e.manager.busy,false);assert.equal(e.manager.queue.size,0);assert.equal(e.manager.cache.size,0);assert.equal(e.draws.length,0);
});
test('rounded samples stay inside very short trimmed fragments',async()=>{
 for(const [start,end] of [[1.04,1.08],[1.11,1.15],[1.94,1.98]]){
  const e=environment();try{
   e.strip.dataset.sourceStart=String(start);e.strip.dataset.sourceEnd=String(end);e.strip.width=20;
   e.manager.refresh();e.render();await settle();
   assert.equal(e.draws.length,1);assert.ok(e.draws[0]>=start&&e.draws[0]<end,`${e.draws[0]} outside ${start}..${end}`);
  }finally{e.manager.dispose();}
 }
});
