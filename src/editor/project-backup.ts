import {download,persistProjectBundle,restoreAsset,saveProject,flushLocalProjects,localSavePending} from './assets';
import {storageScope} from '../account/api';
import {Asset,Project,normalizeProject,uid} from './model';

// Uncompressed, length-delimited blobs: large videos are never expanded into base64 or read into one buffer.
const magic=Uint8Array.from('POKADROVO-BUNDLE\n',c=>c.charCodeAt(0));
const MAX_MANIFEST=4*1024*1024,MAX_BUNDLE=8*1024**3,MAX_SOURCE=2*1024**3;
type Source={id:string;name:string;type:string;size:number;kind:Asset['kind'];checksum:string};
type Manifest={format:'pokadrovo';version:1;projects:Project[];sources:Source[]};
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
async function checksum(blob:Blob,account:string|null){let crc=0xffffffff;for(let offset=0;offset<blob.size;offset+=1024*1024){const bytes=new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer());if(storageScope()!==account)throw Error('Аккаунт изменился.');for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);}return ((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');}
export function backupName(name:string){return (name.replace(/[\u0000-\u001f<>:"/\\|?*]/g,' ').trim().slice(0,100)||'Покадрово')+'.pokadrovo';}
export async function createProjectBackup(projects:Project[],assets=new Map<string,Asset>(),progress=(message:string)=>{}){
 const account=storageScope();if(!account)throw Error('Откройте проект в своём аккаунте.');
 if(!projects.length||projects.length>200)throw Error('Выберите от 1 до 200 проектов.');
 const clips=new Map(projects.flatMap(p=>normalizeProject(p).sources).map(c=>[c.id,c])),sources:Source[]=[],blobs:Blob[]=[];let bytes=0;
 if(clips.size>4000)throw Error('В одной полной копии может быть до 4000 исходников.');
 for(const [id,clip] of clips){
  progress('Собираю исходник: '+clip.name);
  const asset=assets.get(id),blob=asset?.blob||await restoreAsset(id);
  if(storageScope()!==account)throw Error('Аккаунт изменился. Повторите действие.');
  if(!blob)throw Error('Не найден исходник «'+clip.name+'». Восстановите файл перед созданием полной копии.');
  bytes+=blob.size;if(blob.size>MAX_SOURCE||bytes>MAX_BUNDLE-MAX_MANIFEST-32)throw Error('Полная копия превышает 8 ГБ или один исходник больше 2 ГБ.');
  sources.push({id,name:asset?.name||clip.name,type:blob.type,kind:asset?.kind||clip.kind,size:blob.size,checksum:await checksum(blob,account)});blobs.push(blob);
 }
 const manifest:Manifest={format:'pokadrovo',version:1,projects:projects.map(normalizeProject),sources};
 const metadata=new TextEncoder().encode(JSON.stringify(manifest));if(metadata.length>MAX_MANIFEST)throw Error('Слишком большой документ проекта.');
 const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,metadata.length,true);
 return new Blob([magic,length,metadata,...blobs],{type:'application/x-pokadrovo-project'});
}
export async function downloadProjectBackup(projects:Project[],assets?:Map<string,Asset>,progress?:(message:string)=>void){
 const blob=await createProjectBackup(projects,assets,progress);download(blob,backupName(projects.length===1?projects[0].name:'Покадрово-проекты'));
}
function validProject(value:unknown):value is Project{
 const p=value as Project;return !!p&&typeof p==='object'&&typeof p.id==='string'&&[p.clips,p.audio,p.texts].every(v=>Array.isArray(v)&&v.length<=1000);
}
export async function importProjectBackup(file:Blob,progress=(message:string)=>{}):Promise<Project[]>{
 const account=storageScope();if(!account)throw Error('Откройте проекты в своём аккаунте.');
 if(file.size>MAX_BUNDLE)throw Error('Полная копия больше 8 ГБ.');
 const prefix=new Uint8Array(await file.slice(0,magic.length+4).arrayBuffer());
 const bundled=prefix.length>=magic.length&&magic.every((v,i)=>prefix[i]===v);
 if(!bundled){
  if(file.size>10*1024*1024)throw Error('JSON проекта больше 10 МБ.');
  const raw=JSON.parse(await file.text()),values=Array.isArray(raw)?raw:[raw];
  if(!values.length||values.length>200||!values.every(validProject))throw Error('Некорректный файл проекта.');
  if(storageScope()!==account)throw Error('Аккаунт изменился.');
  const projects=values.map(value=>normalizeProject({...value,id:uid(),modified:Date.now()}));
  projects.forEach(p=>saveProject(p));await flushLocalProjects();if(projects.some(p=>localSavePending(p.id)))throw Error('Не удалось сохранить монтаж на устройстве.');return projects;
 }
 if(prefix.length!==magic.length+4)throw Error('Файл копии обрезан.');
 const size=new DataView(prefix.buffer,prefix.byteOffset+magic.length,4).getUint32(0,true),start=magic.length+4+size;
 if(!size||size>MAX_MANIFEST||start>file.size)throw Error('Повреждён заголовок полной копии.');
 const manifest=JSON.parse(await file.slice(magic.length+4,start).text()) as Manifest;
 if(manifest.format!=='pokadrovo'||manifest.version!==1||!Array.isArray(manifest.projects)||!manifest.projects.length||manifest.projects.length>200||!manifest.projects.every(validProject)||!Array.isArray(manifest.sources)||manifest.sources.length>4000)throw Error('Неизвестный формат полной копии.');
 const ids=new Set<string>();let expected=start;
 for(const source of manifest.sources){
  if(!source||typeof source.id!=='string'||!/^[\w.-]{1,120}$/.test(source.id)||ids.has(source.id)||typeof source.name!=='string'||source.name.length>10000||typeof source.type!=='string'||source.type.length>200||!['video','image','audio'].includes(source.kind)||!Number.isSafeInteger(source.size)||source.size<0||source.size>MAX_SOURCE||typeof source.checksum!=='string'||!/^[a-f0-9]{8}$/.test(source.checksum))throw Error('Повреждён список исходников.');
  ids.add(source.id);expected+=source.size;if(!Number.isSafeInteger(expected)||expected>file.size)throw Error('Файл копии обрезан.');
 }
 if(expected!==file.size||manifest.projects.some(p=>normalizeProject(p).sources.some(c=>!ids.has(c.id))))throw Error('В полной копии не хватает исходников или есть лишние данные.');
 const mapping=new Map(manifest.sources.map(s=>[s.id,uid()])),assets:Asset[]=[];let offset=start;
 // The complete manifest and offsets are validated before the first write. New IDs preserve existing projects.
 for(const source of manifest.sources){
  if(storageScope()!==account)throw Error('Аккаунт изменился. Повторите импорт.');
  progress('Проверяю исходник: '+source.name);
  const blob=file.slice(offset,offset+source.size,source.type);offset+=source.size;
  if(await checksum(blob,account)!==source.checksum)throw Error('Повреждён исходник «'+source.name+'». Откройте другую копию проекта.');
  assets.push({id:mapping.get(source.id)!,name:source.name,kind:source.kind,blob,url:'',duration:0,width:0,height:0,thumbnail:''});
 }
 if(storageScope()!==account)throw Error('Аккаунт изменился.');
 const projects=manifest.projects.map(raw=>normalizeProject({...raw,id:uid(),modified:Date.now(),sources:normalizeProject(raw).sources.map(s=>({...s,id:mapping.get(s.id)})),clips:raw.clips.map(c=>({...c,assetId:mapping.get(c.assetId)})),audio:raw.audio.map(c=>({...c,assetId:mapping.get(c.assetId)}))}));
 progress('Сохраняю проект и исходники…');await persistProjectBundle(projects,assets,account);
 if(storageScope()!==account)throw Error('Аккаунт изменился. Копия сохранена в исходном аккаунте.');
 for(const p of projects)saveProject(p);await flushLocalProjects();progress('Полная копия восстановлена.');return projects;
}
