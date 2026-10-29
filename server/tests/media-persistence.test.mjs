import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:`export * from './src/editor/assets';export * from './src/editor/media-recovery';export {Editor} from './src/editor/editor';export {newProject,fromAsset,History} from './src/editor/model';export {acceptSession} from './src/account/api';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',loader:{'.css':'empty'}});

// File retains its read-only name, as it does after an IndexedDB structured clone in browsers.
function browser(records=new Map(),values=new Map()){
 class Video extends EventTarget {
  duration=10;videoWidth=1920;videoHeight=1080;src='';onloadeddata=null;
  load(){if(this.src)queueMicrotask(()=>this.onloadeddata?.());}
  pause(){} removeAttribute(name){if(name==='src')this.src='';}
 }
 const document={createElement(kind){if(kind==='video'||kind==='audio')return new Video();if(kind==='canvas')return {getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AA=='};throw Error('Unexpected element '+kind);}};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){const tx={objectStore(){return {
  put(value,key){queueMicrotask(()=>{records.set(key,value);tx.oncomplete?.();});},
  get(key){const read={};queueMicrotask(()=>{read.result=records.get(key);read.onsuccess?.();});return read;}
 };}};return tx;}};request.onsuccess();});return request;}};
 const module={exports:{}};
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,window:new EventTarget(),document,indexedDB,HTMLVideoElement:Video,Event,CustomEvent,Blob,File,URL,crypto,setTimeout,clearTimeout,queueMicrotask,location:{protocol:'https:'},fetch(){throw Error('Guest media must not be uploaded');},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}});
 const api=module.exports;api.acceptSession({user:null,csrf:'',providers:[],accountsEnabled:false});
 return {api,records,values};
}

test('stored read-only File sources reopen with new object URLs and their saved clip names',async()=>{
 const a=browser(),file=new File(['original bytes'],'camera.mp4',{type:'video/mp4'});
 assert.throws(()=>Object.assign(file,{name:'Renamed source'}),TypeError);
 const asset=await a.api.inspectFile(file,'original');await a.api.persistAsset(asset);
 const project=a.api.newProject();project.clips=[{...a.api.fromAsset(asset),name:'Renamed source'}];a.api.saveProject(project);
 URL.revokeObjectURL(asset.url);
 const b=browser(a.records,a.values),opened=b.api.loadProjects()[0],assets=new Map();
 assert.equal((await b.api.restoreProjectAssets(opened,assets)).length,0);
 assert.equal(assets.size,1);assert.equal(assets.get('original').name,'Renamed source');
 assert.equal(await assets.get('original').blob.text(),'original bytes');assert.equal(file.name,'camera.mp4');
 URL.revokeObjectURL(assets.get('original').url);
});

test('a missing first source does not stop other sources or remove timeline references',async()=>{
 const b=browser(),file=new File(['second'],'second.mp4',{type:'video/mp4'}),asset=await b.api.inspectFile(file,'second');
 await b.api.persistAsset(asset);URL.revokeObjectURL(asset.url);
 const project=b.api.newProject(),good=b.api.fromAsset(asset);project.clips=[{...good,id:'missing-clip',assetId:'missing',name:'missing.mp4'},good];
 const assets=new Map(),missing=await b.api.restoreProjectAssets(project,assets);
 assert.equal(missing.join(','),'missing.mp4');assert.equal(assets.size,1);assert.equal(project.clips.length,2);
 URL.revokeObjectURL(assets.get('second').url);
});

test('account isolation and cancelled recovery never populate another account with previous sources',async()=>{
 const b=browser(),asset=await b.api.inspectFile(new File(['private'],'private.mp4',{type:'video/mp4'}),'private');
 await b.api.persistAsset(asset);URL.revokeObjectURL(asset.url);
 const project=b.api.newProject();project.clips=[b.api.fromAsset(asset)];
 let current=true;const assets=new Map(),pending=b.api.restoreProjectAssets(project,assets,()=>current);current=false;await pending;assert.equal(assets.size,0);
 b.api.acceptSession({user:{id:'other-user'},csrf:'',providers:[],accountsEnabled:true});
 assert.equal(await b.api.restoreAsset('private'),undefined);
});

function editorHarness(b,onSave=()=>{}){
 const e=Object.create(b.api.Editor.prototype);
 Object.assign(e,{account:'guest-local',disposed:false,loading:false,importing:false,exporting:false,autosaveTimer:null,cursor:0,
  history:new b.api.History(b.api.newProject()),opts:{assets:new Map(),onSave},engine:{pause(){}},render(){},prepare:async()=>{},status(){}});
 return e;
}

test('leaving during a multi-file import keeps every completed source and its project metadata',async()=>{
 const b=browser();let e;
 e=editorHarness(b,()=>{e.disposed=true;});
 await e.importFiles([new File(['one'],'one.mp4',{type:'video/mp4'}),new File(['two'],'two.mp4',{type:'video/mp4'})]);
 const saved=b.api.loadProjects()[0];assert.equal(saved.clips.length,1);assert.equal(saved.clips[0].name,'one.mp4');
 assert.equal(await (await b.api.restoreAsset(saved.clips[0].assetId)).text(),'one');
 for(const asset of e.opts.assets.values())URL.revokeObjectURL(asset.url);
});

test('editing is cached synchronously before navigation, and delayed saves cannot cross accounts',()=>{
 const b=browser(),e=editorHarness(b);e.commit({...e.project,name:'Saved before leaving'});
 assert.equal(browser(b.records,b.values).api.loadProjects()[0].name,'Saved before leaving');
 b.api.acceptSession({user:{id:'other-user'},csrf:'',providers:[],accountsEnabled:true});
 e.save(false);assert.equal(b.values.has('pokadrovo-projects-v1:account:other-user'),false);
 assert.equal(e.autosaveTimer,null);
});

test('the project library keeps unused current sources without showing media from the previous project',async()=>{
 const b=browser(),e=editorHarness(b),current=await b.api.inspectFile(new File(['current'],'current.mp4',{type:'video/mp4'}),'current'),previous=await b.api.inspectFile(new File(['previous'],'previous.mp4',{type:'video/mp4'}),'previous');
 e.tab='media';e.opts.assets.set(current.id,current);e.opts.assets.set(previous.id,previous);
 e.project.sources.push({id:current.id,name:current.name,kind:current.kind,size:current.blob.size});const host={innerHTML:''};e.root={querySelector:()=>host};
 e.renderLibrary();assert.match(host.innerHTML,/current\.mp4/);assert.doesNotMatch(host.innerHTML,/previous\.mp4/);assert.equal(e.project.clips.length,0);
 URL.revokeObjectURL(current.url);URL.revokeObjectURL(previous.url);
});
