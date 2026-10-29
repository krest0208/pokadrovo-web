import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {usingAccounts} from './account-fixture.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:`export * from './src/editor/assets';export * from './src/editor/project-backup';export * from './src/account/api';export {newProject,fromAsset,normalizeProject,History} from './src/editor/model';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser'});
function browser({records=new Map(),values=new Map(),storageBlocked=false,failPut=()=>false,fetch=async()=>{throw Error('Unexpected request');}}={}){
 const timers=new Map(),events=[],window=new EventTarget();let timerId=0;
 for(const name of ['pokadrovo:project-storage','pokadrovo:sync-status','pokadrovo:project-fork'])window.addEventListener(name,e=>events.push({name,...e.detail}));
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(defaultStore){const tx={objectStore(store=defaultStore){return {
  put(value,key){queueMicrotask(()=>{if(failPut(store,key)){tx.error=Error('QuotaExceededError');tx.onabort?.();return;}records.set(store+':'+key,structuredClone(value));tx.oncomplete?.();});},
  get(key){const r={};queueMicrotask(()=>{r.result=records.get(store+':'+key);r.onsuccess?.();});return r;},
  getAll(){const r={};queueMicrotask(()=>{r.result=[...records].filter(([key])=>key.startsWith(store+':')).map(([,v])=>v);r.onsuccess?.();});return r;}
 };}};return tx;}};request.onsuccess();});return request;}};
 const module={exports:{}};
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,window,indexedDB,Event,CustomEvent,Blob,File,URL,crypto,TextEncoder,Response,AbortSignal,structuredClone,queueMicrotask,location:{protocol:'https:'},fetch,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){if(storageBlocked)throw Error('QuotaExceededError');values.set(key,value);}}});
 const api=module.exports;api.acceptSession({user:null,csrf:'',providers:[],accountsEnabled:false});
 return {api,records,values,window,events,timers};
}
const account=(id='user-one')=>({user:{id},csrf:'synthetic-csrf',providers:[],accountsEnabled:true});
const asset=(api,id,name='camera.mp4',kind='video')=>({id,name,kind,blob:new Blob(['original bytes: '+id],{type:kind==='video'?'video/mp4':kind==='image'?'image/png':'audio/wav'}),url:'',duration:10,width:100,height:100,thumbnail:''});

test('metadata recovers from IndexedDB after a full or damaged localStorage index, without reading another account',async()=>{
 const a=browser({storageBlocked:true}),p=a.api.newProject();p.name='Kept despite quota';a.api.saveProject(p);await a.api.flushLocalProjects();
 assert.equal(a.api.localSavePending(p.id),false);
 const b=browser({records:a.records,values:new Map([['pokadrovo-projects-v1:account:guest-local','{broken']])});
 assert.equal((await b.api.hydrateProjects())[0].name,'Kept despite quota');
 b.api.acceptSession(account('another-account'));assert.equal((await b.api.hydrateProjects()).length,0);
});

test('complete backup survives an empty browser, preserves unused media, captions, audio, layers and original projects',async()=>{
 const a=browser(),p=a.api.newProject(),video=asset(a.api,'video'),photo=asset(a.api,'photo','photo.png','image'),unused=asset(a.api,'unused','unused.wav','audio');
 for(const source of [video,photo,unused])await a.api.persistAsset(source);
 p.clips=[{...a.api.fromAsset(video),start:2,end:8,speed:1.5},{...a.api.fromAsset(photo),layer:2,at:1,opacity:.6}];
 p.audio=[{...a.api.fromAsset(video),kind:'audio',at:3}];p.texts=[{id:'caption',text:'Проверка',from:1,to:4}];
 p.sources=[video,photo,unused].map(s=>({id:s.id,name:s.name,kind:s.kind,size:s.blob.size}));
 a.api.saveProject(p);const backup=await a.api.createProjectBackup([p]);
 const b=browser();b.api.acceptSession(account('other-device'));const [copy]=await b.api.importProjectBackup(backup);
 assert.notEqual(copy.id,p.id);assert.equal(copy.clips[0].start,2);assert.equal(copy.clips[0].speed,1.5);assert.equal(copy.clips[1].layer,2);assert.equal(copy.clips[1].opacity,.6);
 assert.equal(copy.texts[0].text,'Проверка');assert.equal(copy.audio[0].assetId,copy.clips[0].assetId);assert.equal(copy.sources.length,3);
 assert.equal(await (await b.api.restoreAsset(copy.sources[2].id)).text(),'original bytes: unused');
 assert.equal(b.api.loadProjects().length,1);assert.equal(a.api.loadProjects()[0].id,p.id);
 assert.equal(a.api.loadProjects()[0].clips[0].assetId,'video');
});

test('incomplete and malformed backups fail before publishing any project or overwriting existing media',async()=>{
 const a=browser(),p=a.api.newProject(),source=asset(a.api,'original');p.clips=[a.api.fromAsset(source)];await a.api.persistAsset(source);
 const backup=await a.api.createProjectBackup([p]),b=browser();
 await assert.rejects(b.api.importProjectBackup(backup.slice(0,backup.size-1)),/обрезан/);
 const damaged=new Uint8Array(await backup.arrayBuffer());damaged[damaged.length-1]^=1;
 await assert.rejects(b.api.importProjectBackup(new Blob([damaged])),/Повреждён исходник/);
 assert.equal(b.records.size,0);assert.equal(b.api.loadProjects().length,0);
 await assert.rejects(b.api.importProjectBackup(new Blob(['{}'])),/Некорректный/);
 await assert.rejects(b.api.createProjectBackup([p]),/Не найден исходник/);
});

test('legacy JSON import creates a copy and keeps the existing edit; unavailable source references are retained',async()=>{
 const b=browser(),p=b.api.newProject();p.clips=[b.api.fromAsset(asset(b.api,'absent'))];b.api.saveProject(p);
 const [copy]=await b.api.importProjectBackup(new Blob([JSON.stringify(p)]));
 assert.notEqual(copy.id,p.id);assert.equal(copy.clips[0].assetId,'absent');assert.equal(b.api.loadProjects().length,2);
});

test('failed metadata sync retries the latest change on reconnect and does not send guest media',async()=>{
 let online=false;const sent=[];const b=browser({fetch:async(_url,options)=>{if(!online)throw Error('offline');sent.push(JSON.parse(options.body));return new Response(JSON.stringify({revision:'a'.repeat(64)}));}});
 b.api.acceptSession(account());const p=b.api.newProject();b.api.saveProject(p);await b.api.flushProjectSaves();
 p.name='Latest offline edit';p.modified++;b.api.saveProject(p);await b.api.flushProjectSaves();
 assert.equal(sent.length,0);online=true;b.window.dispatchEvent(new Event('online'));await b.api.flushProjectSaves();
 assert.equal(sent.length,1);assert.equal(sent[0].project.name,'Latest offline edit');assert.equal(sent[0].baseRevision,null);
 assert.equal(JSON.parse(b.values.get('pokadrovo-project-outbox-v1:user-one')).length,0);
});

test('an unsent edit retries after reload against its remembered revision; a changed remote version is copied',async()=>{
 const a=browser({fetch:async()=>{throw Error('offline');}});a.api.acceptSession(account());const p=a.api.newProject();
 a.api.reconcileProjectSaves([p],[p],{[p.id]:'a'.repeat(64)});p.name='Offline work';p.modified++;a.api.saveProject(p);await a.api.flushLocalProjects();await a.api.flushProjectSaves();
 const sent=[],b=browser({records:a.records,values:a.values,fetch:async(_url,options)=>{sent.push(JSON.parse(options.body));return new Response(JSON.stringify({revision:'b'.repeat(64)}));}});b.api.acceptSession(account());
 const local=await b.api.hydrateProjects(),remote={...p,name:'Original',modified:p.modified-1};b.api.reconcileProjectSaves(local,[remote],{[p.id]:'a'.repeat(64)});await b.api.flushProjectSaves();
 assert.equal(sent.length,1);assert.equal(sent[0].baseRevision,'a'.repeat(64));
 // A second offline edit sees a genuinely different remote revision on its next reload.
 const c=browser({records:b.records,values:b.values,fetch:async()=>{throw Error('offline');}});c.api.acceptSession(account());const pending={...p,name:'Another offline edit',modified:p.modified+1};c.api.saveProject(pending);await c.api.flushLocalProjects();await c.api.flushProjectSaves();
 const sent2=[],d=browser({records:c.records,values:c.values,fetch:async(_url,options)=>{sent2.push(JSON.parse(options.body));return new Response(JSON.stringify({revision:'d'.repeat(64)}));}});d.api.acceptSession(account());
 d.api.reconcileProjectSaves(await d.api.hydrateProjects(),[{...p,name:'Remote work'}],{[p.id]:'c'.repeat(64)});await d.api.flushProjectSaves();
 const fork=sent2.find(s=>s.project.id!==p.id);assert.ok(fork);assert.equal(fork.project.name,'Another offline edit (копия)');assert.ok(!sent2.some(s=>s.project.id===p.id));
 assert.ok(d.api.loadProjects().some(p=>p.name==='Remote work'));
});

test('queued saves cannot cross an account switch and unsent recovery never reads another account outbox',async()=>{
 const sent=[],b=browser({fetch:async(_url,o)=>{sent.push(o.headers['X-PK-Account']);return new Response(JSON.stringify({revision:'a'.repeat(64)}));}});b.api.acceptSession(account());b.api.saveProject(b.api.newProject());b.api.acceptSession(account('second-user'));await b.api.flushProjectSaves();assert.equal(sent.length,0);
 b.api.retryProjectSaves();await b.api.flushProjectSaves();assert.equal(sent.length,0);
 b.api.acceptSession(account());b.api.retryProjectSaves();await b.api.flushProjectSaves();assert.deepEqual(sent,['user-one']);
});

test('a conflict with full local stores keeps the original durable draft until its separate copy is durable',async()=>{
 const a=browser();a.api.acceptSession(account());const p=a.api.newProject();p.name='Local work';a.api.saveProject(p);await a.api.flushLocalProjects();await a.api.flushProjectSaves();
 const b=browser({records:a.records,values:a.values,storageBlocked:true,failPut:(store,key)=>store==='projects'&&key!=='user-one:'+p.id});b.api.acceptSession(account());
 b.api.reconcileProjectSaves(await b.api.hydrateProjects(),[{...p,name:'Remote work'}],{[p.id]:'a'.repeat(64)});await b.api.flushLocalProjects();
 assert.equal(b.records.get('projects:user-one:'+p.id).project.name,'Local work');
 assert.ok(b.api.loadProjects().some(v=>v.id!==p.id&&v.name==='Local work (копия)'));
});

test('pre-debounce drafts are queued durably, duplicate saves are coalesced, and a stale GET cannot undo an acknowledged revision',async()=>{
 const sent=[],b=browser({fetch:async(_url,o)=>{sent.push(JSON.parse(o.body));return new Response(JSON.stringify({revision:'a'.repeat(64)}));}});b.api.acceptSession(account());const p=b.api.newProject();
 b.api.saveProject(p,false);assert.ok(JSON.parse(b.values.get('pokadrovo-project-outbox-v1:user-one')).includes(p.id));assert.equal(sent.length,0);
 b.api.syncProject(p);await b.api.flushProjectSaves();b.api.syncProject(p);await b.api.flushProjectSaves();assert.equal(sent.length,1);
 b.api.reconcileProjectSaves([p],[{...p,name:'Older',modified:p.modified-1}],{[p.id]:'0'.repeat(64)});await b.api.flushProjectSaves();
 p.name='Next edit';p.modified++;b.api.saveProject(p);await b.api.flushProjectSaves();assert.equal(sent.at(-1).baseRevision,'a'.repeat(64));
});

test('source metadata survives removing the last clip and an undo/redo retains monotonic edit timestamps',()=>{
 const b=browser(),p=b.api.newProject();p.clips=[b.api.fromAsset(asset(b.api,'camera'))];const h=new b.api.History(b.api.normalizeProject(p));h.commit({...h.value,clips:[]});assert.equal(h.value.sources[0].id,'camera');const stamp=h.value.modified;h.commit({...h.value,name:'changed'});assert.ok(h.value.modified>stamp);
});

test('server revisions reject stale and legacy overwrites, allow idempotent retries, and remain isolated by account',()=>usingAccounts(async f=>{
 await f.owner('/api/account/session');
 const p={id:'revision-test',schema:4,name:'Initial',mode:'video',ratio:'16:9',clips:[],audio:[],texts:[],created:1,modified:2,master:1,sources:[{id:'unused-source',name:'camera.mp4',kind:'video',size:14,url:'not-stored'}]};
 const created=await f.owner('/api/account/projects','PUT',{project:p,baseRevision:null});assert.equal(created.status,200);assert.match(created.data.revision,/^[a-f0-9]{64}$/);
 const listed=await f.owner('/api/account/projects');assert.equal(listed.data.revisions[p.id],created.data.revision);assert.equal(listed.data.projects[0].sources[0].url,undefined);
 const changed={...p,name:'Newer version',modified:3};const updated=await f.owner('/api/account/projects','PUT',{project:changed,baseRevision:created.data.revision});assert.equal(updated.status,200);
 assert.equal((await f.owner('/api/account/projects','PUT',{project:changed,baseRevision:created.data.revision})).status,200);
 const stale=await f.owner('/api/account/projects','PUT',{project:p,baseRevision:created.data.revision});assert.equal(stale.status,409);assert.equal(stale.data.project.name,'Newer version');
 assert.equal((await f.owner('/api/account/projects','PUT',{project:p})).status,409);
 assert.equal((await f.guest('/api/account/projects')).status,401);
 assert.equal((await f.owner('/api/account/projects')).data.projects[0].name,'Newer version');
}));
