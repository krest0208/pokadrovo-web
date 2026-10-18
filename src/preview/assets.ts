import { Asset, Project, normalizeProject } from '../editor/model';
import { previewStorage, record } from './storage';
export { inspectFile, mediaReady, download } from '../editor/assets';

const blobs=new Map<string,Blob>();
export function loadProjects():Project[]{try{const raw=JSON.parse(previewStorage.getItem('projects')||'[]');return Array.isArray(raw)?raw.map(normalizeProject):[];}catch{return [];}}
export function replaceProjectCache(projects:Project[]){previewStorage.setItem('projects',JSON.stringify(projects));}
export function saveProject(project:Project){replaceProjectCache([project,...loadProjects().filter(p=>p.id!==project.id)]);record('project_saved');window.dispatchEvent(new Event('pokadrovo:preview-saved'));}
async function openDb():Promise<IDBDatabase>{return new Promise((ok,no)=>{
  try {const req=indexedDB.open('pokadrovo-chat-preview-media-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error);req.onblocked=()=>no(Error('Storage blocked'));}catch(e){no(e);}
});}
export async function persistAsset(asset:Asset){
  blobs.set(asset.id,asset.blob);
  try{const db=await openDb();try{await new Promise<void>((ok,no)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(asset.blob,asset.id);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});}finally{db.close();}}
  catch {window.dispatchEvent(new CustomEvent('pokadrovo:preview-notice',{detail:'Медиа доступны до закрытия этого окна. Сохраните исходники отдельно.'}));}
}
export async function restoreAsset(id:string):Promise<Blob|undefined>{
  if(blobs.has(id))return blobs.get(id);
  try{const db=await openDb();try{return await new Promise<Blob|undefined>((ok,no)=>{const request=db.transaction('files').objectStore('files').get(id);request.onsuccess=()=>ok(request.result);request.onerror=()=>no(request.error);});}finally{db.close();}}catch{return undefined;}
}
