import { storageScope, syncProject } from '../account/api';
import { Asset, Kind, Project, STORAGE_KEY, normalizeProject, uid } from './model';
export async function openDb():Promise<IDBDatabase>{return new Promise((ok,no)=>{
 const req=indexedDB.open('pokadrovo-media-v1',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('files'))req.result.createObjectStore('files');};
 req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error);req.onblocked=()=>no(new Error('Storage blocked'));
});}
function scope(){const id=storageScope();if(!id)throw Error('Войдите в аккаунт для работы с проектами.');return id;}
function cacheKey(){return STORAGE_KEY+':account:'+scope();}
export async function persistAsset(a:Asset){const key=scope()+':'+a.id;const db=await openDb();try{await new Promise<void>((ok,no)=>{
 const tx=db.transaction('files','readwrite');tx.objectStore('files').put(a.blob,key);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);
});}finally{db.close();}}
export async function restoreAsset(id:string):Promise<Blob|undefined>{const account=scope(),key=account+':'+id;const db=await openDb();try{const read=(key:string)=>new Promise<Blob|undefined>((ok,no)=>{const r=db.transaction('files').objectStore('files').get(key);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});return await read(key)||(account==='owner'?await read(id):undefined);}finally{db.close();}}
export function loadProjects():Project[]{
 if(!storageScope())return [];const raw=localStorage.getItem(cacheKey());if(!raw)return [];
 const arr=JSON.parse(raw);if(!Array.isArray(arr))throw Error('Invalid project library');return arr.map(normalizeProject);
}
export function replaceProjectCache(projects:Project[]){localStorage.setItem(cacheKey(),JSON.stringify(projects));}
export function importOwnerLegacy():Project[]{if(scope()!=='owner')throw Error('Только владелец может перенести старую локальную библиотеку.');const old=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');if(!Array.isArray(old))throw Error('Некорректная библиотека.');const found=new Map(loadProjects().map(p=>[p.id,p]));for(const raw of old){const p=normalizeProject(raw);if(!found.has(p.id))found.set(p.id,p);}const merged=[...found.values()];replaceProjectCache(merged);merged.forEach(syncProject);return merged;}
export function saveProject(p:Project,sync=true){const arr=loadProjects();replaceProjectCache([p,...arr.filter(a=>a.id!==p.id)]);if(sync){syncProject(p);try{window.dispatchEvent(new CustomEvent('pokadrovo:metric',{detail:{kind:'project_saved',project:p.id,mode:p.mode}}));}catch{/* Metrics never block local persistence. */}}}export function mediaReady(el:HTMLMediaElement,url:string):Promise<void>{return new Promise((ok,no)=>{
 const finish=(err?:Error)=>{clearTimeout(timer);el.onloadeddata=null;el.onerror=null;err?no(err):ok();};
 const timer=setTimeout(()=>finish(new Error('Media decode timeout')),12000);
 el.preload='auto';el.onloadeddata=()=>finish();el.onerror=()=>finish(new Error('Unsupported or damaged media'));el.src=url;el.load();
});}
export async function inspectFile(file:Blob & {name?:string},id:string=uid(),kindOverride?:Kind,nameOverride?:string):Promise<Asset>{
 const kind=kindOverride || (file.type.startsWith('video/')?'video':file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':null);
 if(!kind)throw new Error('Unsupported file type');if(file.size>2*1024*1024*1024)throw new Error('File exceeds 2 GB');
 const url=URL.createObjectURL(file);let duration=5,width=0,height=0,thumbnail='';
 try{
  if(kind==='image'){
   const im=new Image();im.src=url;await im.decode();width=im.naturalWidth;height=im.naturalHeight;
   const c=document.createElement('canvas');c.width=192;c.height=108;const x=c.getContext('2d')!;x.drawImage(im,0,0,192,108);thumbnail=c.toDataURL('image/jpeg',.7);
  }else{
   const el=document.createElement(kind==='video'?'video':'audio');el.muted=true;
   try{await mediaReady(el,url);duration=el.duration;if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid media duration');
    if(el instanceof HTMLVideoElement){width=el.videoWidth;height=el.videoHeight;const c=document.createElement('canvas');c.width=192;c.height=108;c.getContext('2d')!.drawImage(el,0,0,192,108);thumbnail=c.toDataURL('image/jpeg',.7);}
   }finally{el.pause();el.removeAttribute('src');el.load();}
  }
  return {id,name:nameOverride||file.name||'Media',blob:file,kind,url,duration,width,height,thumbnail};
 }catch(e){URL.revokeObjectURL(url);throw e;}
}
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();if(blob.type.startsWith('video/')){try{window.dispatchEvent(new CustomEvent('pokadrovo:metric',{detail:{kind:'export_completed',format:blob.type.includes('mp4')?'mp4':'webm'}}));}catch{/* Metrics never block file download. */}}setTimeout(()=>URL.revokeObjectURL(url),30000);}
