import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const compiled=await build({absWorkingDir:root,stdin:{contents:"export * from './src/preview/assets';export * from './src/preview/storage';export {newProject} from './src/editor/model';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',plugins:[{name:'no-live-api',setup(b){b.onResolve({filter:/account\/api$/},()=>({path:resolve(root,'src/preview/account-stub.ts')}));}}]});
function load(storage=new Map(),blocked=false){
  const module={exports:{}};
  const context=vm.createContext({module,exports:module.exports,Blob,URL,Event,CustomEvent,window:new EventTarget(),setTimeout,clearTimeout,
    localStorage:{getItem(key){if(blocked)throw Error('Storage denied');return storage.get(key)??null;},setItem(key,value){if(blocked)throw Error('Storage denied');storage.set(key,value);}}});
  vm.runInContext(compiled.outputFiles[0].text,context);return module.exports;
}
test('guest projects persist across preview sessions without touching account/owner storage',()=>{
  const storage=new Map([['pokadrovo-projects-v1:account:owner','private owner content']]);const first=load(storage);
  const project=first.newProject('reels','Keep this brief');first.saveProject(project);
  const second=load(storage);assert.equal(second.loadProjects()[0].brief,'Keep this brief');assert.equal(second.loadProjects()[0].ratio,'9:16');
  assert.equal(storage.get('pokadrovo-projects-v1:account:owner'),'private owner content');
  assert.ok([...storage.keys()].filter(k=>k!=='pokadrovo-projects-v1:account:owner').every(k=>k.startsWith('pokadrovo.chat-preview.v1:')));
});
test('an iframe with blocked localStorage and IndexedDB still edits and retains media during the session',async()=>{
  const preview=load(new Map(),true),project=preview.newProject('video');preview.saveProject(project);
  project.name='Updated';preview.saveProject(project);assert.equal(preview.loadProjects().length,1);assert.equal(preview.loadProjects()[0].name,'Updated');assert.equal(preview.previewStorage.durable,false);
  const blob=new Blob(['test media'],{type:'video/webm'});await preview.persistAsset({id:'sample',blob});assert.equal(await preview.restoreAsset('sample'),blob);assert.equal(await preview.restoreAsset('missing'),undefined);
});
test('malformed preview data is isolated and does not prevent starting a new project',()=>{
  const storage=new Map([['pokadrovo.chat-preview.v1:projects','{broken']]);const preview=load(storage);assert.equal(preview.loadProjects().length,0);
  preview.saveProject(preview.newProject('reels'));assert.equal(preview.loadProjects().length,1);
});
