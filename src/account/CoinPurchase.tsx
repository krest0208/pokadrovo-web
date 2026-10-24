import * as React from 'react';
import {currentUser,sessionCsrf} from './api';
type Package={id:string;coins:number;priceRub:string|null};
type Catalog={available:boolean;version:string;offerUrl:string;packages:Package[]};
type Order={id:number;coins:number;priceRub:string;test:boolean;status:string};
const statuses:Record<string,string>={pending:'Ожидает оплаты',paid:'Оплачен',partially_refunded:'Частичный возврат',refunded:'Возвращён'};
export default function CoinPurchase({accountId,exempt}:{accountId:string;exempt:boolean}){
 const [catalog,setCatalog]=React.useState<Catalog|null>(null),[orders,setOrders]=React.useState<Order[]>([]),[accepted,setAccepted]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const attempt=React.useRef<{packageId:string;version:string;requestId:string}|null>(null),locked=React.useRef(false),alive=React.useRef(true);
 const check=()=>{if(currentUser()?.id!==accountId)throw Error('Аккаунт изменился. Обновите страницу.');};
 async function api(path:string,body?:unknown){
  check();const response=await fetch('/api/billing/'+path,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','X-PK-Account':accountId,...(body?{'Content-Type':'application/json','X-CSRF-Token':sessionCsrf()}: {})},...(body?{body:JSON.stringify(body)}:{})});
  check();const data=await response.json();if(!response.ok)throw Error(data.error||'Не удалось получить данные оплаты.');return data;
 }
 const load=async()=>{
  setError('');try{const [c,h]=await Promise.all([api('catalog'),api('orders')]);if(alive.current){setCatalog(c);setOrders(h.items);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Нет связи с сервером.');}
 };
 React.useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[accountId]);
 async function buy(p:Package){
  if(locked.current||!catalog||!accepted||!catalog.available)return;
  locked.current=true;setBusy(true);setError('');
  const previous=attempt.current;
  if(!previous||previous.packageId!==p.id||previous.version!==catalog.version)attempt.current={packageId:p.id,version:catalog.version,requestId:crypto.randomUUID()};
  try{const order=await api('orders',{...attempt.current,acceptedTerms:true});if(!alive.current)return;if(!/^\/api\/billing\/pay\/[1-9]\d*$/.test(order.checkoutPath))throw Error('Не удалось открыть оплату.');window.location.assign(order.checkoutPath);}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Нет связи. Повторная попытка откроет тот же счёт.');}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <div className="pk-coin-purchase">
  {!catalog&&!error&&<p role="status">Получаем пакеты и историю…</p>}
  {catalog&&!exempt&&(catalog.available?<><strong>Пополнить баланс</strong><div className="pk-coin-packages">{catalog.packages.map(p=><button key={p.id} type="button" className="pk-balance-action" disabled={!accepted||busy} onClick={()=>void buy(p)}><span>{p.coins.toLocaleString('ru-RU')} монет</span><b>{p.priceRub} ₽</b></button>)}</div><label className="pk-coin-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>Принимаю <a href={catalog.offerUrl} target="_blank" rel="noopener noreferrer">условия покупки</a></span></label><p>Оплата на защищённой странице Robokassa. Реквизиты карты в Покадрово не вводятся.</p></>:<p>Покупка монет пока недоступна.</p>)}
  {error&&<><p role="alert">{error}</p><button className="pk-balance-action" type="button" disabled={busy} onClick={()=>void load()}>Повторить проверку</button></>}
  {!!orders.length&&<details className="pk-coin-history"><summary>История покупок</summary><ul>{orders.map(o=><li key={o.id}><strong>№{o.id} · {o.priceRub} ₽</strong><span>{o.coins} монет · {o.test?'Тест · ':''}{statuses[o.status]||'Проверяется'}</span>{o.status==='pending'&&<a className="pk-balance-action" href={'/api/billing/pay/'+o.id}>Продолжить оплату</a>}</li>)}</ul></details>}
 </div>;
}
