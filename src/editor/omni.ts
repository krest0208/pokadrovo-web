import { sessionCsrf, currentUser, flushProjectSaves } from '../account/api';
import type { AiMedia, AiProvider, AiRequest, AiService, AiStatus } from './ai';

export interface MediaAnalysis {
 clipId:string;assetId:string;duration:number;summary:string;speech:string;audio:string;
 events:{from:number;to:number;visual:string;audio:string;speech:string}[];limitations:string[];advice?:string[];scope?:'visual'|'audiovisual';
}
export interface OmniResult {plan:unknown|null;analysis:MediaAnalysis|null;summary:string;usage:{inputTokens:number|null;outputTokens:number|null};billing?:{chargedCoins:number;remainingCoins:number|null};}

/** Credentials and provider URLs never enter the browser. Context stays in this editor session. */
export class OmniAiProvider implements AiProvider {
 readonly name='Покадрово AI';
 readonly modes=[{id:'source-analysis',label:'Разбор исходника · проба'},{id:'deepseek-edit',label:'План монтажа · проба'},{id:'reels-trial',label:'Qwen Omni · видео и звук'},{id:'yandex-edit',label:'AI Studio · план монтажа'}] as const;
 constructor(public service:AiService='source-analysis'){}
 get supportsMedia(){return this.service==='reels-trial'||this.service==='source-analysis';}
 setService(service:AiService){this.service=service;}
 private context:{projectId:string;analysis:MediaAnalysis}|null=null;
 async getStatus(signal?:AbortSignal){
  const r=await fetch('/api/ai/status?service='+this.service,{credentials:'same-origin',redirect:'error',signal,headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('Не удалось проверить подключение ИИ.');
  const s=await r.json();if(typeof s.available!=='boolean'||typeof s.reason!=='string')throw Error('Некорректный статус ИИ.');
  return s as AiStatus;
 }
 async createPlan(request:AiRequest,signal:AbortSignal,media?:AiMedia):Promise<OmniResult>{
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal.aborted)throw new DOMException('Запрос отменён','AbortError');
  signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,100000);
  const service=this.service,accountId=currentUser()?.id;
  let context:MediaAnalysis|null=null;
  if(this.context?.projectId===request.projectId){
   const a=this.context.analysis;
   if([...request.project.clips,...request.project.audio].some(c=>c.id===a.clipId&&c.assetId===a.assetId))context=a;
  }
  try{
   await flushProjectSaves();
   if(!accountId||currentUser()?.id!==accountId)throw Error('Аккаунт изменился. Откройте проект заново.');
   if((service==='yandex-edit'||service==='deepseek-edit')&&media)throw Error('В этом режиме исходный файл не отправляется.');
   const response=await fetch('/api/ai/edit-plan',{method:'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,
    headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRF-Token':sessionCsrf(),'X-PK-Account':accountId},
    body:JSON.stringify({service,request,media,mediaConsent:!!media,context:media?null:context})});
   if(!response.body||!response.headers.get('content-type')?.includes('application/json'))throw Error('Сервис ИИ вернул неожиданный ответ.');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>512000)throw Error('Ответ ИИ слишком большой.');chunks.push(r.value);}}
   finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
   const result=JSON.parse(new TextDecoder().decode(bytes));
   if(!response.ok)throw Error(typeof result.error==='string'?result.error:`Сервис ИИ недоступен (${response.status}).`);
   if(!result||typeof result!=='object'||!('plan' in result)||!('analysis' in result)||typeof result.summary!=='string')throw Error('Некорректный результат ИИ.');
   if(result.analysis)this.context={projectId:request.projectId,analysis:result.analysis};
   return result as OmniResult;
  }catch(error){if(controller.signal.aborted)throw Error('Запрос отменён или завершился по времени. Повторно он автоматически не отправляется.');throw error;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);if(accountId&&currentUser()?.id===accountId)window.dispatchEvent(new CustomEvent('pokadrovo:balance-changed',{detail:{accountId}}));}
 }
}
