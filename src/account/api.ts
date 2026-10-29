import {normalizeProject} from '../editor/model';
export type User = { id:string; name:string; email:string|null; emailVerified:boolean; role:'user'|'owner'; created:number; passwordSet:boolean };
export type Provider = { id:'google'|'facebook'|'instagram'; ready:boolean; professionalOnly:boolean; note:string };
export type LegalState = { registrationReady?:boolean;ready:boolean;salesReady:boolean;version:string;edition:string;links:Record<string,string>};
export type Session = { mail?:{enabled:boolean}; recoveryCode?:string; legal?:LegalState; user:User|null; csrf:string; providers:Provider[]; accountsEnabled?:boolean; guestEditingEnabled?:boolean; socialLoginEnabled?:boolean; adminPath?:string };
let active:Session|null=null;
export class AccountError extends Error { constructor(message:string,public status:number,public totpRequired=false,public data:Record<string,unknown>={}){super(message);} }
export const currentUser=()=>active?.user||null;
export const sessionCsrf=()=>active?.csrf||'';
export const storageScope=()=>active?.user?.id||(active?.accountsEnabled===false||active?.guestEditingEnabled===true?'guest-local':null);
export function acceptSession(session:Session){const {recoveryCode,...safe}=session;const next=session.user?.id||(session.accountsEnabled===false||session.guestEditingEnabled===true?'guest-local':null);if(active&&next!==storageScope())window.dispatchEvent(new Event('pokadrovo:before-account-change'));active=safe;return session;}
export async function request<T=Record<string,unknown>>(path:string,method='GET',data?:unknown):Promise<T>{
 if(location.protocol==='file:')throw new AccountError('Регистрация и админ-панель работают через локальный сервер. Запустите start-local и откройте localhost:5173.',503);
 const headers:Record<string,string>={'Accept':'application/json'};
 if(method!=='GET') {headers['Content-Type']='application/json';headers['X-CSRF-Token']=active?.csrf||'';}
 if(path.startsWith('/projects')||path.startsWith('/agent'))headers['X-PK-Account']=active?.user?.id||'';
 let response:Response;
 const payload=data===undefined?undefined:JSON.stringify(data),accountAtStart=storageScope();
 try {response=await fetch('/api/account'+path,{method,headers,credentials:'same-origin',body:payload,keepalive:path==='/projects'&&method==='PUT'&&!!payload&&new Blob([payload]).size<60000,signal:AbortSignal.timeout(20000)});}
 catch {throw new AccountError('Нет связи с сервером. Проверьте подключение к интернету и повторите.',503);}
 let value:Record<string,unknown>;try{value=await response.json();}catch{throw new AccountError('Сервис регистрации временно недоступен. Попробуйте ещё раз позже.',503);}
 if(!response.ok){
  if(response.status===401&&storageScope()===accountAtStart&&!['/login','/register'].includes(path))window.dispatchEvent(new Event('pokadrovo:session-expired'));
  throw new AccountError(typeof value.error==='string'?value.error:'Не удалось выполнить запрос.',response.status,value.totpRequired===true,value);
 }
 return value as T;
}
export async function getSession(){return acceptSession(await request<Session>('/session'));}
export async function signIn(email:string,password:string,code?:string){return acceptSession(await request<Session>('/login','POST',{email,password,code}));}
export async function register(email:string,password:string,confirmPassword:string,acceptPrivacy:boolean,acceptTerms:boolean,adultConfirmed:boolean,legalVersion:string){return acceptSession(await request<Session>('/register','POST',{email,password,confirmPassword,acceptPrivacy,acceptTerms,adultConfirmed,legalVersion}));}
export async function recoverAccount(email:string,recoveryCode:string,newPassword:string,confirmPassword:string){return request<{ok:boolean;recoveryCode:string}>('/recover','POST',{email,recoveryCode,newPassword,confirmPassword});}
export async function logout(){await request('/logout','POST',{});active=null;return getSession();}
export async function socialLogin(provider:Provider['id']){const result=await request<{url:string}>('/oauth/'+provider,'POST',{});const url=new URL(result.url);if(url.protocol!=='https:'||!['accounts.google.com','www.facebook.com','www.instagram.com'].includes(url.hostname))throw Error('Некорректный адрес входа.');window.location.assign(url.href);}
type Document={id:string;modified:number;name:string;[key:string]:unknown};
type Pending={account:string;project:Document};
let saves=Promise.resolve(),retryTimer:ReturnType<typeof setTimeout>|undefined,retryDelay=5000;
const pending=new Map<string,Pending>(),revisions=new Map<string,string|null>(),blocked=new Set<string>(),acknowledged=new Map<string,string>();
const projectKey=(account:string,id:string)=>account+':'+id;
const outboxKey=(account:string)=>'pokadrovo-project-outbox-v1:'+account;
const revisionKey=(account:string)=>'pokadrovo-project-revisions-v1:'+account;
function rememberedRevision(account:string,id:string):string|null|undefined{try{const values=JSON.parse(localStorage.getItem(revisionKey(account))||'{}'),value=Object.hasOwn(values,id)?values[id]:undefined;return value===null||typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:undefined;}catch{return undefined;}}
function rememberRevision(account:string,id:string,revision:string|null){revisions.set(projectKey(account,id),revision);try{const values=JSON.parse(localStorage.getItem(revisionKey(account))||'{}');values[id]=revision;localStorage.setItem(revisionKey(account),JSON.stringify(values));}catch{}}
function markPending(account:string,id:string,remove=false){try{const ids=new Set<string>(JSON.parse(localStorage.getItem(outboxKey(account))||'[]'));remove?ids.delete(id):ids.add(id);localStorage.setItem(outboxKey(account),JSON.stringify([...ids].slice(-200)));}catch{}}
function pendingIds(account:string):string[]{try{const value=JSON.parse(localStorage.getItem(outboxKey(account))||'[]');return Array.isArray(value)?value.filter(x=>typeof x==='string'):[];}catch{return [];}}
function syncStatus(account:string,id:string,state:string,message:string){if(storageScope()===account)window.dispatchEvent(new CustomEvent('pokadrovo:sync-status',{detail:{account,id,state,message}}));}
/** Only metadata is sent. Failed saves stay in a durable outbox and never cross accounts. */
export function stageProject(project:unknown){
 const account=storageScope();if(!account||!currentUser())return;
 const snapshot=JSON.parse(JSON.stringify(project)) as Document,key=projectKey(account,snapshot.id);
 const signature=JSON.stringify(snapshot);if(acknowledged.get(key)===signature&&!pending.has(key))return;
 if(!revisions.has(key))revisions.set(key,rememberedRevision(account,snapshot.id)??null);
 if(JSON.stringify(pending.get(key)?.project)!==signature)pending.set(key,{account,project:snapshot});markPending(account,snapshot.id);syncStatus(account,snapshot.id,'saving','Синхронизирую монтаж…');
}
export function syncProject(project:unknown){stageProject(project);enqueueSaves();}
function enqueueSaves(){saves=saves.catch(()=>{}).then(drainSaves);}
async function drainSaves(){
 for(const [key,item] of pending){
  if(storageScope()!==item.account||!currentUser()||blocked.has(key))continue;
  try{
   if(storageScope()!==item.account)return;
   const r=await request<{revision:string}>('/projects','PUT',{project:item.project,baseRevision:revisions.get(key)});
   rememberRevision(item.account,item.project.id,r.revision);acknowledged.set(key,JSON.stringify(item.project));retryDelay=5000;
   if(pending.get(key)===item){pending.delete(key);markPending(item.account,item.project.id,true);syncStatus(item.account,item.project.id,'saved','Монтаж сохранён на сервере. Исходники сохранены на устройстве.');}
  }catch(error){
   if(storageScope()!==item.account)return;
   if(error instanceof AccountError&&error.status===409&&Object.hasOwn(error.data,'revision')){
    const local=pending.get(key)?.project||item.project;blocked.add(key);pending.delete(key);rememberRevision(item.account,item.project.id,null);
    window.dispatchEvent(new CustomEvent('pokadrovo:project-conflict',{detail:{account:item.account,local,remote:error.data.project,revision:error.data.revision}}));
    syncStatus(item.account,item.project.id,'conflict','Есть другая версия проекта. Ваши изменения открыты отдельной копией.');
   }else{
    const rejected=error instanceof AccountError&&[400,401,403,409].includes(error.status);
    syncStatus(item.account,item.project.id,rejected?'error':'offline',rejected?'Монтаж сохранён на устройстве. Сервер не принял синхронизацию: '+error.message:'Монтаж сохранён на устройстве. Синхронизация повторится после восстановления связи.');
    if(!(error instanceof AccountError&&[400,401,403,409].includes(error.status))&&!retryTimer){retryTimer=setTimeout(()=>{retryTimer=undefined;enqueueSaves();},retryDelay);retryDelay=Math.min(60000,retryDelay*2);}
    break;
   }
  }
 }
}
/** Called after loading local and server libraries, before any editor can write. */
export function reconcileProjectSaves(local:unknown[],remote:unknown[],remoteRevisions:Record<string,string>={}){
 const account=storageScope();if(!account||!currentUser())return;
 const indexed=new Map((remote as Document[]).map(p=>[p.id,p])),unsent=new Set(pendingIds(account));
 const baselines=new Map((local as Document[]).map(p=>[p.id,revisions.get(projectKey(account,p.id))??rememberedRevision(account,p.id)]));
 for(const p of remote as Document[]){const key=projectKey(account,p.id),localVersion=(local as Document[]).find(v=>v.id===p.id);blocked.delete(key);
  // A GET started before an acknowledged PUT must not downgrade that PUT's baseline.
  if(localVersion&&localVersion.modified>p.modified&&acknowledged.get(key)===JSON.stringify(localVersion))continue;
  rememberRevision(account,p.id,remoteRevisions[p.id]??null);
 }
 for(const p of local as Document[]){const key=projectKey(account,p.id),r=indexed.get(p.id);if(!r)revisions.set(key,null);if(!blocked.has(key)&&(!r||unsent.has(p.id)||p.modified>r.modified)){
   // A pending document changed elsewhere must be copied rather than overwrite the remote version.
   if(r&&unsent.has(p.id)&&baselines.get(p.id)!==remoteRevisions[p.id]&&JSON.stringify(normalizeProject(r))!==JSON.stringify(normalizeProject(p))){blocked.add(key);rememberRevision(account,p.id,null);pending.delete(key);window.dispatchEvent(new CustomEvent('pokadrovo:project-conflict',{detail:{account,local:p,remote:r,revision:remoteRevisions[p.id]}}));}
   else syncProject(p);
  }}
}
export function retryProjectSaves(){if(retryTimer){clearTimeout(retryTimer);retryTimer=undefined;}enqueueSaves();}
export function completeProjectConflict(account:string,id:string,revision:string|null){if(storageScope()!==account)return;const key=projectKey(account,id);blocked.delete(key);pending.delete(key);markPending(account,id,true);rememberRevision(account,id,revision);}
if(typeof window!=='undefined')window.addEventListener?.('online',retryProjectSaves);
export const flushProjectSaves=()=>saves;
