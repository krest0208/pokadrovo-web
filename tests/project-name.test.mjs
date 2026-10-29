import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const compiled=await build({stdin:{contents:"export {Editor} from './src/editor/editor';export {History,normalizeProject,clone} from './src/editor/model';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'empty'},plugins:[{name:'isolated-editor-storage',setup(b){
 b.onResolve({filter:/^\.\/assets$/},args=>args.importer.endsWith('/editor/editor.ts')?{path:'assets',namespace:'qa-storage'}:null);
 b.onLoad({filter:/.*/,namespace:'qa-storage'},()=>({contents:'export const download=()=>{};export const inspectFile=async()=>{};export const persistAsset=async()=>{};export const localSavePending=()=>false;export const unsavedAssets=()=>0;export const retryAssetWrites=async()=>{};export const requestPersistentStorage=async()=>false;export function saveProject(p){globalThis.savedProjects.push(structuredClone(p));}'}));
 b.onResolve({filter:/^\.\.\/account\/api$/},args=>args.importer.endsWith('/editor/editor.ts')?{path:'scope',namespace:'qa-scope'}:null);
 b.onLoad({filter:/.*/,namespace:'qa-scope'},()=>({contents:"export const storageScope=()=> 'guest-local';"}));
}}]});
const module={exports:{}},savedProjects=[];
vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),console,process,structuredClone,setTimeout,clearTimeout,Blob,URL,savedProjects});
const {Editor,History,normalizeProject,clone}=module.exports;
function editor(){
 const e=Object.create(Editor.prototype);e.history=new History(normalizeProject({id:'name-test',name:'Before',clips:[],audio:[],texts:[]}));e.account='guest-local';e.autosaveTimer=null;e.pendingName=null;e.disposed=false;e.exporting=false;e.cursor=0;
 e.opts={onSave:()=>{}};e.status=()=>{};e.render=()=>{};e.prepare=async()=>{};e.engine={pause:()=>{}};e.tools={beforeAction:()=>{}};
 return e;
}

test('save before blur persists the typed name and keeps it as one undoable change',()=>{
 const e=editor();e.input({target:{dataset:{project:'name'},value:'Typed without leaving the field',type:'text'}});e.save(false);
 assert.equal(savedProjects.at(-1).name,'Typed without leaving the field');assert.equal(e.project.name,'Typed without leaving the field');assert.equal(e.history.undo().name,'Before');
});
test('another project action cannot overwrite an unblurred name draft',()=>{
 const e=editor();e.input({target:{dataset:{project:'name'},value:'Keep this name',type:'text'}});const p=clone(e.project);p.ratio='9:16';e.commit(p);e.save(false);
 assert.equal(savedProjects.at(-1).name,'Keep this name');assert.equal(savedProjects.at(-1).ratio,'9:16');
});
test('typing a name autosaves it without requiring blur',async()=>{
 const e=editor();e.input({target:{dataset:{project:'name'},value:'Autosaved name',type:'text'}});await new Promise(r=>setTimeout(r,550));assert.equal(savedProjects.at(-1).name,'Autosaved name');
});

test('navigation flush exposes the current name before the parent reads project state',()=>{
 const e=editor();e.input({target:{dataset:{project:'name'},value:'Name before navigation',type:'text'}});const project=e.flushPendingChanges();assert.equal(project.name,'Name before navigation');assert.equal(savedProjects.at(-1).name,'Name before navigation');
});
