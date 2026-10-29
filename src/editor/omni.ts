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
 readonly modes=[{id:'reels-trial',label:'Смонтировать с ИИ'}] as const;
 constructor(public service:AiService='reels-trial'){if(service!=='reels-trial')throw Error('Этот режим недоступен.');}
 get supportsMedia(){return true;}
 setService(service:AiService){if(service!=='reels-trial')throw Error('Этот режим отключён.');this.service=service;}
 private context:{accountId:string;projectId:string;analysis:MediaAnalysis}|null=null;
 async getStatus(signal?:AbortSignal){
  const accountId=currentUser()?.id,csrf=sessionCsrf();
  const r=await fetch('/api/ai/status?service='+this.service,{credentials:'same-origin',redirect:'error',signal,headers:{Accept:'application/json',...(accountId?{'X-PK-Account':accountId}:{})}});
  if(!r.ok)throw Error('Не удалось проверить подключение ИИ.');
  const s=await r.json();if(currentUser()?.id!==accountId||sessionCsrf()!==csrf)throw Error('Аккаунт изменился. Обновите страницу.');
  if(!s||typeof s.available!=='boolean'||typeof s.reason!=='string')throw Error('Некорректный статус ИИ.');
  return s as AiStatus;
 }
 async createPlan(request:AiRequest,signal:AbortSignal,media?:AiMedia):Promise<OmniResult>{
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal.aborted)throw new DOMException('Запрос отменён','AbortError');
  const changed=()=>{this.context=null;controller.abort();};
  signal.addEventListener('abort',abort,{once:true});window.addEventListener('pokadrovo:before-account-change',changed);const timer=setTimeout(abort,100000);
  const service=this.service,accountId=currentUser()?.id,csrf=sessionCsrf();
  const check=()=>{if(controller.signal.aborted)throw new DOMException('Запрос отменён','AbortError');if(!accountId||currentUser()?.id!==accountId||sessionCsrf()!==csrf)throw Error('Аккаунт изменился. Откройте проект заново.');};
  let context:MediaAnalysis|null=null;
  if(this.context?.accountId===accountId&&this.context?.projectId===request.projectId){
   const a=this.context.analysis;
   if([...request.project.clips,...request.project.audio].some(c=>c.id===a.clipId&&c.assetId===a.assetId))context=a;
  }
  try{
   check();
   // A save may wait on the network. Cancel/timeout must also interrupt that wait.
   await new Promise<void>((resolve,reject)=>{
    const cancel=()=>reject(new DOMException('Запрос отменён','AbortError'));
    controller.signal.addEventListener('abort',cancel,{once:true});
    void flushProjectSaves().then(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},error=>{controller.signal.removeEventListener('abort',cancel);reject(error);});
   });
   check();
   if((service==='yandex-edit'||service==='deepseek-edit')&&media)throw Error('В этом режиме исходный файл не отправляется.');
   const response=await fetch('/api/ai/edit-plan',{method:'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,
    headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRF-Token':csrf,'X-PK-Account':accountId!},
    body:JSON.stringify({service,request,media,mediaConsent:!!media,context:media?null:context})});
   if(!response.body||!response.headers.get('content-type')?.includes('application/json'))throw Error('Сервис ИИ вернул неожиданный ответ.');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>512000)throw Error('Ответ ИИ слишком большой.');chunks.push(r.value);}}
   finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
   check();
   let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('Сервис ИИ вернул повреждённый ответ. Монтаж не изменён.');}
   if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('pokadrovo:session-expired'));throw Error(typeof result?.error==='string'?result.error:`Сервис ИИ недоступен (${response.status}).`);}
   if(!result||typeof result!=='object'||!('plan' in result)||!('analysis' in result)||typeof result.summary!=='string')throw Error('Некорректный результат ИИ.');
   if(result.analysis)this.context={accountId:accountId!,projectId:request.projectId,analysis:result.analysis};
   return result as OmniResult;
  }catch(error){if(controller.signal.aborted)throw Error('Запрос отменён или завершился по времени. Повторно он автоматически не отправляется.');throw error;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);window.removeEventListener('pokadrovo:before-account-change',changed);if(accountId&&currentUser()?.id===accountId)window.dispatchEvent(new CustomEvent('pokadrovo:balance-changed',{detail:{accountId}}));}
 }
}
