import {createHash} from 'node:crypto';
import {body,deny,json} from './http.mjs';
import {equal,token} from './security.mjs';
import pricing from '../shared/coin-pricing.json' with {type:'json'};

const GATEWAY='https://auth.robokassa.ru/Merchant/Index.aspx';
const MAX_MONEY=100000000,MAX_COINS=1000000000;
const packageList=pricing.packages.map((p,i)=>({...p,id:['start','author','studio'][i]}));
export function rubles(value){
 if(typeof value!=='string'||!/^\d{1,7}(?:\.\d{1,6})?$/.test(value))deny(400,'Некорректная сумма.');
 const [whole,fraction='']=value.split('.');if(fraction.slice(2).replace(/0/g,''))deny(400,'Сумма должна быть кратна копейке.');
 const minor=Number(whole)*100+Number(fraction.padEnd(2,'0').slice(0,2));
 if(!Number.isSafeInteger(minor)||minor<=0||minor>MAX_MONEY)deny(400,'Сумма вне допустимого диапазона.');return minor;
}
const amount=minor=>(minor/100).toFixed(2);
export function signature(parts,algorithm='sha256'){return createHash(algorithm).update(parts.join(':'),'utf8').digest('hex');}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const invoice=value=>typeof value==='string'&&/^[1-9]\d{0,9}$/.test(value)&&Number(value)<=2147483647?Number(value):deny(400,'Некорректный счёт.');
async function formBody(req){
 if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))deny(415,'Нужна форма UTF-8.');
 let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>16384)deny(413,'Слишком большой запрос.');chunks.push(c);}
 const data={},keys=new Set();for(const [key,value] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))){const lower=key.toLowerCase();if(keys.has(lower))deny(400,'Повторяющиеся параметры.');keys.add(lower);data[lower]=value;if(lower.startsWith('shp_')&&!['Shp_order','Shp_test'].includes(key))deny(400,'Неизвестные параметры подписи.');}return data;
}

export function createBilling({store,now,origin,session,sameOrigin,legal}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS coin_wallets(account_id TEXT PRIMARY KEY,coins INTEGER NOT NULL DEFAULT 0 CHECK(coins BETWEEN -1000000000 AND 1000000000));
 CREATE TABLE IF NOT EXISTS coin_ledger(id INTEGER PRIMARY KEY,account_id TEXT NOT NULL,delta INTEGER NOT NULL,reference TEXT UNIQUE NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS payment_orders(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,request_key TEXT NOT NULL,package_id TEXT NOT NULL,coins INTEGER NOT NULL,amount_minor INTEGER NOT NULL,is_test INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL,paid_at INTEGER,nonce TEXT NOT NULL,secret2 TEXT NOT NULL,algorithm TEXT NOT NULL,form_fields TEXT NOT NULL,terms_version TEXT NOT NULL,refunded_minor INTEGER NOT NULL DEFAULT 0,revoked_coins INTEGER NOT NULL DEFAULT 0,UNIQUE(account_id,request_key));
 CREATE INDEX IF NOT EXISTS payment_account ON payment_orders(account_id,id);
 CREATE TABLE IF NOT EXISTS payment_refunds(reference TEXT PRIMARY KEY,order_id INTEGER NOT NULL,amount_minor INTEGER NOT NULL,at INTEGER NOT NULL);`);
 if(!store.all('PRAGMA table_info(payment_orders)').some(c=>c.name==='test_fingerprint'))store.db.exec("ALTER TABLE payment_orders ADD COLUMN test_fingerprint TEXT NOT NULL DEFAULT ''");
 const testFingerprint=x=>store.hmac([x.merchantLogin,x.algorithm,x.testPassword1?store.unseal(x.testPassword1):'',x.testPassword2?store.unseal(x.testPassword2):'',x.tax,x.paymentMethod,x.paymentObject].join(':'));
 const defaults={merchantLogin:'',algorithm:'sha256',enabled:false,testVerified:false,approved:false,fiscalReady:false,legalReady:false,offerUrl:'',termsVersion:'',tax:'none',paymentMethod:'full_prepayment',paymentObject:'service',prices:{},revision:'initial'};
 function config(){const row=store.get("SELECT value FROM meta WHERE key='robokassa_config'");return row?{...defaults,...JSON.parse(row.value)}:{...defaults};}
 const configured=(c,test)=>!!(c.merchantLogin&&c[test?'testPassword1':'password1']&&c[test?'testPassword2':'password2']);
 const urls={result:origin+'/api/billing/robokassa/result',success:origin+'/api/billing/robokassa/success',fail:origin+'/api/billing/robokassa/fail'};
 function canSell(c){return legal.salesReady()&&c.offerUrl===origin+'/legal/payments'&&c.termsVersion===legal.state().version&&c.enabled&&c.testVerified&&c.approved&&c.fiscalReady&&c.legalReady&&!!c.offerUrl&&!!c.termsVersion&&configured(c,false)&&packageList.every(p=>Number.isSafeInteger(c.prices[p.id])&&c.prices[p.id]>0);}
 function balance(account){return account?store.get('SELECT coins FROM coin_wallets WHERE account_id=?',account)?.coins||0:0;}
 // Caller owns the SQLite transaction. Every credit, debit and refund has an immutable unique reference.
 function change(account,delta,reference){
  const old=store.get('SELECT * FROM coin_ledger WHERE reference=?',reference);if(old){if(old.account_id!==account||old.delta!==delta)deny(409,'Конфликт записи баланса.');return;}
  const next=balance(account)+delta;if(!Number.isSafeInteger(next)||Math.abs(next)>MAX_COINS)deny(409,'Лимит баланса. Обратитесь в поддержку.');
  store.run('INSERT INTO coin_wallets(account_id,coins) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET coins=excluded.coins',account,next);
  store.run('INSERT INTO coin_ledger(account_id,delta,reference,at) VALUES(?,?,?,?)',account,delta,reference,now());
 }
 function reserve(account,requestId,cost){if(balance(account)<cost)deny(402,'Недостаточно монет.');change(account,-cost,'ai:'+requestId);return {kind:'paid',accountId:account,requestId,cost};}
 function refund(reservation){if(reservation?.kind==='paid')change(reservation.accountId,reservation.cost,'ai-refund:'+reservation.requestId);}
 function catalog(){const c=config();return {available:canSell(c),provider:'robokassa',version:c.revision,offerUrl:c.offerUrl,termsVersion:c.termsVersion,packages:packageList.map(p=>({...p,priceRub:c.prices[p.id]?amount(c.prices[p.id]):null}))};}
 function adminState(){const c=config();return {merchantLogin:c.merchantLogin,algorithm:c.algorithm,enabled:c.enabled,available:canSell(c),approved:c.approved,fiscalReady:c.fiscalReady,legalReady:c.legalReady,offerUrl:c.offerUrl,termsVersion:c.termsVersion,tax:c.tax,paymentMethod:c.paymentMethod,paymentObject:c.paymentObject,prices:Object.fromEntries(packageList.map(p=>[p.id,c.prices[p.id]?amount(c.prices[p.id]):''])),testConfigured:configured(c,true),liveConfigured:configured(c,false),testVerified:!!c.testVerified,urls};}
 function save(data){
  const old=config(),c={...old};
  if(typeof data.merchantLogin!=='string'||!/^[A-Za-z0-9_.-]{0,100}$/.test(data.merchantLogin))deny(400,'Проверьте идентификатор магазина.');c.merchantLogin=data.merchantLogin;
  if(!['sha256','sha512','md5'].includes(data.algorithm))deny(400,'Выберите алгоритм из настроек Robokassa.');c.algorithm=data.algorithm;
  for(const field of ['enabled','approved','fiscalReady','legalReady']){if(typeof data[field]!=='boolean')deny(400,'Некорректный переключатель оплаты.');c[field]=data[field];}
  for(const key of ['password1','password2','testPassword1','testPassword2'])if(data[key]!==undefined&&data[key]!==''){if(typeof data[key]!=='string'||!/^\S{8,512}$/.test(data[key])||/[\u0000-\u001f]/.test(data[key]))deny(400,'Технический пароль: 8–512 символов без пробелов.');c[key]=store.seal(data[key]);}
  if(old.merchantLogin!==c.merchantLogin){for(const key of ['password1','password2','testPassword1','testPassword2'])if(!data[key])delete c[key];}
  c.prices={};for(const p of packageList){const value=data.prices?.[p.id];if(value!==undefined&&value!=='')c.prices[p.id]=rubles(value);}
  c.offerUrl='';if(data.offerUrl){let url;try{url=new URL(data.offerUrl);}catch{deny(400,'Укажите ссылку на оферту.');}if(url.origin!==origin||url.username||url.password||url.search||url.hash||url.pathname==='/'||url.pathname.startsWith('/api/'))deny(400,'Оферта должна находиться на нашем сайте.');c.offerUrl=url.href;}
  c.termsVersion=String(data.termsVersion||'');if(!/^[\w.-]{0,60}$/.test(c.termsVersion))deny(400,'Проверьте версию оферты.');
  if(!['none','vat0','vat5','vat7','vat10','vat20','vat22','vat105','vat107','vat110','vat120','vat122'].includes(data.tax)||!['full_payment','full_prepayment','prepayment','advance'].includes(data.paymentMethod)||!['service','payment'].includes(data.paymentObject))deny(400,'Проверьте настройки чека с Robokassa.');
  c.tax=data.tax;c.paymentMethod=data.paymentMethod;c.paymentObject=data.paymentObject;
  if(testFingerprint(old)!==testFingerprint(c))c.testVerified=false;
  if(c.enabled){if(c.offerUrl!==origin+'/legal/payments'||c.termsVersion!==legal.state().version)deny(400,'Укажите /legal/payments и актуальную редакцию опубликованных документов.');if(!legal.salesReady())deny(400,'Сначала опубликуйте проверенные документы и реквизиты исполнителя в разделе «Документы и реквизиты».');if(!c.testVerified)deny(400,'Сначала проведите тестовую оплату с подтверждением ResultURL.');if(!canSell(c))deny(400,'Для продаж нужны боевые пароли, цены, одобрение магазина, чеки и опубликованная оферта.');if(!origin.startsWith('https://'))deny(400,'Для настоящих платежей нужен HTTPS.');for(const a of ['password1','password2'])for(const b of ['testPassword1','testPassword2'])if(c[a]&&c[b]&&equal(store.unseal(c[a]),store.unseal(c[b])))deny(400,'Боевые и тестовые пароли должны отличаться.');}
  c.revision=token();store.run("INSERT INTO meta(key,value) VALUES('robokassa_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(c));store.audit('billing_settings_updated','ok',now());return adminState();
 }
 const publicOrder=r=>({id:r.id,packageId:r.package_id,coins:r.coins,priceRub:amount(r.amount_minor),test:!!r.is_test,status:r.status,created:r.created,paidAt:r.paid_at,refundedRub:amount(r.refunded_minor)});
 function makeOrder(auth,data,test=false){
  const c=config(),p=packageList.find(p=>p.id===data.packageId);if(!p||typeof data.requestId!=='string'||!/^[-\w]{16,100}$/.test(data.requestId))deny(400,'Некорректный заказ.');
  if(Object.keys(data).some(k=>!['packageId','requestId','version','acceptedTerms'].includes(k)))deny(400,'Цена и получатель задаются сервером.');
  if(test){if(!auth.owner)deny(403,'Тест доступен администратору.');if(!configured(c,true))deny(503,'Сначала сохраните магазин и тестовые пароли.');}
  else{if(auth.owner)deny(403,'Для администратора доступна тестовая оплата.');if(!canSell(c))deny(503,'Покупка монет недоступна.');if(data.version!==c.revision)deny(409,'Условия изменились. Обновите список пакетов.');if(data.acceptedTerms!==true)deny(400,'Нужно согласие с офертой.');}
  const old=store.get('SELECT * FROM payment_orders WHERE account_id=? AND request_key=?',auth.key,data.requestId);
  if(old){if(old.package_id!==p.id||!!old.is_test!==test)deny(409,'Этот запрос относится к другому заказу.');return {...publicOrder(old),checkoutPath:'/api/billing/pay/'+old.id};}
  if(!store.consume('billing-orders:'+auth.key,12,600000,now()))deny(429,'Слишком много счетов. Повторите позже.');
  const minor=test?(c.prices[p.id]||100):c.prices[p.id],nonce=token();
  store.db.exec('BEGIN IMMEDIATE');try{
   const result=store.run('INSERT INTO payment_orders(account_id,request_key,package_id,coins,amount_minor,is_test,created,nonce,secret2,algorithm,form_fields,terms_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',auth.key,data.requestId,p.id,p.coins,minor,Number(test),now(),nonce,c[test?'testPassword2':'password2'],c.algorithm,'{}',test?'test':c.termsVersion);
   const id=Number(result.lastInsertRowid);if(id>2147483647)deny(503,'Нумерация счетов исчерпана.');
   const receipt=encodeURIComponent(JSON.stringify({items:[{name:`Покадрово услуги ИИ монтажа ${p.coins} единиц`,quantity:1,sum:minor/100,payment_method:c.paymentMethod,payment_object:c.paymentObject,tax:c.tax}]}));
   const shp=['Shp_order='+nonce,'Shp_test='+Number(test)],out=amount(minor);
   const fields={MerchantLogin:c.merchantLogin,OutSum:out,InvId:String(id),Description:`Покадрово: ${p.coins} монет`,Culture:'ru',Encoding:'utf-8',Receipt:receipt,Shp_order:nonce,Shp_test:String(Number(test)),SignatureValue:signature([c.merchantLogin,out,String(id),receipt,store.unseal(c[test?'testPassword1':'password1']),...shp],c.algorithm),...(test?{IsTest:'1'}:{})};
   store.run('UPDATE payment_orders SET form_fields=?,test_fingerprint=? WHERE id=?',JSON.stringify(fields),test?testFingerprint(c):'',id);store.db.exec('COMMIT');return {...publicOrder(store.get('SELECT * FROM payment_orders WHERE id=?',id)),checkoutPath:'/api/billing/pay/'+id};
  }catch(e){store.db.exec('ROLLBACK');throw e;}
 }
 function reconcileRefund(data){
  const id=invoice(String(data.orderId)),minor=rubles(data.amountRub),reference=String(data.reference||'');if(!/^[\w.-]{5,120}$/.test(reference)||data.confirmed!==true)deny(400,'Укажите подтверждённый номер возврата из Robokassa.');
  const old=store.get('SELECT * FROM payment_refunds WHERE reference=?',reference);if(old){if(old.order_id!==id||old.amount_minor!==minor)deny(409,'Номер возврата уже использован.');return {ok:true};}
  const order=store.get('SELECT * FROM payment_orders WHERE id=?',id);if(!order||!['paid','partially_refunded'].includes(order.status)||order.refunded_minor+minor>order.amount_minor)deny(400,'Проверьте оплаченный счёт и сумму возврата.');
  const total=order.refunded_minor+minor,revoked=Number(BigInt(total)*BigInt(order.coins)/BigInt(order.amount_minor));
  store.db.exec('BEGIN IMMEDIATE');try{
   if(!order.is_test)change(order.account_id,-(revoked-order.revoked_coins),'refund:'+reference);
   store.run('INSERT INTO payment_refunds(reference,order_id,amount_minor,at) VALUES(?,?,?,?)',reference,id,minor,now());store.run('UPDATE payment_orders SET refunded_minor=?,revoked_coins=?,status=? WHERE id=?',total,revoked,total===order.amount_minor?'refunded':'partially_refunded',id);store.audit('billing_refund_recorded','ok',now());store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}return {ok:true};
 }
 function page(res,title,content,extra=''){
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action https://auth.robokassa.ru; base-uri 'none'; frame-ancestors 'none'`);
  res.setHeader('X-Robots-Tag','noindex, nofollow');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | Покадрово</title><style>body{font:16px/1.6 Arial,sans-serif;background:#f7f8fa;color:#17212d;margin:0;padding:32px}main{max-width:540px;margin:12vh auto;padding:28px;background:white;border:1px solid #dce2eb;border-radius:18px}button,a{display:inline-block;padding:12px 20px;border:0;border-radius:10px;background:#245ce0;color:white;font:inherit;text-decoration:none;cursor:pointer}h1{line-height:1.2;font-size:28px}input[hidden]{display:none}</style><main><h1>${escape(title)}</h1>${content}</main>${extra}</html>`);
 }
 async function route(req,res,url){
  const path=url.pathname;
  if(path==='/api/billing/robokassa/result'){
   if(req.method!=='POST')deny(405,'Используйте POST.');const data=await formBody(req),id=invoice(data.invid),order=store.get('SELECT * FROM payment_orders WHERE id=?',id);if(!order)deny(404,'Счёт не найден.');
   if(Object.keys(data).some(k=>k.startsWith('shp_')&&!['shp_order','shp_test'].includes(k))||data.shp_order!==order.nonce||data.shp_test!==String(order.is_test)||!data.signaturevalue||!/^[a-f\d]{32,128}$/i.test(data.signaturevalue))deny(403,'Некорректная подпись.');
   const expected=signature([data.outsum,data.invid,store.unseal(order.secret2),'Shp_order='+data.shp_order,'Shp_test='+data.shp_test],order.algorithm);
   if(!equal(expected,String(data.signaturevalue).toLowerCase())||rubles(data.outsum)!==order.amount_minor)deny(403,'Некорректная подпись или сумма.');
   store.db.exec('BEGIN IMMEDIATE');try{
    const fresh=store.get('SELECT * FROM payment_orders WHERE id=?',id);
    if(fresh.status==='pending'){
     if(!fresh.is_test)change(fresh.account_id,fresh.coins,'payment:'+id);
     store.run("UPDATE payment_orders SET status='paid',paid_at=? WHERE id=?",now(),id);
     if(fresh.is_test){const c=config();if(configured(c,true)&&equal(fresh.test_fingerprint,testFingerprint(c))){c.testVerified=true;store.run("UPDATE meta SET value=? WHERE key='robokassa_config'",JSON.stringify(c));}}
     store.audit(fresh.is_test?'billing_test_paid':'billing_paid','ok',now());
    }
    store.db.exec('COMMIT');
   }catch(e){store.db.exec('ROLLBACK');throw e;}
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('OK'+id);return true;
  }
  if(['/api/billing/robokassa/success','/api/billing/robokassa/fail'].includes(path)){
   if(!['GET','POST'].includes(req.method))deny(405,'Метод не поддерживается.');
   const success=path.endsWith('/success');page(res,success?'Проверяем оплату':'Оплата не завершена',`<p>${success?'Монеты появятся в балансе после подтверждения платежа. Проверьте историю покупок на сайте.':'Если деньги списались, проверьте историю покупок перед повторной оплатой.'}</p><a href="/">Вернуться на сайт</a>`);return true;
  }
  if(path.startsWith('/api/billing/pay/')){
   if(req.method!=='GET')deny(405,'Используйте GET.');const auth=session(req),id=invoice(path.slice('/api/billing/pay/'.length)),order=store.get('SELECT * FROM payment_orders WHERE id=? AND account_id=?',id,auth.key);if(!order)deny(404,'Счёт не найден.');if(order.status!=='pending'||order.created<now()-86400000)deny(409,'Откройте баланс и создайте новый счёт.');
   const fields=JSON.parse(order.form_fields);page(res,order.is_test?'Тестовая оплата Robokassa':'Переходим к оплате',`<p>${order.is_test?'Тест не переводит деньги и не пополняет настоящий баланс.':`${order.coins} монет · ${amount(order.amount_minor)} ₽. Данные карты вводятся на странице Robokassa.`}</p><form id="rk-checkout" method="POST" action="${GATEWAY}">${Object.entries(fields).map(([key,value])=>`<input hidden name="${escape(key)}" value="${escape(value)}">`).join('')}<button type="submit">Перейти в Robokassa</button></form>`,`<script src="/api/billing/redirect.js" defer></script>`);return true;
  }
  if(path==='/api/billing/redirect.js'){if(req.method!=='GET')deny(405,'Используйте GET.');res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end("document.getElementById('rk-checkout')?.requestSubmit();");return true;}
  if(!path.startsWith('/api/billing/'))return false;
  const auth=session(req,false);if(req.headers['x-pk-account']&&!equal(req.headers['x-pk-account'],auth?.key||''))deny(409,'Аккаунт изменился.');
  if(req.method==='GET'&&path==='/api/billing/catalog'){json(res,200,catalog());return true;}
  if(!auth)deny(401,'Войдите в аккаунт.');
  if(req.method==='GET'&&path==='/api/billing/orders'){json(res,200,{items:store.all('SELECT * FROM payment_orders WHERE account_id=? ORDER BY id DESC LIMIT 20',auth.key).map(publicOrder)});return true;}
  if(req.method==='POST'&&path==='/api/billing/orders'){sameOrigin(req);if(!equal(req.headers['x-csrf-token'],auth.csrf)||!equal(req.headers['x-pk-account'],auth.key))deny(403,'Обновите страницу.');json(res,201,makeOrder(auth,await body(req,4096)));return true;}
  deny(404,'Метод оплаты не найден.');
 }
 return {route,catalog,adminState,save,balance,reserve,refund,reconcileRefund,testOrder:(auth,data)=>makeOrder(auth,data,true),orders:()=>store.all('SELECT * FROM payment_orders ORDER BY id DESC LIMIT 100').map(publicOrder)};
}
