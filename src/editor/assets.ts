import { storageScope, syncProject,stageProject,completeProjectConflict } from '../account/api';
import { Asset, Project, STORAGE_KEY, normalizeProject, uid } from './model';
export async function openDb():Promise<IDBDatabase>{if(typeof indexedDB==='undefined')throw Error('Хранилище браузера недоступно.');return new Promise((ok,no)=>{
 let ended=false;const timer=setTimeout(()=>{ended=true;no(Error('Хранилище занято. Закройте другие вкладки Покадрово и повторите сохранение.'));},5000);
 const req=indexedDB.open('pokadrovo-media-v1',2);req.onupgradeneeded=()=>{for(const name of ['files','projects'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};
 req.onsuccess=()=>{if(ended){req.result.close();return;}clearTimeout(timer);req.result.onversionchange=()=>req.result.close();ok(req.result);};req.onerror=()=>{clearTimeout(timer);no(req.error);};
});}
function scope(){const id=storageScope();if(!id)throw Error('Войдите в аккаунт для работы с проектами.');return id;}
function cacheKey(){return STORAGE_KEY+':account:'+scope();}
const failedAssets=new Set<string>();
export const unsavedAssets=(account=storageScope())=>[...failedAssets].filter(key=>key.startsWith(account+':')).length;
export async function persistAsset(a:Asset){const key=scope()+':'+a.id;failedAssets.add(key);const db=await openDb();try{await new Promise<void>((ok,no)=>{
 const tx=db.transaction('files','readwrite');tx.objectStore('files').put(a.blob,key);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);
});failedAssets.delete(key);}finally{db.close();}}
export async function retryAssetWrites(assets:Map<string,Asset>){for(const a of assets.values())if(failedAssets.has(scope()+':'+a.id))await persistAsset(a);}
/** Publish a restored bundle atomically; quota errors cannot leave half a project behind. */
export async function persistProjectBundle(projects:Project[],assets:Asset[],account:string){
 const db=await openDb();try{
  if(scope()!==account)throw Error('Аккаунт изменился. Повторите импорт.');
  await new Promise<void>((ok,no)=>{const tx=db.transaction(['files','projects'],'readwrite');
   for(const a of assets)tx.objectStore('files').put(a.blob,account+':'+a.id);
   for(const p of projects)tx.objectStore('projects').put({account,project:p},account+':'+p.id);
   tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);
  });
 }catch(e){if((e as Error)?.name==='QuotaExceededError')throw Error('Недостаточно места в браузере для исходников. Освободите место и откройте полную копию снова.');throw e;}finally{db.close();}
}
export async function requestPersistentStorage(){try{return await navigator.storage?.persist?.()||false;}catch{return false;}}
export async function restoreAsset(id:string):Promise<Blob|undefined>{const account=scope(),key=account+':'+id;const db=await openDb();try{const read=(key:string)=>new Promise<Blob|undefined>((ok,no)=>{const r=db.transaction('files').objectStore('files').get(key);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});return await read(key)||(account==='owner'?await read(id):undefined);}finally{db.close();}}
export function loadProjects():Project[]{
 if(!storageScope())return [];const found=new Map<string,Project>();
 for(const p of memory.get(scope())||[])found.set(p.id,p);
 try{const arr=JSON.parse(localStorage.getItem(cacheKey())||'[]');if(Array.isArray(arr))for(const raw of arr){const p=normalizeProject(raw),old=found.get(p.id);if(!old||p.modified>old.modified)found.set(p.id,p);}}catch{/* IndexedDB and the latest draft can recover a damaged index. */}
 try{const raw=localStorage.getItem(cacheKey()+':draft');if(raw){const p=normalizeProject(JSON.parse(raw)),old=found.get(p.id);if(!old||p.modified>old.modified)found.set(p.id,p);}}catch{}
 return [...found.values()].sort((a,b)=>b.modified-a.modified);
}
const memory=new Map<string,Project[]>();let localWrites=Promise.resolve();const pendingLocal=new Map<string,symbol>();
export const flushLocalProjects=()=>localWrites;
export const localSavePending=(id:string)=>pendingLocal.has(scope()+':'+id);
export function replaceProjectCache(projects:Project[]){memory.set(scope(),projects);localStorage.setItem(cacheKey(),JSON.stringify(projects));}
export async function hydrateProjects():Promise<Project[]>{
 const account=scope();await localWrites;let durable:Project[]=[];
 try{const db=await openDb();try{durable=await new Promise<Project[]>((ok,no)=>{const r=db.transaction('projects').objectStore('projects').getAll();r.onsuccess=()=>ok(r.result.filter((v:{account:string})=>v.account===account).map((v:{project:unknown})=>normalizeProject(v.project)));r.onerror=()=>no(r.error);});}finally{db.close();}}catch{}
 if(storageScope()!==account)return [];
 const found=new Map(durable.map(p=>[p.id,p]));for(const p of loadProjects()){const old=found.get(p.id);if(!old||p.modified>=old.modified)found.set(p.id,p);}
 const projects=[...found.values()].sort((a,b)=>b.modified-a.modified);try{replaceProjectCache(projects);}catch{memory.set(account,projects);}return projects;
}
function storeProject(p:Project,account:string,synchronous:boolean){
 const key=account+':'+p.id,token=Symbol();if(!synchronous)pendingLocal.set(key,token);else pendingLocal.delete(key);
 localWrites=localWrites.catch(()=>{}).then(async()=>{
  const db=await openDb();try{await new Promise<void>((ok,no)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({account,project:p},key);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});}finally{db.close();}
  if(pendingLocal.get(key)===token)pendingLocal.delete(key);storageEvent(account,p.id,'saved','Монтаж сохранён на устройстве.');
 }).catch(()=>{storageEvent(account,p.id,synchronous?'saved':'error',synchronous?'Монтаж сохранён на устройстве.':'Не удалось сохранить монтаж. Скачайте полную копию проекта перед закрытием.');});
}
function storageEvent(account:string,id:string,state:string,message:string){window.dispatchEvent(new CustomEvent('pokadrovo:project-storage',{detail:{account,id,state,message}}));}
if(typeof window!=='undefined')window.addEventListener?.('pokadrovo:project-conflict',event=>{
 const detail=(event as CustomEvent).detail;if(detail.account!==storageScope())return;
 const projects=loadProjects(),latest=projects.find(p=>p.id===detail.local.id)||normalizeProject(detail.local);
 const copy=normalizeProject({...latest,id:uid(),name:latest.name+' (копия)',modified:Math.max(Date.now(),latest.modified+1)});
 const remote=detail.remote?normalizeProject(detail.remote):null;
 saveProject(copy);
 window.dispatchEvent(new CustomEvent('pokadrovo:project-fork',{detail:{account:detail.account,oldId:latest.id,project:copy,remote}}));
 // Never replace the last durable local draft until its separate copy has actually been written.
 void flushLocalProjects().then(()=>{if(storageScope()!==detail.account||localSavePending(copy.id))return;
  if(remote)saveProject(remote,false,false);
  completeProjectConflict(detail.account,latest.id,detail.revision??null);
  window.dispatchEvent(new CustomEvent('pokadrovo:project-library-updated',{detail:{account:detail.account}}));
 });
});
export function importOwnerLegacy():Project[]{if(scope()!=='owner')throw Error('Перенос старой локальной библиотеки доступен только администратору.');const old=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');if(!Array.isArray(old))throw Error('Некорректная библиотека.');const found=new Map(loadProjects().map(p=>[p.id,p]));for(const raw of old){const p=normalizeProject(raw);if(!found.has(p.id))found.set(p.id,p);}const merged=[...found.values()];replaceProjectCache(merged);merged.forEach(syncProject);return merged;}
export function saveProject(p:Project,sync=true,dirty=true){const account=scope(),snapshot=normalizeProject(p),arr=loadProjects(),projects=[snapshot,...arr.filter(a=>a.id!==p.id)];let synchronous=false;
 try{localStorage.setItem(cacheKey()+':draft',JSON.stringify(snapshot));synchronous=true;}catch{}
 try{replaceProjectCache(projects);synchronous=true;}catch{memory.set(account,projects);}
 storageEvent(account,p.id,'saving','Сохраняю монтаж…');storeProject(snapshot,account,synchronous);
 if(dirty&&!sync)stageProject(snapshot);
 if(sync){syncProject(snapshot);try{window.dispatchEvent(new CustomEvent('pokadrovo:metric',{detail:{kind:'project_saved',project:p.id,mode:p.mode}}));}catch{/* Metrics never block local persistence. */}}
}
export {mediaReady,inspectFile,download} from './media-file';
