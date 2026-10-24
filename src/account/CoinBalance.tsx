import * as React from 'react';
import CoinMark from '../CoinMark';
import {currentUser} from './api';
import './coin-balance.css';

type Balance={account:string;kind:'ready';coins:number|null;exempt:boolean;cost:number}|{account:string;kind:'error'};
type Props={accountId:string|null|undefined;theme:'light'|'dark';onSignIn?:()=>void;onPlans:()=>void};
const coins=(n:number)=>`${n.toLocaleString('ru-RU')} ${n%10===1&&n%100!==11?'монета':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'монеты':'монет'}`;
export default function CoinBalance({accountId,theme,onSignIn,onPlans}:Props){
 const [state,setState]=React.useState<Balance|null>(null);
 const root=React.useRef<HTMLDetailsElement>(null),refresh=React.useRef(()=>{});
 const panelId=React.useId();
 React.useEffect(()=>{
  if(!accountId){refresh.current=()=>{};return;}
  let alive=true,revision=0,controller:AbortController|null=null;
  const load=async()=>{
   const ticket=++revision;controller?.abort();const next=new AbortController();controller=next;
   const timeout=setTimeout(()=>next.abort(),10000);
   try{
    const response=await fetch('/api/ai/status?service=source-analysis',{credentials:'same-origin',redirect:'error',signal:next.signal,headers:{Accept:'application/json','X-PK-Account':accountId}});
    if(!response.ok)throw Error('Balance unavailable');
    const data=await response.json(),b=data.billing;
    if(!b||b.unit!=='coin'||typeof b.ownerExempt!=='boolean'||(b.ownerExempt?b.remainingCoins!==null:!Number.isSafeInteger(b.remainingCoins)||b.remainingCoins<0)||!Number.isSafeInteger(b.requestCostCoins)||b.requestCostCoins<0)throw Error('Invalid balance');
    if(alive&&ticket===revision&&currentUser()?.id===accountId)setState({account:accountId,kind:'ready',coins:b.remainingCoins,exempt:b.ownerExempt,cost:b.requestCostCoins});
   }catch{
    if(alive&&ticket===revision&&currentUser()?.id===accountId)setState({account:accountId,kind:'error'});
   }finally{clearTimeout(timeout);}
  };
  refresh.current=()=>void load();void load();
  const changed=(event:Event)=>{if((event as CustomEvent).detail?.accountId===accountId)void load();};
  const focused=()=>{if(!document.hidden)void load();};
  window.addEventListener('focus',focused);window.addEventListener('pokadrovo:balance-changed',changed);
  const timer=setInterval(focused,30000);
  return()=>{alive=false;revision++;controller?.abort();clearInterval(timer);window.removeEventListener('focus',focused);window.removeEventListener('pokadrovo:balance-changed',changed);refresh.current=()=>{};};
 },[accountId]);
 React.useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))root.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&root.current?.open){event.stopPropagation();root.current.open=false;root.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 const value=state?.account===accountId?state:null;
 const pending=accountId===undefined||!!accountId&&!value;
 const label=pending?'Проверяем баланс':!accountId?'Войдите, чтобы увидеть баланс':value?.kind==='error'?'Баланс временно недоступен':value?.kind==='ready'&&value.exempt?'Монеты не списываются':value?.kind==='ready'?`Баланс: ${coins(value.coins!)}`:'';
 const number=pending?'…':value?.kind==='ready'?value.exempt?'∞':value.coins!.toLocaleString('ru-RU'):'—';
 return <><details ref={root} className="pk-coin-balance" data-theme={theme}>
  <summary aria-label={label} aria-controls={panelId} title={label}><CoinMark size={25}/><span aria-hidden="true">{number}</span></summary>
  <div id={panelId} className="pk-balance-panel"><strong>Монеты Покадрово</strong>
   <div className="pk-balance-total"><CoinMark size={38}/><b>{value?.kind==='ready'?value.exempt?'Без списаний':coins(value.coins!):pending?'Проверяем…':accountId?'Нет связи':'Войдите в аккаунт'}</b></div>
   <p>{value?.kind==='ready'?value.exempt?'Монеты не расходуются. Лимиты подключённого ИИ-сервиса действуют.':`Пробный баланс. ИИ-запрос — ${coins(value.cost)}. При ошибке монета возвращается.`:pending?'Получаем актуальный остаток.':accountId?'Не удалось получить баланс. Проверьте связь и обновите его.':'После входа здесь появится ваш баланс монет.'}</p>
   {value?.kind==='ready'&&<p>Покупка монет недоступна.</p>}
   <div className="pk-balance-actions">{!accountId&&!pending&&onSignIn?<button type="button" className="pk-balance-action is-primary" onClick={onSignIn}>Войти</button>:accountId?<button type="button" className="pk-balance-action" onClick={()=>refresh.current()}>Обновить</button>:null}<button type="button" className="pk-balance-action" onClick={onPlans}>Тарифы и нейросети</button></div>
  </div>
 </details><span className="pk-balance-sr" role="status" aria-atomic="true">{label}</span></>;
}
