import type {Asset,Clip} from './model';
import type {AiMedia} from './ai';
import {mediaReady} from './assets';
import {readAudioSamples} from './audio-samples';

export const PREPARED_MEDIA='application/x-pokadrovo-av' as const;
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Запрос отменён','AbortError');};
function base64(bytes:Uint8Array){let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}
export function wavSamples(channel:Float32Array,rate=16000){
 const bytes=new Uint8Array(44+channel.length*2),v=new DataView(bytes.buffer);
 const text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,channel.length*2,true);
 for(let i=0;i<channel.length;i++){const n=Math.max(-1,Math.min(1,channel[i]));v.setInt16(44+i*2,Math.round(n*(n<0?32768:32767)),true);}return bytes;
}
export function sampleTimes(duration:number){const count=Math.max(1,Math.min(12,Math.ceil(duration/5)));return Array.from({length:count},(_,i)=>Math.max(0,Math.min(duration-.01,i*duration/count)));}
export async function prepareSamples(asset:Asset,clip:Clip,signal:AbortSignal,progress:(text:string)=>void=()=>{}):Promise<AiMedia>{
 check(signal);const {samples,audioPresent}=await readAudioSamples(asset,signal,progress);const data=base64(wavSamples(samples));
 if(clip.kind==='audio')return {clipId:clip.id,assetId:clip.assetId,mime:'audio/wav',data};
 const video=document.createElement('video');video.muted=true;video.playsInline=true;
 const canvas=document.createElement('canvas'),frames:{at:number;data:string}[]=[];
 try{
  await mediaReady(video,asset.url);check(signal);const k=Math.min(1,480/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*k));canvas.height=Math.max(1,Math.round(video.videoHeight*k));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Не удалось подготовить кадры.');
  for(const at of sampleTimes(asset.duration)){
   check(signal);if(Math.abs(video.currentTime-at)>.001)await new Promise<void>((resolve,reject)=>{
    const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener('seeked',done);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const done=()=>finish(),abort=()=>finish(new DOMException('Запрос отменён','AbortError')),timer=setTimeout(()=>finish(Error('Не удалось прочитать кадр видео.')),8000);
    video.addEventListener('seeked',done,{once:true});signal.addEventListener('abort',abort,{once:true});try{video.currentTime=at;}catch(error){finish(error as Error);}
   });
   check(signal);ctx.drawImage(video,0,0,canvas.width,canvas.height);const frame=canvas.toDataURL('image/jpeg',.65).split(',')[1];if(!frame||frame.length>131072)throw Error('Подготовленный кадр слишком большой.');frames.push({at,data:frame});
  }
 }finally{video.pause();video.removeAttribute('src');video.load();}
 return {clipId:clip.id,assetId:clip.assetId,mime:PREPARED_MEDIA,data,frames,audioPresent};
}
