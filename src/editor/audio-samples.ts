import type {Asset} from './model';
import {mediaReady} from './assets';

const aborted=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Запрос отменён','AbortError');};
function waitForAudio<T>(task:Promise<T>,signal:AbortSignal,timeout=12000):Promise<T>{
 aborted(signal);return new Promise((resolve,reject)=>{
  const finish=(error:unknown,value?:T)=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);error?reject(error):resolve(value!);};
  const cancel=()=>finish(new DOMException('Запрос отменён','AbortError')),timer=setTimeout(()=>finish(Error('Браузер не завершил чтение звука. Откройте вкладку и повторите или добавьте WAV.')),timeout);
  signal.addEventListener('abort',cancel,{once:true});task.then(value=>finish(null,value),error=>finish(error));
 });
}

/** Inspect MP4 track handlers, not a filename or a failed decoder. Unknown is never called silent. */
export function mp4AudioPresence(buffer:ArrayBuffer):boolean|null{
 const bytes=new Uint8Array(buffer),view=new DataView(buffer),tag=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
 let video=false,audio=false,handlers=0,unknown=false,moov=false;
 function boxes(from:number,to:number,depth:number){
  if(depth>3)throw Error('depth');
  for(let at=from;at<to;){
   if(at+8>to)throw Error('header');let size=view.getUint32(at),header=8;const type=tag(at+4);
   if(size===1){if(at+16>to)throw Error('large header');size=Number(view.getBigUint64(at+8));header=16;}
   else if(size===0)size=to-at;
   if(!Number.isSafeInteger(size)||size<header||at+size>to)throw Error('size');
   const start=at+header,end=at+size;
   if(depth===0&&type==='moov'){moov=true;boxes(start,end,1);}
   else if(depth===1&&type==='trak')boxes(start,end,2);
   else if(depth===2&&type==='mdia')boxes(start,end,3);
   else if(depth===3&&type==='hdlr'){
    if(start+12>end)throw Error('handler');const handler=tag(start+8);handlers++;video||=handler==='vide';audio||=handler==='soun';unknown||=!['vide','soun','text','subt','sbtl','meta','hint','tmcd','clcp'].includes(handler);
   }
   at=end;
  }
 }
 try{if(bytes.length<16||tag(4)!=='ftyp')return null;boxes(0,bytes.length,0);return audio?true:moov&&video&&handlers&&!unknown?false:null;}catch{return null;}
}

/** The media element can play some containers which decodeAudioData cannot demux.
 * Capture that local playback through Web Audio, with a silent destination and cancellation. */
async function capturePlayback(asset:Asset,signal:AbortSignal,progress:(text:string)=>void):Promise<AudioBuffer>{
 const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
 if(!Audio)throw Error('В этом браузере нет декодера звука. Используйте актуальный Chrome или отдельный WAV.');
 const context=new Audio(),media=document.createElement(asset.kind==='video'?'video':'audio');
 media.preload='auto';media.setAttribute('playsinline','');media.volume=1;media.muted=false;
 let source:MediaElementAudioSourceNode|undefined,processor:ScriptProcessorNode|undefined;
 const silence=context.createGain();silence.gain.value=0;
 const rate=context.sampleRate,samples=new Float32Array(Math.ceil(asset.duration*rate));let written=0,recording=false;
 try{
  await waitForAudio(mediaReady(media,asset.url),signal);aborted(signal);
  source=context.createMediaElementSource(media);processor=context.createScriptProcessor(2048,2,1);
  processor.onaudioprocess=event=>{
   if(!recording||media.paused)return;const input=event.inputBuffer,count=Math.min(input.length,samples.length-written);
   for(let c=0;c<input.numberOfChannels;c++){const channel=input.getChannelData(c);for(let i=0;i<count;i++)samples[written+i]+=channel[i]/input.numberOfChannels;}
   written+=count;
  };
  source.connect(processor);processor.connect(silence);silence.connect(context.destination);
  await waitForAudio(context.resume(),signal,8000);aborted(signal);
  if(context.state!=='running')throw Error('Браузер приостановил звук. Нажмите кнопку ещё раз или используйте WAV.');
  await new Promise<void>((resolve,reject)=>{
   const finish=(error?:Error)=>{clearTimeout(timer);media.removeEventListener('ended',done);media.removeEventListener('error',failed);signal.removeEventListener('abort',cancel);media.ontimeupdate=null;recording=false;error?reject(error):resolve();};
   const done=()=>finish(),failed=()=>finish(Error('Не удалось воспроизвести звуковую дорожку. Добавьте отдельный WAV.')),
    cancel=()=>finish(new DOMException('Запрос отменён','AbortError')),
    timer=setTimeout(()=>finish(Error('Чтение звука остановилось. Откройте вкладку и повторите или добавьте WAV.')),(asset.duration+15)*1000);
   media.addEventListener('ended',done,{once:true});media.addEventListener('error',failed,{once:true});signal.addEventListener('abort',cancel,{once:true});
   media.ontimeupdate=()=>progress(`Подготавливаем звук: ${Math.min(100,Math.round(media.currentTime/asset.duration*100))}%. Оставьте вкладку открытой. Провайдер ещё не запущен.`);
   recording=true;void media.play().catch(()=>finish(Error('Браузер не разрешил чтение звука. Нажмите кнопку ещё раз или добавьте WAV.')));
  });
  aborted(signal);
  if(written<rate*Math.max(.1,asset.duration-.8))throw Error('Звуковая дорожка прочитана не полностью. Повторите с открытой вкладкой или добавьте WAV.');
  const buffer=context.createBuffer(1,samples.length,rate);buffer.copyToChannel(samples,0);return buffer;
 }finally{media.pause();media.removeAttribute('src');media.load();source?.disconnect();if(processor){processor.onaudioprocess=null;processor.disconnect();}silence.disconnect();await context.close().catch(()=>{});}
}

export async function readAudioSamples(asset:Asset,signal:AbortSignal,progress:(text:string)=>void=()=>{}){
 aborted(signal);const bytes=await asset.blob.arrayBuffer();aborted(signal);
 const context=new OfflineAudioContext(1,Math.ceil(asset.duration*16000),16000);
 if(asset.kind==='video'&&mp4AudioPresence(bytes)===false)return {samples:new Float32Array(Math.ceil(asset.duration*16000)),audioPresent:false};
 let audio:AudioBuffer;
 try{audio=await waitForAudio(context.decodeAudioData(bytes),signal);}catch{
  aborted(signal);progress('Подготавливаем звук через локальное воспроизведение. Это может занять длительность исходника. Провайдер ещё не запущен.');
  audio=await capturePlayback(asset,signal,progress);
 }
 aborted(signal);if(audio.duration>60.1||Math.abs(audio.duration-asset.duration)>1)throw Error('Длительность звука отличается от видео. Добавьте отдельный MP4 или WAV до 60 секунд.');
 const source=context.createBufferSource();source.buffer=audio;source.connect(context.destination);source.start();
 const output=await context.startRendering();aborted(signal);return {samples:output.getChannelData(0),audioPresent:true};
}
