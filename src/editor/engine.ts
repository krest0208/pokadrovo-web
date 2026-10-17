import { Asset, Caption, Clip, Project, currentClip, dimensions, fadeGain, length, totalLength } from './model';
import { mediaReady } from './assets';
import { mediaBox, clipPath } from './geometry';
import { ensureFonts, fontStyle } from './fonts';
interface Resource { id:string; assetId:string; element:HTMLImageElement|HTMLMediaElement; ready:Promise<void>; node?:MediaElementAudioSourceNode; gain?:GainNode; }
/** Preview and export use the same time mapping, canvas compositor and Web Audio mixer. */
export class PlaybackEngine {
 private resources=new Map<string,Resource>();private context:AudioContext|null=null;private master:GainNode|null=null;
 private destination:MediaStreamAudioDestinationNode|null=null;private raf=0;private startTime=0;private startCursor=0;
 private project:Project|null=null;private disposed=false;private generation=0;private monitor=true;
 public time=0;public playing=false;
 constructor(public canvas:HTMLCanvasElement,private assets:Map<string,Asset>,private tick:(time:number,playing:boolean)=>void,private failed:(error:unknown)=>void=console.error){}
 async prepare(p:Project){
  const g=++this.generation;this.pause();this.project=p;const ids=new Set<string>();
  for(const c of [...p.clips,...p.audio]){
   ids.add(c.id);const a=this.assets.get(c.assetId);if(!a)throw new Error('Missing media: '+c.name);
   let r=this.resources.get(c.id);if(r&&r.assetId!==a.id){this.release(r);this.resources.delete(c.id);r=undefined;}
   if(!r){
    if(c.kind==='image'&&!p.audio.includes(c)){
     const element=new Image();element.src=a.url;r={id:c.id,assetId:a.id,element,ready:element.decode()};
    }else{
     const element=document.createElement(p.audio.includes(c)?'audio':'video');if(element instanceof HTMLVideoElement)element.playsInline=true;
     element.volume=1;element.muted=false;element.preservesPitch=true;
     r={id:c.id,assetId:a.id,element,ready:mediaReady(element,a.url).then(()=>this.seekMedia(element,c.start))};
    }
    this.resources.set(c.id,r);
   }
  }
  for(const [id,r] of this.resources){if(!ids.has(id)){this.release(r);this.resources.delete(id);}}
  await Promise.all([ensureFonts(p.texts),...Array.from(this.resources.values(),r=>r.ready)]);if(this.disposed||g!==this.generation)return;
  if(this.context)for(const r of this.resources.values())this.connect(r);
  await this.seek(Math.min(this.time,totalLength(p)));return;
 }
 private async seekMedia(el:HTMLMediaElement,time:number){
  if(Math.abs(el.currentTime-time)<.015)return;
  await new Promise<void>((ok,no)=>{const timer=setTimeout(()=>finish(new Error('Seeking timed out')),6000);
   const done=()=>finish();const finish=(err?:Error)=>{clearTimeout(timer);el.removeEventListener('seeked',done);err?no(err):ok();};
   el.addEventListener('seeked',done);try{el.currentTime=Math.max(0,Math.min(time,Number.isFinite(el.duration)?el.duration-.002:time));if(!el.seeking)finish();}catch(e){finish(e instanceof Error?e:new Error('Seeking failed'));}
  });
 }
 private connect(r:Resource){if(!this.context||!this.master||r.node||r.element instanceof HTMLImageElement)return;
  r.node=this.context.createMediaElementSource(r.element);r.gain=this.context.createGain();r.node.connect(r.gain);r.gain.connect(this.master);
 }
 async audio(monitor=true):Promise<MediaStreamAudioDestinationNode>{
  this.monitor=monitor;
  if(!this.context){
   this.context=new AudioContext();this.master=this.context.createGain();const limiter=this.context.createDynamicsCompressor();
   limiter.threshold.value=-1;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.002;limiter.release.value=.05;
   this.master.connect(limiter);this.destination=this.context.createMediaStreamDestination();limiter.connect(this.destination);
   if(monitor)limiter.connect(this.context.destination);
   this.resources.forEach(r=>this.connect(r));
  }
  if(this.context.state==='suspended')await this.context.resume();return this.destination!;
 }
 async seek(time:number){
  if(!this.project||this.disposed)return;this.pause();this.time=Math.max(0,Math.min(totalLength(this.project),time));this.tick(this.time,false);
  const c=currentClip(this.project,Math.min(this.time,Math.max(0,totalLength(this.project)-.001)));
  if(c){const r=this.resources.get(c.clip.id);if(r){await r.ready;if(r.element instanceof HTMLMediaElement)await this.seekMedia(r.element,c.clip.start+(this.time-c.at)*c.clip.speed);}}
  if(!this.disposed){this.draw();this.tick(this.time,false);}
 }
 async play(){if(!this.project||!totalLength(this.project))return;
  await this.audio(this.monitor);if(this.disposed)return;
  if(this.time>=totalLength(this.project))await this.seek(0);
  this.playing=true;this.startCursor=this.time;this.startTime=performance.now();this.loop();
 }
 pause(){this.playing=false;cancelAnimationFrame(this.raf);this.resources.forEach(r=>{if(r.element instanceof HTMLMediaElement)r.element.pause();});this.tick(this.time,false);}
 private loop=()=>{
  if(!this.playing||!this.project||this.disposed)return;
  this.time=this.startCursor+(performance.now()-this.startTime)/1000;
  if(this.time>=totalLength(this.project)){this.time=totalLength(this.project);this.pause();this.draw();this.tick(this.time,false);return;}
  this.sync();this.draw();this.tick(this.time,true);this.raf=requestAnimationFrame(this.loop);
 };
 private sync(){
  if(!this.project)return;const p=this.project,active=currentClip(p,this.time);const live=new Map<string,{clip:Clip;offset:number}>();
  if(active)live.set(active.clip.id,{clip:active.clip,offset:this.time-active.at});
  for(const clip of p.audio){const offset=this.time-clip.at;if(offset>=0&&offset<length(clip))live.set(clip.id,{clip,offset});}
  if(this.master)this.master.gain.value=p.master;
  for(const [id,r] of this.resources){
   if(!(r.element instanceof HTMLMediaElement))continue;const v=live.get(id),el=r.element;
   if(!v){el.pause();if(r.gain)r.gain.gain.value=0;continue;}
   const c=v.clip,expected=c.start+v.offset*c.speed;el.playbackRate=c.speed;el.preservesPitch=true;
   if(Math.abs(el.currentTime-expected)>.22)el.currentTime=expected;
   if(r.gain)r.gain.gain.setTargetAtTime(fadeGain(c,v.offset),this.context!.currentTime,.008);
   if(el.paused&&!el.ended)void el.play().catch(e=>{if(this.playing){this.pause();this.failed(e);}});
   else if(el.ended&&expected<c.end-.04){el.currentTime=expected;void el.play().catch(this.failed);}
  }
 }
 draw(){
  const p=this.project;if(!p)return;const ctx=this.canvas.getContext('2d');if(!ctx)return;
  const w=this.canvas.width,h=this.canvas.height;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.filter='none';ctx.fillStyle='#0d1420';ctx.fillRect(0,0,w,h);
  const active=currentClip(p,Math.min(this.time,Math.max(0,totalLength(p)-.001)));
  if(active){const c=active.clip,r=this.resources.get(c.id);if(r){const el=r.element;
   const sw=el instanceof HTMLImageElement?el.naturalWidth:(el as HTMLVideoElement).videoWidth,sh=el instanceof HTMLImageElement?el.naturalHeight:(el as HTMLVideoElement).videoHeight;
   if(sw&&sh){
    const off=this.time-active.at,d=length(c),fade=Math.max(0,Math.min(1,c.visualIn?off/c.visualIn:1,c.visualOut?(d-off)/c.visualOut:1));
    ctx.save();ctx.globalAlpha=c.opacity*fade;ctx.filter=`brightness(${c.brightness}) contrast(${c.contrast}) saturate(${c.saturation})`;
    const box=mediaBox(c,{width:sw,height:sh},w,h);
    ctx.translate(box.cx,box.cy);ctx.rotate(c.rotation*Math.PI/180);
    clipPath(ctx,c,box.width,box.height);ctx.scale(c.flip?-1:1,1);
    ctx.drawImage(el as CanvasImageSource,box.sx,box.sy,box.sw,box.sh,-box.width/2,-box.height/2,box.width,box.height);ctx.restore();
   }
  }}
  for(const t of p.texts){if(this.time>=t.from&&this.time<t.to)this.caption(ctx,t,w,h);}
  ctx.restore();
 }
 /** Transient drag preview: does not write history or recreate media resources. */
 preview(project:Project){this.project=project;this.draw();}
 private caption(ctx:CanvasRenderingContext2D,t:Caption,w:number,h:number){
  if(!t.text)return;const size=Math.max(8,Math.min(w,h)*t.size),max=w*.85;ctx.save();ctx.font=fontStyle(t,size);ctx.textAlign=t.align;ctx.textBaseline='middle';
  const lines:string[]=[];for(const paragraph of t.text.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){const v=line?line+' '+word:word;if(ctx.measureText(v).width>max&&line){lines.push(line);line=word;}else line=v;}lines.push(line);}
  const visible=lines.slice(0,8),lh=size*1.25,cy=h*t.y;for(let i=0;i<visible.length;i++){
   const line=visible[i],tw=Math.min(max,ctx.measureText(line).width),x=w*t.x,y=cy+(i-(visible.length-1)/2)*lh;
   if(t.background){ctx.fillStyle='rgba(0,0,0,.66)';ctx.fillRect(x-(t.align==='center'?tw/2:t.align==='right'?tw:0)-size*.25,y-lh/2,tw+size*.5,lh);}
   ctx.lineWidth=size*.045;ctx.strokeStyle='rgba(0,0,0,.65)';ctx.strokeText(line,x,y,max);ctx.fillStyle=t.color;ctx.fillText(line,x,y,max);
  }ctx.restore();
 }
 private release(r:Resource){if(r.element instanceof HTMLMediaElement){r.element.pause();r.element.removeAttribute('src');r.element.load();r.node?.disconnect();r.gain?.disconnect();}}
 dispose(){this.disposed=true;this.pause();this.generation++;this.resources.forEach(r=>this.release(r));this.resources.clear();void this.context?.close();}
}
export const exportFormats=()=>typeof MediaRecorder==='undefined'?[]:[
 {label:'WebM',mime:'video/webm;codecs=vp9,opus',ext:'webm'},
 {label:'WebM',mime:'video/webm;codecs=vp8,opus',ext:'webm'},
 {label:'MP4',mime:'video/mp4;codecs=avc1.424028,mp4a.40.2',ext:'mp4'},
 {label:'MP4',mime:'video/mp4',ext:'mp4'}
].filter(f=>MediaRecorder.isTypeSupported(f.mime)).filter((f,i,a)=>a.findIndex(v=>v.ext===f.ext)===i);
export async function exportProject(p:Project,assets:Map<string,Asset>,format:{mime:string;ext:string},quality:number,onProgress:(v:number)=>void,signal:AbortSignal):Promise<Blob>{
 if(!totalLength(p))throw new Error('Project is empty');
 const canvas=document.createElement('canvas');[canvas.width,canvas.height]=dimensions(p.ratio,quality);
 let recorder:MediaRecorder|null=null,stream:MediaStream|null=null;let engine:PlaybackEngine|null=null;
 try{
  let failure:unknown;engine=new PlaybackEngine(canvas,assets,(time)=>onProgress(time/totalLength(p)),e=>{failure=e;});
  const dest=await engine.audio(false);await engine.prepare(p);if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const video=canvas.captureStream(30);stream=new MediaStream([...video.getVideoTracks(),...dest.stream.getAudioTracks()]);
  recorder=new MediaRecorder(stream,{mimeType:format.mime,videoBitsPerSecond:quality>=1080?10000000:6000000,audioBitsPerSecond:192000});
  const parts:BlobPart[]=[];recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
  const complete=new Promise<Blob>((ok,no)=>{recorder!.onstop=()=>ok(new Blob(parts,{type:format.mime.split(';')[0]}));recorder!.onerror=e=>{failure=e;no(new Error('Encoder failed'));};});
  // Attach a rejection handler immediately, even if the recording loop is still running.
  void complete.catch(()=>{});recorder.start(200);await engine.play();
  while(engine.playing){if(signal.aborted)throw new DOMException('Cancelled','AbortError');if(document.hidden)throw new Error('Export paused: keep this tab visible');if(failure)throw failure;await new Promise(r=>setTimeout(r,40));}
  if(failure)throw failure;if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  recorder.stop();const result=await complete;if(result.size<128)throw new Error('Empty encoded file');onProgress(1);return result;
 }finally{if(recorder&&recorder.state!=='inactive')recorder.stop();engine?.dispose();stream?.getTracks().forEach(t=>t.stop());}
}
