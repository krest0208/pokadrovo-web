import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({absWorkingDir:root,stdin:{contents:"export {createThemeIconMotion} from './src/motion/theme-icon';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',loader:{'.css':'empty'},plugins:[{name:'theme-animation-clock',setup(b){b.onResolve({filter:/^motion\/mini$/},()=>({path:'clock',namespace:'clock'}));b.onLoad({filter:/.*/,namespace:'clock'},()=>({contents:'export const animate=(...args)=>globalThis.runAnimation(...args);'}));}}]});
function browser({reduced=false,waapi=true,failAt=0,hidden=false,stopThrows=false}={}){
 const preference=new EventTarget();preference.matches=reduced;
 const nodes=Object.fromEntries(['orbit','sun','dot','moon'].map(name=>[name,{name,style:{},...(waapi?{animate(){}}:{})}]));
 const element={dataset:{},hidden,getClientRects(){return this.hidden?[]:[{}];},querySelector:selector=>nodes[selector.replace('.pk-theme-','')],ownerDocument:{defaultView:{matchMedia:()=>preference}}},animations=[];
 const module={exports:{}};let attempts=0;
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,runAnimation(node,keyframes,options){if(++attempts===failAt)throw Error('WAAPI unavailable');const animation={node,keyframes,options,stopped:false,cancelled:false,stop(){this.stopped=true;if(stopThrows||element.hidden)throw Error('InvalidStateError: cannot commit styles');},cancel(){this.cancelled=true;}};animations.push(animation);return animation;}});
 return {element,...nodes,preference,animations,start:()=>module.exports.createThemeIconMotion(element,'light')};
}
function settled(b,theme){assert.equal(b.element.dataset.theme,theme);assert.equal(b.sun.style.opacity,theme==='light'?'1':'0');assert.equal(b.moon.style.opacity,theme==='dark'?'1':'0');assert.equal(b.dot.style.opacity,'0');assert.equal(b.orbit.style.transform,'translateX(0px)');}
test('both directions hold a clean dot between the outgoing and incoming symbols',()=>{
 const b=browser(),motion=b.start();settled(b,'light');
 for(const theme of ['dark','light']){
  motion.update(theme);assert.equal(b.element.dataset.theme,theme);
  const group=b.animations.slice(-4),outgoing=group.find(a=>a.node.name===(theme==='dark'?'sun':'moon')),incoming=group.find(a=>a.node.name===(theme==='dark'?'moon':'sun')),dot=group.find(a=>a.node.name==='dot');
  assert.equal(group.length,4);
  for(const index of [1,2]){assert.equal(outgoing.keyframes.opacity[index],0);assert.equal(incoming.keyframes.opacity[index],0);assert.equal(dot.keyframes.opacity[index],1);assert.equal(dot.keyframes.transform[index],'scale(1)');}
  const hold=(dot.options.times[2]-dot.options.times[1])*dot.options.duration;assert.ok(hold>=.14&&hold<=.18);
  assert.equal(incoming.keyframes.opacity.at(-1),1);assert.equal(dot.keyframes.opacity.at(-1),0);
 }
 motion.dispose();settled(b,'light');
});
test('rapid theme changes stop every active layer and disposal blocks further animation',()=>{
 const b=browser(),motion=b.start();assert.equal(b.animations.length,0);
 motion.update('dark');assert.equal(b.animations.length,4);
 motion.update('light');assert.ok(b.animations.slice(0,4).every(a=>a.stopped));assert.equal(b.element.dataset.theme,'light');assert.equal(b.animations.length,8);
 motion.update('light');assert.equal(b.animations.length,8);
 motion.dispose();assert.ok(b.animations.every(a=>a.stopped));settled(b,'light');
 motion.update('dark');settled(b,'light');assert.equal(b.animations.length,8);
 b.orbit.style.transform='unchanged';b.preference.matches=true;b.preference.dispatchEvent(new Event('change'));assert.equal(b.orbit.style.transform,'unchanged');
});
test('reduced motion and failed or unsupported WAAPI leave a complete target symbol',()=>{
 for(const options of [{reduced:true},{waapi:false},{failAt:1},{failAt:3}]){
  const b=browser(options),motion=b.start();motion.update('dark');settled(b,'dark');assert.ok(b.animations.every(a=>a.stopped));motion.dispose();
 }
 const b=browser(),motion=b.start();motion.update('dark');b.preference.matches=true;b.preference.dispatchEvent(new Event('change'));
 assert.ok(b.animations.every(a=>a.stopped));settled(b,'dark');
 motion.update('light');assert.equal(b.animations.length,4);settled(b,'light');motion.dispose();
});
test('hidden controls skip animation and hiding active layers safely cancels them',()=>{
 const b=browser({hidden:true}),motion=b.start();motion.update('dark');assert.equal(b.animations.length,0);settled(b,'dark');
 b.element.hidden=false;motion.update('light');assert.equal(b.animations.length,4);
 b.element.hidden=true;assert.doesNotThrow(()=>motion.update('dark'));assert.ok(b.animations.every(a=>a.cancelled));assert.equal(b.animations.length,4);settled(b,'dark');
 b.element.hidden=false;motion.update('light');b.element.hidden=true;assert.doesNotThrow(()=>motion.dispose());assert.ok(b.animations.every(a=>a.cancelled));settled(b,'light');
});
test('failed native style commits cancel every layer during rapid updates and cleanup',()=>{
 const b=browser({stopThrows:true}),motion=b.start();motion.update('dark');
 assert.doesNotThrow(()=>motion.update('light'));assert.ok(b.animations.slice(0,4).every(a=>a.cancelled));assert.equal(b.animations.length,8);assert.equal(b.element.dataset.theme,'light');
 assert.doesNotThrow(()=>motion.dispose());assert.ok(b.animations.every(a=>a.cancelled));settled(b,'light');
});
