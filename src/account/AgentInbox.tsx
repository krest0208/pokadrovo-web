import * as React from 'react';
import { currentUser, request } from './api';
import './agent-inbox.css';

export interface AgentStatus {
 enabled:boolean;useAi:boolean;running:boolean;unread:number;nextRun:number|null;lastRun:number|null;
 aiStatus:string;lastReport:{id:number;at:number;status:string}|null;openFindings:number;retentionDays:number;
}
interface Idea {key:string;title:string;details:string;basis:string;source:'ai'|'rule';state?:'new'|'planned'|'dismissed';}
interface Report {
 id:number;at:number;status:string;read:boolean;title:string;summary:string;trigger:string;
 findings:{key:string;severity:string;title:string;evidence:string}[];newFindingKeys:string[];
 resolvedFindings:{key:string;title:string}[];ideas:Idea[];ideasNote?:string;
 scope:string[];notChecked:string[];checks:{key:string;label:string;status:string;detail:string}[];
}
interface Page {items:Report[];nextBefore:string|null;status:AgentStatus;}
const date=(time:number|null)=>time?new Date(time).toLocaleString('ru-RU'):'Пока нет';
const stateName:Record<string,string>={ok:'Проверка пройдена',warning:'Есть замечания',critical:'Требует внимания',error:'Проверка прервана'};
export function useOwnerAgentStatus(enabled:boolean){
 const [status,setStatus]=React.useState<AgentStatus|null>(null),generation=React.useRef(0);
 const refresh=React.useCallback(async()=>{
  if(!enabled)return;const gen=++generation.current;
  try{const next=await request<AgentStatus>('/agent/status');if(gen===generation.current&&currentUser()?.role==='owner')setStatus(next);}catch{}
 },[enabled]);
 React.useEffect(()=>{setStatus(null);if(!enabled)return;void refresh();const timer=setInterval(()=>void refresh(),60000);return()=>{clearInterval(timer);generation.current++;};},[enabled,refresh]);
 return {status,refresh};
}
export function AgentInbox({status,onRefresh}:{status:AgentStatus|null;onRefresh:()=>Promise<void>}){
 const [reports,setReports]=React.useState<Report[]>([]),[ideas,setIdeas]=React.useState<Idea[]>([]),[before,setBefore]=React.useState<string|null>(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
 const mounted=React.useRef(true),operation=React.useRef(false);
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const load=React.useCallback(async(cursor?:string)=>{
  if(operation.current)return;operation.current=true;setBusy(true);setError('');
  try{
   const [page,list]=await Promise.all([request<Page>('/agent/reports'+(cursor?'?before='+encodeURIComponent(cursor):'')),request<{items:Idea[]}>('/agent/ideas')]);
   if(!mounted.current||currentUser()?.role!=='owner')return;
   setReports(old=>cursor?[...old,...page.items.filter(r=>!old.some(o=>o.id===r.id))]:page.items);setBefore(page.nextBefore);setIdeas(list.items);await onRefresh();
  }catch(e){if(mounted.current)setError((e as Error).message);}finally{operation.current=false;if(mounted.current)setBusy(false);}
 },[onRefresh]);
 React.useEffect(()=>{void load();},[load,status?.lastReport?.id]);
 async function read(id:number){
  try{await request('/agent/reports/'+id+'/read','POST',{});if(!mounted.current)return;setReports(old=>old.map(r=>r.id===id?{...r,read:true}:r));await onRefresh();}
  catch(e){if(mounted.current)setError((e as Error).message);}
 }
 async function readAll(){try{await request('/agent/read-all','POST',{});if(!mounted.current)return;setReports(old=>old.map(r=>({...r,read:true})));await onRefresh();}catch(e){if(mounted.current)setError((e as Error).message);}}
 async function changeIdea(key:string,state:'new'|'planned'|'dismissed'){
  try{await request('/agent/ideas/state','POST',{key,state});if(mounted.current){const item=reports.flatMap(r=>r.ideas).find(i=>i.key===key);setIdeas(old=>old.some(i=>i.key===key)?old.map(i=>i.key===key?{...i,state}:i):item?[{...item,state},...old]:old);setReports(old=>old.map(r=>({...r,ideas:r.ideas.map(i=>i.key===key?{...i,state}:i)})));}}
  catch(e){if(mounted.current)setError((e as Error).message);}
 }
 function idea(item:Idea){const current=ideas.find(i=>i.key===item.key)?.state||item.state||'new';return <article className={'ag-idea '+(current==='dismissed'?'ag-muted':'')} key={item.key}>
  <span className="ag-eyebrow">{item.source==='ai'?'ИДЕЯ ОТ ИИ':'ПРЕДЛОЖЕНИЕ ПО РАЗВИТИЮ'}</span><h3>{item.title}</h3><p>{item.details}</p><p className="ag-basis">{item.basis}</p>
  <div className="ag-actions"><button onClick={()=>void changeIdea(item.key,current==='planned'?'new':'planned')}>{current==='planned'?'В плане ✓':'Добавить в план'}</button><button onClick={()=>void changeIdea(item.key,current==='dismissed'?'new':'dismissed')}>{current==='dismissed'?'Вернуть идею':'Скрыть идею'}</button></div>
 </article>;}
 return <section className="agent-inbox" aria-label="Сообщения агента">
  <div className="ag-overview"><div><span className="ag-eyebrow">АГЕНТ ПОКАДРОВО</span><h2>{status?.running?'Проверка выполняется':status?.enabled?'Следит за сайтом каждый час':'Автопроверка на паузе'}</h2><p>Следующая проверка: {date(status?.nextRun||null)}. Сообщения видны только владельцу.</p></div><a href="/profile#agent" className="ag-frequency">Каждый час</a></div>
  <div className="ag-toolbar"><span>{status?.unread||0} непрочитанных отчётов</span><div><button onClick={()=>void load()} disabled={busy}>Обновить</button><button onClick={()=>void readAll()} disabled={!status?.unread||busy}>Прочитать все</button></div></div>
  {error&&<p className="au-error" role="alert">{error}</p>}
  {!reports.length&&!busy&&<div className="ag-empty"><h3>Здесь появится первый отчёт</h3><p>После запуска агента на сервере он проверит сайт и сохранит результат в этом аккаунте. Управление доступно в админ-панели, раздел «Агент сайта».</p></div>}
  <div className="ag-reports">{reports.map(report=><details className={'ag-report '+(!report.read?'ag-unread':'')} key={report.id} onToggle={event=>{if(event.currentTarget.open&&!report.read)void read(report.id);}}>
   <summary><span className={'ag-badge ag-'+report.status}>{stateName[report.status]||report.status}</span><span className="ag-report-title"><strong>{report.title}</strong><span>{report.summary}</span></span><time dateTime={new Date(report.at).toISOString()}>{date(report.at)}</time>{!report.read&&<span className="ag-new">Новое</span>}</summary>
   <div className="ag-report-body">
    {report.findings.length>0&&<><h3>Результаты проверки</h3><ul className="ag-findings">{report.findings.map(f=><li key={f.key}><strong>{f.title}{report.newFindingKeys.includes(f.key)&&<span className="ag-new">Впервые</span>}</strong><p>{f.evidence}</p></li>)}</ul></>}
    {report.resolvedFindings.length>0&&<p className="ag-resolved">Больше не воспроизводится: {report.resolvedFindings.map(f=>f.title).join(', ')}.</p>}
    {report.ideas.map(idea)}{report.ideasNote&&<p className="ag-basis">{report.ideasNote}</p>}
    <details className="ag-coverage"><summary>Что проверено</summary><ul>{report.scope.map(s=><li key={s}>{s}</li>)}</ul><ul>{report.checks.map(c=><li key={c.key}><strong>{c.label}: </strong>{c.detail}</li>)}</ul><p>В эту проверку не входили: {report.notChecked.join('; ')}.</p></details>
   </div>
  </details>)}</div>
  {before&&<button className="au-primary" disabled={busy} onClick={()=>void load(before)}>Более ранние отчёты</button>}
  {ideas.some(i=>i.state==='planned')&&<section className="ag-planned"><h2>Идеи в плане</h2>{ideas.filter(i=>i.state==='planned').map(idea)}</section>}
  <p className="ag-footnote">Отчёты хранятся {status?.retentionDays||90} дней. Агент проверяет доступные ему признаки и предлагает улучшения. Он не меняет сайт автоматически.</p>
 </section>;
}
