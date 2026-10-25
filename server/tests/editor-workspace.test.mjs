import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({absWorkingDir:root,stdin:{contents:`export {Editor} from './src/editor/editor';export {default as Studio} from './src/Studio';export {newProject,normalizeClip,History} from './src/editor/model';export {acceptSession} from './src/account/api';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-dom','motion','motion/*'],loader:{'.css':'empty','.webp':'dataurl'}});
function harness(mobile=false){
 const module={exports:{}},location={pathname:'/',protocol:'https:'};
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),console,crypto,setTimeout,clearTimeout,window:{matchMedia:()=>({matches:mobile}),scrollTo(){}},history:{pushState(_s,_t,path){location.pathname=path;}},location,sessionStorage:{removeItem(){}},localStorage:{getItem:()=>null,setItem(){}},URL,AbortSignal,Response});
 const api=module.exports,project=api.newProject();
 project.clips=[api.normalizeClip({id:'first',assetId:'one',duration:5}),api.normalizeClip({id:'second',assetId:'two',duration:9,start:2,end:8,speed:2})];
 const calls=[];const editor=Object.create(api.Editor.prototype);
 Object.assign(editor,{history:new api.History(project),selected:{track:'audio',id:'audio'},cursor:6,loading:false,exporting:false,tour:{active:false},engine:{pause(){calls.push('pause');}},renderInspector(){calls.push('inspector');},renderTimeline(){calls.push('timeline');},tools:{sync(){calls.push('sync');}},showPanel(panel){calls.push(panel);}});
 return {api,editor,calls,location};
}
test('clicking the preview selects the clip at the playhead without seeking or altering the edit',()=>{
 const {editor,calls}=harness(),before=JSON.stringify(editor.project);
 editor.selectPreview();assert.equal(editor.selected.track,'video');assert.equal(editor.selected.id,'second');assert.equal(editor.cursor,6);
 assert.equal(JSON.stringify(editor.project),before);assert.equal(editor.history.canUndo,false);assert.deepEqual(calls,['pause','inspector','timeline','sync']);
});
test('preview selection handles the last frame and an audio-only tail without selecting the wrong clip',()=>{
 const {editor}=harness();editor.cursor=8;editor.selectPreview();assert.equal(editor.selected.id,'second');
 editor.project.audio=[{...editor.project.clips[0],id:'sound',kind:'audio',at:10}];editor.cursor=12;editor.selected=null;editor.selectPreview();assert.equal(editor.selected,null);
 editor.project.clips=[];editor.selectPreview();assert.equal(editor.selected,null);
});
test('mobile preview selection opens settings, while loading, export and onboarding block selection',()=>{
 const {editor,calls}=harness(true);editor.selectPreview();assert.equal(calls.at(-1),'inspector');
 for(const state of ['loading','exporting','tour']){
  editor.selected=null;if(state==='tour')editor.tour.active=true;else editor[state]=true;
  editor.selectPreview();assert.equal(editor.selected,null);
  if(state==='tour')editor.tour.active=false;else editor[state]=false;
 }
});
test('project-library intent opens the list without creating or replacing a project',()=>{
 const {api,location}=harness(),studio=new api.Studio({});
 studio.setState=(next,done)=>{Object.assign(studio.state,typeof next==='function'?next(studio.state):next);done?.();};
 studio.state.session={user:{id:'member'},accountsEnabled:true};
 const project=api.newProject();studio.state.project=project;studio.state.projects=[project];studio.intent={kind:'projects'};studio.state.auth=true;
 studio.runIntent();assert.equal(studio.state.screen,'projects');assert.equal(location.pathname,'/projects');assert.equal(studio.state.project,project);assert.equal(studio.state.projects.length,1);assert.equal(studio.state.auth,false);
 location.pathname='/projects';studio.state.screen='home';studio.onPop();assert.equal(studio.state.screen,'projects');
});
