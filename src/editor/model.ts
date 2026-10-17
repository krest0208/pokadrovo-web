/** Versioned project document. Time coordinates are seconds; crop coordinates are percentages. */
export type Mode = 'video' | 'reels';
export type Ratio = '16:9' | '9:16' | '1:1' | '4:5';
export type Kind = 'video' | 'image' | 'audio';
export interface Clip {
  id:string; assetId:string; name:string; kind:Kind; duration:number;
  start:number; end:number; speed:number; volume:number; muted:boolean;
  fadeIn:number; fadeOut:number; at:number; fit:'contain'|'cover';
  zoom:number; x:number; y:number; rotation:number; flip:boolean;
  brightness:number; contrast:number; saturation:number; opacity:number;
  visualIn:number; visualOut:number;
  scaleX:number; scaleY:number; shape:'rect'|'round'|'ellipse';
  corner:number; cropLeft:number; cropRight:number; cropTop:number; cropBottom:number;
}
export interface Caption { id:string; text:string; from:number; to:number; x:number; y:number; size:number; color:string; background:boolean; fontId:string; weight:number; italic:boolean; align:'left'|'center'|'right'; }
export interface Project {
  id:string; schema:4; name:string; mode:Mode; ratio:Ratio; clips:Clip[]; audio:Clip[]; texts:Caption[];
  title:string; brief:string; created:number; modified:number; master:number;
}
export interface Asset { id:string; name:string; kind:Kind; blob:Blob; url:string; duration:number; width:number; height:number; thumbnail:string; }
export interface Selection { track:'video'|'audio'|'text'; id:string; }
export const STORAGE_KEY='pokadrovo-projects-v1';
export const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
export const uid=()=>globalThis.crypto?.randomUUID?.() || 'pk-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const number=(v:unknown,d:number,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)?clamp(v,a,b):d;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
const string=(v:unknown,d='')=>typeof v==='string'?v.slice(0,10000):d;
const safeId=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,120}$/.test(v)?v:'';
export const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
export function newProject(mode:Mode='video',brief=''):Project {
 return {id:uid(),schema:4,name:mode==='reels'?'Reels / Shorts':'New project',mode,ratio:mode==='reels'?'9:16':'16:9',clips:[],audio:[],texts:[],title:'',brief,created:Date.now(),modified:Date.now(),master:1};
}
export function normalizeClip(value:unknown):Clip {
 const c=object(value), duration=number(c.duration,5,.04,86400), start=number(c.start,0,0,duration-.04);
 const cropLeft=number(c.cropLeft,0,0,.9),cropTop=number(c.cropTop,0,0,.9);
 return {id:safeId(c.id)||uid(),assetId:safeId(c.assetId),name:string(c.name,'Media'),kind:c.kind==='image'?'image':c.kind==='audio'?'audio':'video',duration,
 start,end:number(c.end,duration,start+.04,duration),speed:number(c.speed,1,.25,4),volume:number(c.volume,1,0,2),muted:c.muted===true,
 fadeIn:number(c.fadeIn,0,0,30),fadeOut:number(c.fadeOut,0,0,30),at:number(c.at,0,0,86400),fit:c.fit==='cover'?'cover':'contain',
 zoom:number(c.zoom,1,.25,4),x:number(c.x,0,-100,100),y:number(c.y,0,-100,100),rotation:number(c.rotation,0,-180,180),flip:c.flip===true,
 brightness:number(c.brightness,1,0,2),contrast:number(c.contrast,1,0,2),saturation:number(c.saturation,1,0,2),opacity:number(c.opacity,1,0,1),visualIn:number(c.visualIn,0,0,5),visualOut:number(c.visualOut,0,0,5),
 scaleX:number(c.scaleX,1,.05,8),scaleY:number(c.scaleY,1,.05,8),shape:c.shape==='ellipse'?'ellipse':c.shape==='round'?'round':'rect',
 corner:number(c.corner,.12,0,.5),cropLeft,cropTop,cropRight:number(c.cropRight,0,0,.9-cropLeft),cropBottom:number(c.cropBottom,0,0,.9-cropTop)};
}
export function normalizeCaption(value:unknown):Caption {
 const c=object(value), from=number(c.from,0,0,86400);
 return {id:safeId(c.id)||uid(),text:string(c.text).slice(0,1200),from,to:number(c.to,from+5,from+.04,86400),x:number(c.x,.5,0,1),y:number(c.y,.82,0,1),size:number(c.size,.065,.015,.2),color:typeof c.color==='string'&&/^#[\da-f]{6}$/i.test(c.color)?c.color:'#ffffff',background:c.background!==false,
 fontId:typeof c.fontId==='string'&&/^[a-z0-9_-]{1,64}$/.test(c.fontId)?c.fontId:'system',
 weight:[400,500,600,700,800,900].includes(Number(c.weight))?Number(c.weight):600,
 italic:c.italic===true,align:c.align==='left'?'left':c.align==='right'?'right':'center'};
}
export function normalizeProject(value:unknown):Project {
 const p=object(value);const fresh=newProject(p.mode==='reels'?'reels':'video',string(p.brief));
 const list=(v:unknown)=>Array.isArray(v)?v.slice(0,1000):[];
 const clips=list(p.clips).map(normalizeClip).filter(c=>c.kind!=='audio'&&c.assetId);
 const audio=list(p.audio).map(normalizeClip).filter(c=>c.assetId);
 let texts=list(p.texts).map(normalizeCaption);
 if(!('texts' in p)&&string(p.title)) texts=[normalizeCaption({text:p.title,from:0,to:Math.max(5,clips.reduce((n,c)=>n+length(c),0))})];
 return {...fresh,id:safeId(p.id)||fresh.id,name:string(p.name,fresh.name),ratio:['16:9','9:16','1:1','4:5'].includes(String(p.ratio))?p.ratio as Ratio:fresh.ratio,
 clips,audio,texts,created:number(p.created,Date.now(),0,1e15),modified:number(p.modified,Date.now(),0,1e15),master:number(p.master,1,0,1)};
}
export const length=(c:Clip)=>Math.max(.01,(c.end-c.start)/c.speed);
export const videoLength=(p:Project)=>p.clips.reduce((n,c)=>n+length(c),0);
export function totalLength(p:Project):number {return Math.max(videoLength(p),0,...p.audio.map(c=>c.at+length(c)),...p.texts.map(c=>c.to));}
export function positions(p:Project){let at=0;return p.clips.map(c=>{const r={clip:c,at,end:at+length(c)};at=r.end;return r;});}
export function currentClip(p:Project,time:number){return positions(p).find(c=>time>=c.at&&time<c.end);}
export function fromAsset(a:Asset):Clip {return normalizeClip({...a,blob:undefined,url:undefined,id:uid(),assetId:a.id,start:0,end:a.duration});}
export function patchClip(c:Clip,patch:Partial<Clip>){return normalizeClip({...c,...patch});}
export function splitClip(c:Clip,offset:number):[Clip,Clip]|null {
 const d=length(c);if(offset<.04||d-offset<.04)return null;
 const cut=c.start+offset*c.speed;
 return [{...c,end:cut,fadeOut:0,visualOut:0},{...c,id:uid(),start:cut,at:c.at+offset,fadeIn:0,visualIn:0}];
}
/** Ripple-remove a time range across all tracks, preserving source-time mapping at non-unit speeds. */
export function cutRange(p:Project,from:number,to:number):Project {
 const a=clamp(Math.min(from,to),0,totalLength(p)),b=clamp(Math.max(from,to),0,totalLength(p));
 if(b-a<.04)return clone(p);
 const cut=b-a,r=clone(p);r.clips=[];r.audio=[];r.texts=[];
 function fragments(c:Clip,at:number):Clip[]{
  const end=at+length(c);if(end<=a)return [{...c,at}];if(at>=b)return [{...c,at:at-cut}];
  const out:Clip[]=[];
  if(at<a)out.push({...c,at,end:c.start+(a-at)*c.speed,fadeOut:0,visualOut:0});
  if(end>b)out.push({...c,id:out.length?uid():c.id,at:Math.max(at,b)-cut,start:c.start+(b-at)*c.speed,fadeIn:0,visualIn:0});
  return out;
 }
 positions(p).forEach(({clip,at})=>r.clips.push(...fragments(clip,at)));
 p.audio.forEach(c=>r.audio.push(...fragments(c,c.at)));
 for(const t of p.texts){
  if(t.to<=a)r.texts.push({...t});else if(t.from>=b)r.texts.push({...t,from:t.from-cut,to:t.to-cut});
  else {if(t.from<a)r.texts.push({...t,to:a});if(t.to>b)r.texts.push({...t,id:uid(),from:Math.max(t.from,b)-cut,to:t.to-cut});}
 }
 return r;
}
export function fadeGain(c:Clip,offset:number):number {
 const d=length(c);if(offset<0||offset>=d||c.muted)return 0;
 return c.volume*Math.min(1,c.fadeIn?offset/c.fadeIn:1,c.fadeOut?(d-offset)/c.fadeOut:1);
}
export function dimensions(r:Ratio,quality=720):[number,number]{
 const [x,y]=r.split(':').map(Number);return x>=y?[Math.round(quality*x/y/2)*2,quality]:[quality,Math.round(quality*y/x/2)*2];
}
export function parseSrt(input:string):Caption[] {
 const time=(s:string)=>{const parts=s.replace(',','.').split(':').map(Number);return parts.length===3?parts[0]*3600+parts[1]*60+parts[2]:NaN;};
 return input.replace(/\r/g,'').trim().split(/\n\s*\n/).flatMap(block=>{
  const lines=block.split('\n'),index=lines.findIndex(s=>s.includes('-->'));if(index<0)return [];
  const [a,b]=lines[index].split('-->').map(s=>time(s.trim().split(/\s/)[0]));
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return [];
  return [normalizeCaption({text:lines.slice(index+1).join('\n').replace(/<[^>]+>/g,''),from:a,to:b})];
 }).slice(0,1000);
}
export class History {
 private past:Project[]=[];private future:Project[]=[];
 constructor(public value:Project){}
 commit(next:Project){this.past.push(clone(this.value));if(this.past.length>60)this.past.shift();this.future=[];this.value=normalizeProject({...next,modified:Date.now()});}
 undo(){const p=this.past.pop();if(p){this.future.push(clone(this.value));this.value=p;}return this.value;}
 redo(){const p=this.future.pop();if(p){this.past.push(clone(this.value));this.value=p;}return this.value;}
 get canUndo(){return this.past.length>0;}get canRedo(){return this.future.length>0;}
}
export const clock=(n:number)=>{const s=Math.max(0,n);return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}.${Math.floor((s%1)*1000).toString().padStart(3,'0')}`;};
