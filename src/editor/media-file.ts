import {Asset,Kind,uid} from './model';
export function mediaReady(el:HTMLMediaElement,url:string):Promise<void>{return new Promise((ok,no)=>{
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
