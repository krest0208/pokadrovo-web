import { inspectFile, restoreAsset } from './assets';
import type { Asset, Project } from './model';

/** Rebuild object URLs without changing the read-only properties of stored File objects. */
export async function restoreProjectAssets(project:Project,assets:Map<string,Asset>,isCurrent=()=>true):Promise<string[]> {
 const missing:string[]=[];
 const sources=new Map<string,{name:string;kind:Asset['kind']}>([...project.clips,...project.audio].map(clip=>[clip.assetId,clip]));
 for(const source of project.sources||[])sources.set(source.id,source);
 for(const [id,clip] of sources){
  if(!isCurrent())break;
  if(assets.has(id))continue;
  try{
   const blob=await restoreAsset(id);
   if(!isCurrent())break;
   if(!blob){missing.push(clip.name);continue;}
   const kind=clip.kind==='audio'&&blob.type.startsWith('video/')?'video':clip.kind;
   const asset=await inspectFile(blob,id,kind,clip.name);
   if(!isCurrent()){URL.revokeObjectURL(asset.url);break;}
   assets.set(id,asset);
  }catch{if(isCurrent())missing.push(clip.name);}
 }
 return missing;
}
