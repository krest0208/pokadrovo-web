import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const compiled=await build({absWorkingDir:root,stdin:{contents:"export * from './src/editor/assets';export {acceptSession,flushProjectSaves} from './src/account/api';export {newProject} from './src/editor/model';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser'});
test('guest projects survive reload without reading owner projects or sending metadata to the server',async()=>{
 const values=new Map([['pokadrovo-projects-v1:account:owner','private owner data']]);let networkCalls=0;
 const load=()=>{const module={exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,window:new EventTarget(),Event,CustomEvent,Blob,URL,setTimeout,clearTimeout,location:{protocol:'https:'},fetch(){networkCalls++;throw Error('Guest data must remain local');},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});return module.exports;};
 const a=load();assert.equal(a.loadProjects().length,0);a.acceptSession({user:null,csrf:'',providers:[],accountsEnabled:false});
 const project=a.newProject('reels','Guest brief');a.saveProject(project);await a.flushProjectSaves();
 const b=load();b.acceptSession({user:null,csrf:'',providers:[],accountsEnabled:false});assert.equal(b.loadProjects()[0].brief,'Guest brief');
 b.acceptSession({user:null,csrf:'public-csrf',providers:[],accountsEnabled:true,guestEditingEnabled:true});assert.equal(b.loadProjects()[0].brief,'Guest brief');
 b.acceptSession({user:{id:'new-user'},csrf:'user-csrf',providers:[],accountsEnabled:true,guestEditingEnabled:true});assert.equal(b.loadProjects().length,0);
 b.acceptSession({user:null,csrf:'public-csrf',providers:[],accountsEnabled:true,guestEditingEnabled:true});assert.equal(b.loadProjects()[0].brief,'Guest brief');
 assert.equal(values.get('pokadrovo-projects-v1:account:owner'),'private owner data');assert.equal(networkCalls,0);
 b.acceptSession({user:null,csrf:'',providers:[],accountsEnabled:true});assert.equal(b.loadProjects().length,0);
});
