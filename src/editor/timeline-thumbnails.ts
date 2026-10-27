import type {Asset} from './model';

const TILE=72,MAX_CACHE=240;
/** Sample source time, not project time: trimming and playback speed are already reflected in the clip width. */
export function frameTime(start:number,end:number,width:number,index:number,tile=TILE){
  const centre=Math.min(width,Math.max(0,index*tile+Math.min(tile,width-index*tile)/2));
  return Math.max(start,Math.min(end-.001,start+(end-start)*centre/Math.max(1,width)));
}
export function visibleFrames(width:number,left:number,right:number,tile=TILE):number[]{
  if(width<=0||right<=0||left>=width||right<=left)return [];
  const first=Math.max(0,Math.floor(left/tile)),last=Math.min(Math.ceil(width/tile)-1,Math.floor(right/tile));
  return Array.from({length:Math.min(80,Math.max(0,last-first+1))},(_,i)=>first+i);
}
type Job={key:string;asset:Asset;at:number;nodes:Set<HTMLImageElement>};

/** Local, viewport-only filmstrips. A separate decoder never seeks the preview player. */
export class TimelineThumbnails {
  private cache=new Map<string,string>();private queue=new Map<string,Job>();private active:Job|null=null;
  private video:HTMLVideoElement;private loaded='';private failed=new Set<string>();private busy=false;
  private disposed=false;private frame=0;private life=new AbortController();private resize:ResizeObserver;
  constructor(private host:HTMLElement,private scroll:HTMLElement,private assets:Map<string,Asset>){
    this.video=document.createElement('video');this.video.muted=true;this.video.playsInline=true;this.video.preload='auto';
    this.scroll.addEventListener('scroll',this.schedule,{passive:true});
    this.resize=new ResizeObserver(this.schedule);this.resize.observe(scroll);
  }
  refresh(){this.schedule();}
  private schedule=()=>{if(!this.disposed&&!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.renderVisible();});};
  private renderVisible(){
    if(this.disposed)return;
    const viewport=this.scroll.getBoundingClientRect();
    // Finish layout reads before updating any image nodes.
    const strips=Array.from(this.host.querySelectorAll<HTMLElement>('.pe-filmstrip')).map(node=>({node,box:node.getBoundingClientRect()}));
    for(const {node,box} of strips){
      if(box.bottom<viewport.top||box.top>viewport.bottom||!box.width){node.replaceChildren();continue;}
      const asset=this.assets.get(node.dataset.assetId||'');if(!asset)continue;
      const wanted=visibleFrames(box.width,viewport.left-box.left-TILE,viewport.right-box.left+TILE);
      const indices=new Set(wanted);const existing=new Map(Array.from(node.querySelectorAll<HTMLImageElement>('img')).map(img=>[Number(img.dataset.frameIndex),img]));
      for(const [index,img] of existing)if(!indices.has(index)){img.remove();existing.delete(index);}
      for(const index of wanted){
        let img=existing.get(index);
        if(!img){img=document.createElement('img');img.alt='';img.draggable=false;img.dataset.frameIndex=String(index);img.style.left=index*TILE+'px';img.style.width=Math.min(TILE,box.width-index*TILE)+'px';if(asset.thumbnail)img.src=asset.thumbnail;node.append(img);}
        if(asset.kind==='image'){if(!img.src)img.src=asset.url;continue;}
        if(asset.kind!=='video')continue;
        const raw=frameTime(Number(node.dataset.sourceStart),Number(node.dataset.sourceEnd),box.width,index);
        const at=Math.max(0,Math.min(asset.duration-.04,Math.round(raw*10)/10));
        const key=asset.id+':'+at.toFixed(1);img.dataset.frameKey=key;img.dataset.sourceAt=String(at);
        const cached=this.cache.get(key);
        if(cached){img.src=cached;this.cache.delete(key);this.cache.set(key,cached);continue;}
        if(this.failed.has(asset.url))continue;
        const job=this.active?.key===key?this.active:this.queue.get(key);
        if(job)job.nodes.add(img);else this.queue.set(key,{key,asset,at,nodes:new Set([img])});
      }
    }
    for(const [key,job] of this.queue){for(const node of job.nodes)if(!node.isConnected)job.nodes.delete(node);if(!job.nodes.size)this.queue.delete(key);}
    if(!this.busy)void this.pump();
  }
  private wait(event:'loadeddata'|'seeked',action:()=>void){
    return new Promise<void>((resolve,reject)=>{
      const signal=this.life.signal;
      const done=(error?:Error)=>{clearTimeout(timer);this.video.removeEventListener(event,ready);this.video.removeEventListener('error',bad);signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
      const ready=()=>done(),bad=()=>done(Error('Cannot decode thumbnail')),cancel=()=>done(new DOMException('Cancelled','AbortError'));
      const timer=setTimeout(bad,8000);
      this.video.addEventListener(event,ready,{once:true});this.video.addEventListener('error',bad,{once:true});signal.addEventListener('abort',cancel,{once:true});
      if(signal.aborted){cancel();return;}try{action();}catch{bad();}
    });
  }
  private async decode(asset:Asset,at:number){
    if(this.loaded!==asset.url){await this.wait('loadeddata',()=>{this.video.src=asset.url;this.video.load();});this.loaded=asset.url;}
    if(Math.abs(this.video.currentTime-at)>.015)await this.wait('seeked',()=>{this.video.currentTime=at;});
    if(this.disposed)throw new DOMException('Cancelled','AbortError');
    const canvas=document.createElement('canvas');canvas.width=144;canvas.height=82;
    const context=canvas.getContext('2d');if(!context||!this.video.videoWidth)throw Error('Cannot draw thumbnail');
    const ratio=canvas.width/canvas.height,sourceRatio=this.video.videoWidth/this.video.videoHeight;
    const sw=sourceRatio>ratio?this.video.videoHeight*ratio:this.video.videoWidth,sh=sourceRatio>ratio?this.video.videoHeight:this.video.videoWidth/ratio;
    context.drawImage(this.video,(this.video.videoWidth-sw)/2,(this.video.videoHeight-sh)/2,sw,sh,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.65);
  }
  private async pump(){
    this.busy=true;
    try{while(!this.disposed&&this.queue.size){
      const [key,job]=this.queue.entries().next().value!;this.queue.delete(key);
      if(![...job.nodes].some(n=>n.isConnected)||this.failed.has(job.asset.url))continue;
      this.active=job;
      try{
        const url=await this.decode(job.asset,job.at);if(this.disposed)break;
        this.cache.set(key,url);while(this.cache.size>MAX_CACHE)this.cache.delete(this.cache.keys().next().value!);
        for(const node of job.nodes)if(node.isConnected&&node.dataset.frameKey===key){node.src=url;node.dataset.frameReady='true';}
      }catch{if(!this.disposed)this.failed.add(job.asset.url);}finally{this.active=null;}
    }}finally{this.busy=false;}
  }
  dispose(){
    this.disposed=true;this.life.abort();cancelAnimationFrame(this.frame);this.resize.disconnect();this.scroll.removeEventListener('scroll',this.schedule);
    this.queue.clear();this.cache.clear();this.failed.clear();this.video.pause();this.video.removeAttribute('src');this.video.load();
  }
}
