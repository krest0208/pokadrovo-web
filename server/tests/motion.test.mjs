import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({absWorkingDir:root,stdin:{contents:"export {createPageMotion} from './src/motion/page-motion';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',plugins:[{name:'animation-clock',setup(b){b.onResolve({filter:/^motion\/mini$/},()=>({path:'clock',namespace:'clock'}));b.onLoad({filter:/.*/,namespace:'clock'},()=>({contents:'export const animate=(...args)=>globalThis.runAnimation(...args);'}));}}]});
function browser({reduced=false,waapi=true,observer=true,throws=false}={}){
 class Style{
  values=new Map();
  getPropertyValue(k){return this.values.get(k)?.[0]||'';}
  getPropertyPriority(k){return this.values.get(k)?.[1]||'';}
  setProperty(k,v,priority=''){this.values.set(k,[v,priority]);}
  removeProperty(k){this.values.delete(k);}
 }
 class Element extends EventTarget{
  style=new Style();children=[];parentElement=null;isConnected=true;eligible=true;
  animate(){} matches(){return this.eligible;}
  querySelectorAll(){return this.children.filter(c=>c.eligible);}
  contains(n){return n===this||this.children.includes(n);}
 }
 const document=new EventTarget();document.activeElement=null;document.visibilityState='visible';
 const preference=new EventTarget();preference.matches=reduced;
 const roots=[],mutations=[],animations=[];
 class Observer{
  targets=new Set();disconnected=false;
  constructor(callback){this.callback=callback;roots.push(this);}
  observe(n){this.targets.add(n);}unobserve(n){this.targets.delete(n);}
  disconnect(){this.disconnected=true;this.targets.clear();}
  enter(n){if(this.targets.has(n))this.callback([{target:n,isIntersecting:true}]);}
 }
 class Mutations{
  constructor(callback){this.callback=callback;mutations.push(this);}
  observe(){}disconnect(){this.disconnected=true;}
  added(n){if(!this.disconnected)this.callback([{addedNodes:[n]}]);}
 }
 const page=new Element();page.eligible=false;if(!waapi)page.animate=undefined;
 const append=()=>{const e=new Element();e.parentElement=page;page.children.push(e);return e;};
 const first=append(),second=append();
 const module={exports:{}},scope={module,exports:module.exports,HTMLElement:Element,MutationObserver:Mutations,document,window:{matchMedia:()=>preference},
  runAnimation(node,keyframes,options){
   if(throws)throw Error('Animation unavailable');
   node.style.setProperty('opacity','0');node.style.setProperty('transform','translateY(18px)');
   const animation={node,keyframes,options,cancelled:false,cancel(){this.cancelled=true;},then(done){this.done=done;},finish(){node.style.setProperty('opacity','1');node.style.setProperty('transform','none');this.done();}};
   animations.push(animation);return animation;
  }};
 if(observer)scope.IntersectionObserver=Observer;
 vm.runInNewContext(bundle.outputFiles[0].text,scope);
 const start=()=>module.exports.createPageMotion(page);
 return{page,first,second,append,roots,mutations,animations,preference,document,start};
}
test('reveals a block only once and restores its original styles after completion',()=>{
 const b=browser();b.first.style.setProperty('opacity','.8','important');b.first.style.setProperty('transform','rotate(2deg)');
 const stop=b.start();b.roots[0].enter(b.first);assert.equal(b.animations.length,1);assert.equal(b.first.style.getPropertyValue('opacity'),'0');
 b.animations[0].finish();assert.equal(b.first.style.getPropertyValue('opacity'),'.8');assert.equal(b.first.style.getPropertyPriority('opacity'),'important');assert.equal(b.first.style.getPropertyValue('transform'),'rotate(2deg)');
 b.roots[0].enter(b.first);assert.equal(b.animations.length,1);stop();
});
test('reduced motion skips animation and responds immediately when the setting changes',()=>{
 const b=browser({reduced:true}),stop=b.start();assert.equal(b.roots.length,0);assert.equal(b.first.style.getPropertyValue('opacity'),'');
 b.preference.matches=false;b.preference.dispatchEvent(new Event('change'));b.roots[0].enter(b.first);assert.equal(b.animations.length,1);
 b.preference.matches=true;b.preference.dispatchEvent(new Event('change'));assert.equal(b.animations[0].cancelled,true);assert.equal(b.first.style.getPropertyValue('opacity'),'');assert.equal(b.first.style.getPropertyValue('transform'),'');assert.equal(b.roots[0].disconnected,true);
 b.preference.matches=false;b.preference.dispatchEvent(new Event('change'));b.roots[1].enter(b.first);assert.equal(b.animations.length,1);b.roots[1].enter(b.second);assert.equal(b.animations.length,2);stop();
});
test('late cards are observed and navigation cancels animations without leaving hidden content',()=>{
 const b=browser(),stop=b.start(),late=b.append();b.mutations[0].added(late);b.roots[0].enter(late);assert.equal(b.animations.length,1);
 stop();assert.equal(b.animations[0].cancelled,true);assert.equal(late.style.getPropertyValue('opacity'),'');assert.equal(late.style.getPropertyValue('transform'),'');assert.equal(b.roots[0].disconnected,true);assert.equal(b.mutations[0].disconnected,true);
 b.preference.dispatchEvent(new Event('change'));assert.equal(b.roots.length,1);
});
test('keyboard focus and a hidden tab finish pending motion with readable content',()=>{
 const b=browser(),stop=b.start();b.document.activeElement=b.first;b.roots[0].enter(b.first);assert.equal(b.animations.length,0);
 b.document.activeElement=null;b.roots[0].enter(b.second);assert.equal(b.animations.length,1);const focus=new Event('focusin');Object.defineProperty(focus,'target',{value:b.second});b.page.dispatchEvent(focus);assert.equal(b.animations[0].cancelled,true);assert.equal(b.second.style.getPropertyValue('opacity'),'');
 const third=b.append();b.mutations[0].added(third);b.roots[0].enter(third);
 b.document.visibilityState='hidden';b.document.dispatchEvent(new Event('visibilitychange'));assert.equal(b.animations[1].cancelled,true);assert.equal(third.style.getPropertyValue('opacity'),'');stop();
});
test('unsupported browser APIs and animation errors leave the page visible and usable',()=>{
 for(const options of [{waapi:false},{observer:false},{throws:true}]){
  const b=browser(options),stop=b.start();b.roots[0]?.enter(b.first);assert.equal(b.first.style.getPropertyValue('opacity'),'');assert.equal(b.first.style.getPropertyValue('transform'),'');stop();
 }
});
