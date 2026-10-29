import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({stdin:{contents:"export {OmniAiProvider} from './src/editor/omni';export * from 'test-account';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'browser',plugins:[{name:'controlled-account',setup(b){b.onResolve({filter:/^(?:\.\.\/account\/api|test-account)$/},()=>({path:'account',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`let account={id:'owner'},csrf='session-one',flush=Promise.resolve();export const currentUser=()=>account;export const sessionCsrf=()=>csrf;export const flushProjectSaves=()=>flush;export function setAccount(id,token='session-two'){account=id?{id}:null;csrf=token;}export function setFlush(value){flush=value;}`,loader:'js'}));}}]});
const request={projectId:'p1',project:{clips:[{id:'v1',assetId:'a1'}],audio:[]}};
const analysis={clipId:'v1',assetId:'a1',duration:2,summary:'Фитнес',speech:'Тест',audio:'Голос',events:[],limitations:[]};
const response=()=>new Response(JSON.stringify({plan:null,analysis,summary:'Анализ готов.',usage:{inputTokens:10,outputTokens:20}}),{headers:{'Content-Type':'application/json'}});
function runtime(fetch){const module={exports:{}},window=new EventTarget();vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,fetch,window,AbortController,DOMException,Event,CustomEvent,TextDecoder,Uint8Array,console,setTimeout,clearTimeout});return {...module.exports,window};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('a follow-up uses the previously analyzed source only in the same account and project',async()=>{
 const calls=[],m=runtime(async(_url,init)=>{calls.push(init);return response();}),p=new m.OmniAiProvider();
 await p.createPlan(request,new AbortController().signal,{clipId:'v1',assetId:'a1',mime:'audio/wav',data:'synthetic'});
 await p.createPlan(request,new AbortController().signal);
 assert.equal(JSON.parse(calls[1].body).context.speech,'Тест');assert.equal(calls.length,2);
 m.setAccount('another-user');await p.createPlan(request,new AbortController().signal);
 assert.equal(JSON.parse(calls[2].body).context,null);assert.equal(calls[2].headers['X-PK-Account'],'another-user');
});

test('cancellation while autosave is waiting finishes promptly without sending an AI request',async()=>{
 let calls=0;const pending=deferred(),m=runtime(async()=>{calls++;return response();});m.setFlush(pending.promise);
 const p=new m.OmniAiProvider(),controller=new AbortController(),result=p.createPlan(request,controller.signal);
 controller.abort();
 try{await assert.rejects(Promise.race([result,new Promise((_,reject)=>setTimeout(()=>reject(Error('Did not cancel waiting save')),300))]),/Запрос отменён/);assert.equal(calls,0);}
 finally{pending.resolve();await result.catch(()=>{});}
});

test('switching accounts during an outstanding response aborts transport and never exposes its result',async()=>{
 const pending=deferred();let init,started=deferred();const m=runtime(async(_url,options)=>{init=options;started.resolve();return pending.promise;}),p=new m.OmniAiProvider();
 const result=p.createPlan(request,new AbortController().signal);await started.promise;
 m.window.dispatchEvent(new Event('pokadrovo:before-account-change'));m.setAccount('another-user');
 assert.equal(init.signal.aborted,true);pending.resolve(response());await assert.rejects(result,/отменён|Аккаунт изменился/);
});

test('a CSRF rotation also rejects an old response even when the account ID is the same',async()=>{
 const pending=deferred(),started=deferred();const m=runtime(async()=>{started.resolve();return pending.promise;}),p=new m.OmniAiProvider();
 const result=p.createPlan(request,new AbortController().signal);await started.promise;m.setAccount('owner','rotated');pending.resolve(response());await assert.rejects(result,/Аккаунт изменился/);
});

test('provider JSON errors and expired sessions produce useful errors without storing stale context',async()=>{
 for(const [status,body,pattern] of [[502,'{',/повреждённый ответ/],[503,'null',/503/],[401,'{"error":"Войдите снова."}',/Войдите снова/]]){
  const m=runtime(async()=>new Response(body,{status,headers:{'Content-Type':'application/json'}}));let expired=0;m.window.addEventListener('pokadrovo:session-expired',()=>expired++);
  await assert.rejects(new m.OmniAiProvider().createPlan(request,new AbortController().signal),pattern);assert.equal(expired,status===401?1:0);
 }
});

test('status requests are bound to the account and cannot adopt a status returned after session change',async()=>{
 const pending=deferred();let headers;const m=runtime(async(_url,init)=>{headers=init.headers;return pending.promise;}),p=new m.OmniAiProvider();
 const result=p.getStatus();m.setAccount('another-user');pending.resolve(new Response(JSON.stringify({available:true,reason:'Ready'}),{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(result,/Аккаунт изменился/);assert.equal(headers['X-PK-Account'],'owner');
});
