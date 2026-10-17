import {
  Project, Selection, Clip, Caption, Ratio, clone, normalizeProject, normalizeCaption,
  splitClip, cutRange, uid, totalLength
} from './model';
import { editorFonts } from './fonts';

export const AI_PROTOCOL_VERSION=1 as const;
export const AI_CAPABILITIES=['remove','split','trim','speed','volume','transform','caption','ratio','audioAt','cutRange'] as const;
type Track=Selection['track'];
type Operation =
 | {type:'remove';track:Track;id:string}
 | {type:'split';track:Track;id:string;offset:number}
 | {type:'trim';track:'video'|'audio';id:string;start:number;end:number}
 | {type:'speed';track:'video'|'audio';id:string;value:number}
 | {type:'volume';track:'video'|'audio';id:string;value:number;muted:boolean}
 | {type:'transform';id:string;patch:Partial<Clip>}
 | {type:'caption';text:string;from:number;to:number;fontId:string}
 | {type:'ratio';value:Ratio}
 | {type:'audioAt';id:string;at:number}
 | {type:'cutRange';from:number;to:number};
export interface AiRequest {
  version:1; requestId:string; projectId:string; revision:string; prompt:string;
  project:Project; cursor:number; selection:Selection|null;
  capabilities:typeof AI_CAPABILITIES; fontIds:string[];
}
export interface AiPlan { version:1; requestId:string; projectId:string; revision:string; summary:string; operations:Operation[]; }
export interface AiProvider {
  readonly name:string;
  createPlan(request:AiRequest,signal:AbortSignal):Promise<unknown>;
}
const snapshot=(p:Project)=>JSON.stringify(normalizeProject(p));
/** Change marker, not an authentication token. Apply also compares the complete snapshot. */
export async function projectRevision(project:Project):Promise<string>{
  const value=snapshot(project);let a=0x811c9dc5,b=0x9e3779b9;
  for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x85ebca6b);}
  return 'pk1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export async function createAiRequest(p:Project,prompt:string,cursor=0,selection:Selection|null=null):Promise<AiRequest>{
  if(!prompt.trim()||prompt.length>4000)throw Error('Опишите монтаж: от 1 до 4000 символов.');
  const project=normalizeProject(clone(p));
  return {version:1,requestId:uid(),projectId:project.id,revision:await projectRevision(project),
    prompt:prompt.trim(),project,cursor,selection:selection?{...selection}:null,
    capabilities:AI_CAPABILITIES,fontIds:editorFonts().map(f=>f.id)};
}
function record(v:unknown):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Ожидается объект плана.');
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)throw Error('Недопустимый объект.');
  const r=v as Record<string,unknown>;
  if(['__proto__','constructor','prototype'].some(k=>Object.hasOwn(r,k)))throw Error('Недопустимое поле.');
  return r;
}
function keys(r:Record<string,unknown>,allowed:string[]){
  if(Object.keys(r).some(k=>!allowed.includes(k)))throw Error('Неизвестное поле операции.');
  if(allowed.some(k=>!Object.hasOwn(r,k)))throw Error('Неполная операция.');
}
function num(v:unknown,a:number,b:number):number{
  if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b)throw Error('Параметр вне допустимого диапазона.');
  return v;
}
function text(v:unknown,max:number,empty=false):string{
  if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))throw Error('Некорректная строка.');
  return v;
}
const id=(v:unknown)=>{const s=text(v,120);if(!/^[a-zA-Z0-9_.-]+$/.test(s))throw Error('Некорректный ID.');return s;};
const track=(v:unknown,audioVideo=false):Track=>{
  if(v!=='video'&&v!=='audio'&&(!audioVideo&&v!=='text'||audioVideo))throw Error('Неизвестная дорожка.');
  return v as Track;
};
const transformLimits:Record<string,[number,number]>={
  x:[-100,100],y:[-100,100],zoom:[.25,4],scaleX:[.05,8],scaleY:[.05,8],
  rotation:[-180,180],opacity:[0,1],brightness:[0,2],contrast:[0,2],saturation:[0,2],
  cropLeft:[0,.9],cropRight:[0,.9],cropTop:[0,.9],cropBottom:[0,.9],corner:[0,.5]
};
function transform(v:unknown):Partial<Clip>{
  const r=record(v);if(!Object.keys(r).length)throw Error('Пустая трансформация.');
  for(const [k,value] of Object.entries(r)){
    if(transformLimits[k])num(value,...transformLimits[k]);
    else if(k==='shape'){if(!['rect','round','ellipse'].includes(String(value)))throw Error('Неизвестная форма.');}
    else if(k==='fit'){if(value!=='contain'&&value!=='cover')throw Error('Неизвестный режим.');}
    else if(k==='flip'){if(typeof value!=='boolean')throw Error('flip должен быть boolean.');}
    else throw Error('Недоступный инструмент трансформации.');
  }
  return {...r} as Partial<Clip>;
}
export function validateAiPlan(input:unknown,request:AiRequest):AiPlan{
  const plan=record(input);keys(plan,['version','requestId','projectId','revision','summary','operations']);
  if(plan.version!==1||plan.requestId!==request.requestId||plan.projectId!==request.projectId||plan.revision!==request.revision)
    throw Error('План относится к другому запросу или версии проекта.');
  const summary=text(plan.summary,2000);
  if(!Array.isArray(plan.operations)||plan.operations.length<1||plan.operations.length>100)throw Error('План должен содержать от 1 до 100 действий.');
  const operations:Operation[]=plan.operations.map((input,index)=>{
    const o=record(input);
    try{
      switch(o.type){
        case 'remove':keys(o,['type','track','id']);return {type:'remove',track:track(o.track),id:id(o.id)};
        case 'split':keys(o,['type','track','id','offset']);return {type:'split',track:track(o.track),id:id(o.id),offset:num(o.offset,.04,86400)};
        case 'trim':keys(o,['type','track','id','start','end']);return {type:'trim',track:track(o.track,true) as 'video'|'audio',id:id(o.id),start:num(o.start,0,86400),end:num(o.end,.04,86400)};
        case 'speed':keys(o,['type','track','id','value']);return {type:'speed',track:track(o.track,true) as 'video'|'audio',id:id(o.id),value:num(o.value,.25,4)};
        case 'volume':keys(o,['type','track','id','value','muted']);if(typeof o.muted!=='boolean')throw Error('muted должен быть boolean.');return {type:'volume',track:track(o.track,true) as 'video'|'audio',id:id(o.id),value:num(o.value,0,2),muted:o.muted};
        case 'transform':keys(o,['type','id','patch']);return {type:'transform',id:id(o.id),patch:transform(o.patch)};
        case 'caption':keys(o,['type','text','from','to','fontId']);if(!request.fontIds.includes(String(o.fontId)))throw Error('Неизвестный шрифт.');return {type:'caption',text:text(o.text,1200),from:num(o.from,0,86400),to:num(o.to,.04,86400),fontId:String(o.fontId)};
        case 'ratio':keys(o,['type','value']);if(!['16:9','9:16','1:1','4:5'].includes(String(o.value)))throw Error('Неизвестный формат.');return {type:'ratio',value:o.value as Ratio};
        case 'audioAt':keys(o,['type','id','at']);return {type:'audioAt',id:id(o.id),at:num(o.at,0,86400)};
        case 'cutRange':keys(o,['type','from','to']);return {type:'cutRange',from:num(o.from,0,86400),to:num(o.to,.04,86400)};
        default:throw Error('Инструмент не поддерживается.');
      }
    }catch(e){throw Error(`Действие ${index+1}: ${e instanceof Error?e.message:String(e)}`);}
  });
  const result:AiPlan={version:1,requestId:request.requestId,projectId:request.projectId,revision:request.revision,summary,operations};
  simulateAiPlan(request.project,result);
  return result;
}
/** Dry-run and apply share this atomic evaluator. No eval, HTML, filesystem or network actions. */
export function simulateAiPlan(project:Project,plan:AiPlan):Project{
  let p=clone(project);
  const collection=(t:Track):(Clip|Caption)[]=>t==='video'?p.clips:t==='audio'?p.audio:p.texts;
  function find(t:Track,id:string){const list=collection(t),index=list.findIndex(c=>c.id===id);if(index<0)throw Error('Целевой клип отсутствует.');return {list,index,item:list[index]};}
  plan.operations.forEach((o,i)=>{
    const newId=`ai-${plan.requestId.slice(0,24)}-${i}`;
    if(o.type==='ratio'){p.ratio=o.value;p.mode=o.value==='9:16'?'reels':'video';return;}
    if(o.type==='cutRange'){if(o.to-o.from<.04||o.to>totalLength(p))throw Error('Диапазон вне проекта.');p=cutRange(p,o.from,o.to);return;}
    if(o.type==='caption'){
      if(o.to-o.from<.04)throw Error('Некорректное время текста.');
      p.texts.push(normalizeCaption({id:newId,text:o.text,from:o.from,to:o.to,fontId:o.fontId}));return;
    }
    const {item,index,list}=find(o.type==='transform'?'video':o.type==='audioAt'?'audio':o.track,o.id);
    if(o.type==='remove'){list.splice(index,1);return;}
    if(o.type==='split'){
      if(o.track==='text'){const c=item as Caption,at=c.from+o.offset;if(at>=c.to-.04)throw Error('Точка разделения вне текста.');p.texts.splice(index,1,{...c,to:at},{...c,id:newId,from:at});}
      else{const pair=splitClip(item as Clip,o.offset);if(!pair)throw Error('Точка разделения вне клипа.');pair[1].id=newId;(o.track==='video'?p.clips:p.audio).splice(index,1,...pair);}return;
    }
    const c=item as Clip;
    if(o.type==='trim'){if(o.end-o.start<.04||o.end>c.duration)throw Error('Обрезка вне исходного файла.');c.start=o.start;c.end=o.end;}
    if(o.type==='speed'){if(c.kind==='image')throw Error('Для фотографии меняйте длительность.');c.speed=o.value;}
    if(o.type==='volume'){if(c.kind==='image')throw Error('У изображения нет аудио.');c.volume=o.value;c.muted=o.muted;}
    if(o.type==='audioAt')c.at=o.at;
    if(o.type==='transform'){
      Object.assign(c,o.patch);
      if(c.cropLeft+c.cropRight>.9||c.cropTop+c.cropBottom>.9)throw Error('Кадрирование оставляет слишком мало изображения.');
    }
  });
  if(totalLength(p)>86400||p.clips.length>1000||p.audio.length>1000||p.texts.length>1000)throw Error('Превышен лимит проекта.');
  return normalizeProject(p);
}
export async function applyAiPlan(current:Project,request:AiRequest,plan:AiPlan):Promise<Project>{
  if(await projectRevision(current)!==request.revision||snapshot(current)!==snapshot(request.project))throw Error('Проект изменился. Запросите новый план.');
  return simulateAiPlan(current,validateAiPlan(plan,request));
}
/** Opt-in adapter. Instantiate on the server-enabled build only. No credentials in frontend. */
export class HttpAiProvider implements AiProvider {
  readonly name='Сервер Покадрово';
  constructor(private endpoint='/api/ai/edit-plan'){
    if(!/^\/api\/[a-zA-Z0-9_/-]+$/.test(endpoint))throw Error('AI endpoint must be same-origin /api/.');
  }
  async createPlan(request:AiRequest,signal:AbortSignal):Promise<unknown>{
    const controller=new AbortController(),relay=()=>controller.abort();
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    signal.addEventListener('abort',relay,{once:true});
    const timer=setTimeout(()=>controller.abort(),60000);
    try{
      const res=await fetch(this.endpoint,{method:'POST',credentials:'same-origin',redirect:'error',
        headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(request),signal:controller.signal});
      if(!res.ok)throw Error(`Сервис ИИ недоступен (${res.status}).`);
      if(!res.headers.get('Content-Type')?.includes('application/json')||!res.body)throw Error('Сервис вернул не JSON.');
      const reader=res.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512000){await reader.cancel();throw Error('Ответ ИИ слишком большой.');}chunks.push(value);}}
      finally{reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      return JSON.parse(new TextDecoder().decode(bytes));
    }finally{clearTimeout(timer);signal.removeEventListener('abort',relay);}
  }
}
