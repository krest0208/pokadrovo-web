import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({absWorkingDir:root,stdin:{contents:"export {createThemeIconMotion} from './src/motion/theme-icon';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',loader:{'.css':'empty'},plugins:[{name:'theme-animation-clock',setup(b){b.onResolve({filter:/^motion\/mini$/},()=>({path:'clock',namespace:'clock'}));b.onLoad({filter:/.*/,namespace:'clock'},()=>({contents:'export const animate=(...args)=>globalThis.runAnimation(...args);'}));}}]});
function browser({reduced=false,waapi=true,throws=false,hidden=false,stopThrows=false}={}){
 const preference=new EventTarget();preference.matches=reduced;
 const orbit={style:{},...(waapi?{animate(){}}:{})};
 const element={dataset:{},hidden,getClientRects(){return this.hidden?[]:[{}];},querySelector:()=>orbit,ownerDocument:{defaultView:{matchMedia:()=>preference}}},animations=[];
 const module={exports:{}};
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,runAnimation(node,keyframes,options){if(throws)throw Error('WAAPI unavailable');const animation={node,keyframes,options,stopped:false,cancelled:false,stop(){this.stopped=true;if(stopThrows||element.hidden)throw Error('InvalidStateError: cannot commit styles');},cancel(){this.cancelled=true;}};animations.push(animation);return animation;}});
 return {element,orbit,preference,animations,start:()=>module.exports.createThemeIconMotion(element,'light')};
}
test('rapid theme changes cancel prior motion and disposal blocks further animation',()=>{
 const b=browser(),motion=b.start();assert.equal(b.animations.length,0);assert.equal(b.orbit.style.transform,'translateX(0px) rotate(0deg)');
 motion.update('dark');assert.equal(b.element.dataset.theme,'dark');assert.equal(b.animations.length,1);
 motion.update('light');assert.equal(b.animations[0].stopped,true);assert.equal(b.element.dataset.theme,'light');assert.equal(b.animations.length,2);
 motion.update('light');assert.equal(b.animations.length,2);
 motion.dispose();assert.equal(b.animations[1].stopped,true);
 motion.update('dark');assert.equal(b.element.dataset.theme,'light');assert.equal(b.animations.length,2);
 b.orbit.style.transform='unchanged';b.preference.matches=true;b.preference.dispatchEvent(new Event('change'));assert.equal(b.orbit.style.transform,'unchanged');
});
test('reduced motion and unavailable animation APIs preserve immediate theme changes',()=>{
 for(const options of [{reduced:true},{waapi:false},{throws:true}]){
  const b=browser(options),motion=b.start();motion.update('dark');assert.equal(b.element.dataset.theme,'dark');assert.equal(b.orbit.style.transform,'translateX(0px) rotate(180deg)');motion.dispose();
 }
 const b=browser(),motion=b.start();motion.update('dark');b.preference.matches=true;b.preference.dispatchEvent(new Event('change'));
 assert.equal(b.animations[0].stopped,true);assert.equal(b.orbit.style.transform,'translateX(0px) rotate(180deg)');
 motion.update('light');assert.equal(b.animations.length,1);assert.equal(b.element.dataset.theme,'light');motion.dispose();
});
test('hidden controls settle without WAAPI and hiding an active control safely cancels motion',()=>{
 const b=browser({hidden:true}),motion=b.start();
 motion.update('dark');assert.equal(b.animations.length,0);assert.equal(b.element.dataset.theme,'dark');assert.equal(b.orbit.style.transform,'translateX(0px) rotate(180deg)');
 b.element.hidden=false;motion.update('light');assert.equal(b.animations.length,1);
 b.element.hidden=true;assert.doesNotThrow(()=>motion.update('dark'));assert.equal(b.animations[0].cancelled,true);assert.equal(b.animations.length,1);assert.equal(b.orbit.style.transform,'translateX(0px) rotate(180deg)');
 b.element.hidden=false;motion.update('light');b.element.hidden=true;assert.doesNotThrow(()=>motion.dispose());assert.equal(b.animations[1].cancelled,true);
});
test('a failed native style commit falls back to cancellation during rapid updates and cleanup',()=>{
 const b=browser({stopThrows:true}),motion=b.start();motion.update('dark');
 assert.doesNotThrow(()=>motion.update('light'));assert.equal(b.animations[0].cancelled,true);assert.equal(b.animations.length,2);assert.equal(b.element.dataset.theme,'light');
 assert.doesNotThrow(()=>motion.dispose());assert.equal(b.animations[1].cancelled,true);assert.equal(b.orbit.style.transform,'translateX(0px) rotate(0deg)');
});
