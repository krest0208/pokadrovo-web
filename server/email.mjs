import {token} from './security.mjs';
import {deny} from './http.mjs';

const DAY=86400000,WINDOW=32*DAY,LIMIT=100;
export const emailAddress=value=>typeof value==='string'&&value.length<=254&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(value.trim())?value.trim().toLowerCase():null;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mailMessage({kind,to,url},from){
 const verify=kind==='verify',test=kind==='test';
 const subject=test?'Покадрово: проверка почты':verify?'Подтвердите почту в Покадрово':'Восстановление доступа в Покадрово';
 const heading=test?'Почта подключена':verify?'Подтвердите ваш адрес':'Вернитесь к своим проектам';
 const note=test?'Это тестовое письмо, отправленное из защищённой панели Покадрово.':verify?'Войдите в свой аккаунт Покадрово и подтвердите адрес по кнопке ниже. Ссылка действует 24 часа.':'Задайте новый пароль по кнопке ниже. Ссылка действует 30 минут. Пароль не изменится, пока вы сами не отправите форму.';
 const action=verify?'Подтвердить почту':'Задать новый пароль';
 const tail=test?'':'Если вы не запрашивали это письмо, ничего не нажимайте. Не пересылайте ссылку другим людям.';
 return {from:{name:'Покадрово',address:from},to,envelope:{from,to:[to]},subject,
  text:heading+'\n\n'+note+(test?'':'\n\n'+url)+'\n\n'+tail+'\nПокадрово · https://pokadrovo.ru',
  html:'<!doctype html><html lang="ru"><meta charset="utf-8"><body style="margin:0;background:#f2f5fa;color:#172d4d;font:16px/1.6 Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:20px"><p style="color:#285ee0;font-weight:bold">покадрово</p><h1 style="font-size:26px">'+heading+'</h1><p>'+note+'</p>'+(test?'':'<p style="margin:28px 0"><a href="'+esc(url)+'" style="display:inline-block;background:#285ee0;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">'+action+'</a></p><p style="font-size:14px;overflow-wrap:anywhere">Если кнопка не открывается, скопируйте ссылку в браузер:<br>'+esc(url)+'</p>')+'<p style="font-size:14px;color:#51637b">'+tail+'</p><p>Покадрово · pokadrovo.ru</p></div></body></html>',
  disableFileAccess:true,disableUrlAccess:true};
}
export function smtpOptions(config,password){return {host:'smtp.rusender.ru',port:465,secure:true,auth:{user:config.username,pass:password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:12000,dnsTimeout:8000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true};}
async function defaultTransport(options){
 try{const bundled=await import('../dist/server/mail-transport.cjs');return bundled.default(options);}
 catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;const {default:nodemailer}=await import('nodemailer');return nodemailer.createTransport(options);}
}
export function createMail({store,now,origin,legalReady,transportFactory=defaultTransport}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS mail_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,sender TEXT NOT NULL DEFAULT '',username TEXT,password TEXT,confirmed INTEGER NOT NULL DEFAULT 0,revision TEXT NOT NULL DEFAULT 'initial',updated INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO mail_config(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS mail_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT,revision TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS mail_jobs_created ON mail_jobs(created);`);
 // SMTP delivery cannot be retried safely after an uncertain connection loss.
 store.run("UPDATE mail_jobs SET status='interrupted',payload=NULL,error='Доставка прервана; повторная отправка только по запросу пользователя.' WHERE status='sending'");
 let timer=null,active=null,stopped=false,validate=()=>false;
 const config=()=>store.get('SELECT * FROM mail_config WHERE id=1');
 const configured=c=>!!(c.enabled&&c.confirmed&&c.sender&&c.username&&c.password);
 const ready=()=>configured(config())&&legalReady();
 function quota(){const row=store.get('SELECT count(*) used,min(created) oldest FROM mail_jobs WHERE created>?',now()-WINDOW);return {limit:LIMIT,used:row.used,remaining:Math.max(0,LIMIT-row.used),windowDays:32,nextAvailable:row.used>=LIMIT?row.oldest+WINDOW:0};}
 function state(){const c=config();return {provider:'rusender',enabled:!!c.enabled,configured:configured(c),publicReady:ready(),sender:c.sender,usernameConfigured:!!c.username,passwordConfigured:!!c.password,confirmed:!!c.confirmed,host:'smtp.rusender.ru',port:465,quota:quota(),updated:c.updated,
  totals:store.all('SELECT status,count(*) count FROM mail_jobs WHERE created>? GROUP BY status',now()-WINDOW),last:store.get("SELECT created,status,error FROM mail_jobs ORDER BY created DESC,rowid DESC LIMIT 1")||null};}
 function save(data){
  if(typeof data.enabled!=='boolean'||typeof data.confirmed!=='boolean')deny(400,'Проверьте настройки почты.');
  const old=config(),sender=emailAddress(data.sender);if(!sender||sender.split('@')[1]!=='pokadrovo.ru')deny(400,'Укажите адрес отправителя на домене pokadrovo.ru.');
  const username=typeof data.username==='string'&&data.username.trim()?data.username.trim():'';
  if(username&&(!/^[\x21-\x7e]{1,254}$/.test(username)))deny(400,'Проверьте SMTP-логин.');
  let login=username?store.seal(username):old.username,password=old.password;
  if(data.removeCredentials===true){login=null;password=null;}
  if(data.removeCredentials!==true&&data.smtpPassword){if(typeof data.smtpPassword!=='string'||!/^\S{8,1024}$/.test(data.smtpPassword))deny(400,'Проверьте SMTP-пароль.');password=store.seal(data.smtpPassword);}
  const changed=!!username||!!data.smtpPassword||sender!==old.sender||data.removeCredentials===true;
  if(changed&&data.removeCredentials!==true&&(old.username||old.password||username||data.smtpPassword)&&(!username||!data.smtpPassword))deny(400,'При смене отправителя или доступа введите SMTP-логин и SMTP-пароль вместе.');
  if(data.enabled&&(!login||!password||!data.confirmed))deny(400,'Нужны SMTP-данные и подтверждение бесплатного тарифа, домена и условий обработки.');
  store.run('UPDATE mail_config SET enabled=?,sender=?,username=?,password=?,confirmed=?,revision=?,updated=? WHERE id=1',Number(data.enabled),sender,login,password,Number(data.confirmed),token(),now());
  store.run("UPDATE mail_jobs SET status='cancelled',payload=NULL,error='Настройки отправки изменены.' WHERE status='queued'");
  store.audit('mail_config_changed','ok',now());return state();
 }
 function enqueue(data,expires,{test=false}={}){
  const c=config();if(!(test?configured(c):ready())||quota().remaining===0)return false;
  if(!emailAddress(data.to)||!['verify','reset','test'].includes(data.kind))return false;
  if(data.kind!=='test'){
   let link;try{link=new URL(data.url);}catch{return false;}
   if(link.origin!==origin||link.pathname!=='/account/email'||link.search||!/^#(?:verify|reset)=[\w-]{43}$/.test(link.hash))return false;
  }
  const id=token(),at=now();const result=store.run('INSERT INTO mail_jobs(id,kind,created,expires,status,payload,revision) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM mail_jobs WHERE created>?)<?',id,data.kind,at,expires,'queued',store.seal(JSON.stringify(data)),c.revision,at-WINDOW,LIMIT);return result.changes===1;
 }
 function cleanup(){store.run("UPDATE mail_jobs SET status='expired',payload=NULL WHERE status='queued' AND expires<=?",now());store.run('DELETE FROM mail_jobs WHERE created<? AND payload IS NULL',now()-33*DAY);}
 async function deliver(){
  cleanup();const job=store.get("SELECT * FROM mail_jobs WHERE status='queued' ORDER BY created,rowid LIMIT 1");if(!job)return;
  const c=config();let payload;
  try{payload=JSON.parse(store.unseal(job.payload));}catch{store.run("UPDATE mail_jobs SET status='failed',payload=NULL,error='Не удалось прочитать зашифрованное письмо.' WHERE id=?",job.id);return;}
  if(!configured(c)||c.revision!==job.revision||job.kind!=='test'&&(!legalReady()||!validate(payload))){store.run("UPDATE mail_jobs SET status='cancelled',payload=NULL,error='Письмо больше не актуально.' WHERE id=?",job.id);return;}
  const claimed=store.run("UPDATE mail_jobs SET status='sending',payload=NULL WHERE id=? AND status='queued'",job.id);if(claimed.changes!==1)return;
  let transport,deadline;
  try{
   transport=await transportFactory(smtpOptions({username:store.unseal(c.username)},store.unseal(c.password)));
   const result=await Promise.race([transport.sendMail(mailMessage(payload,c.sender)),new Promise((_,reject)=>{deadline=setTimeout(()=>{try{transport.close?.();}catch{}reject(Error('mail-timeout'));},14000);deadline.unref?.();})]);
   const accepted=Array.isArray(result?.accepted)&&result.accepted.some(x=>String(x).toLowerCase()===payload.to.toLowerCase());
   if(!accepted)throw Error('mail-rejected');
   store.run("UPDATE mail_jobs SET status='accepted',error='' WHERE id=?",job.id);
  }catch{store.run("UPDATE mail_jobs SET status='failed',error='SMTP не подтвердил приём. Проверьте подключение, активацию и лимит RuSender.' WHERE id=?",job.id);}
  finally{clearTimeout(deadline);try{transport?.close?.();}catch{}}
 }
 function pump(){if(stopped||active)return active||Promise.resolve();active=deliver().catch(()=>{store.audit('mail_worker_error','failed',now());}).finally(()=>{active=null;});return active;}
 function start(){stopped=false;if(!timer){timer=setInterval(()=>{void pump();},2000);timer.unref();void pump();}}
 function stop(){stopped=true;clearInterval(timer);timer=null;return active;}
 return {ready,state,save,enqueue,pump,start,stop,cleanup,setValidator:fn=>{validate=fn;}};
}
