import {token,equal,hashPassword,validatePassword} from './security.mjs';
import {body,deny,json,appendCookie} from './http.mjs';
import {emailAddress} from './email.mjs';

const DAY=86400000;
const generic='Если адрес подтверждён и связан с действующим аккаунтом, мы подготовим письмо. Проверьте входящие и спам. При задержке используйте резервный код.';
const invalid='Ссылка недействительна или срок её действия истёк. Запросите новое письмо.';
export function createAccountEmail({store,now,origin,mail,accountsEnabled,session,publicMutation,mutation,passwordJob,limit,recovery,secure,sessionName}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS account_email_tokens(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,digest TEXT NOT NULL UNIQUE,email TEXT NOT NULL,password_mark TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(user_id,kind));`);
 const proofHash=raw=>store.hmac('account-email:'+raw),passwordMark=value=>store.hmac('email-password:'+value);
 function current(proof,kind){
  const row=store.get('SELECT t.*,u.password,u.status,u.email_verified,u.email AS current_email FROM account_email_tokens t JOIN users u ON u.id=t.user_id WHERE t.digest=? AND t.kind=?',proof,kind);
  if(!row||row.expires<=now()||row.status!=='active'||row.email!==row.current_email||!equal(row.password_mark,passwordMark(row.password||'')))return null;
  if(kind==='reset'&&!row.email_verified||kind==='verify'&&row.email_verified)return null;return row;
 }
 mail.setValidator(data=>!!current(data.proof,data.kind));
 function issue(user,kind){
  if(!mail.ready()||!user?.password||user.status!=='active'||kind==='reset'&&!user.email_verified||kind==='verify'&&user.email_verified)return false;
  if(!store.consume('mail-user-minute:'+user.id,1,60000,now())||!store.consume('mail-user-day:'+user.id,3,DAY,now()))return false;
  const raw=token(),proof=proofHash(raw),expires=now()+(kind==='verify'?DAY:30*60000);
  const url=origin+'/account/email#'+kind+'='+raw;
  let queued=false;store.db.exec('BEGIN IMMEDIATE');try{
   queued=mail.enqueue({kind,to:user.email,url,proof},expires);
   if(queued)store.run('INSERT INTO account_email_tokens(user_id,kind,digest,email,password_mark,created,expires) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET digest=excluded.digest,email=excluded.email,password_mark=excluded.password_mark,created=excluded.created,expires=excluded.expires',user.id,kind,proof,user.email,passwordMark(user.password),now(),expires);
   store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}return queued;
 }
 async function route(req,res,url){
  const path=url.pathname;
  if(!['/api/account/email/status','/api/account/email/resend','/api/account/email/verify','/api/account/email/reset-request','/api/account/email/reset'].includes(path))return false;
  if(!accountsEnabled)deny(404,'Вход пользователей отключён.');
  if(path==='/api/account/email/status'&&req.method==='GET'){
   const a=session(req);if(a.owner)deny(403,'Почта пользователей не меняет доступ администратора.');
   json(res,200,{enabled:mail.ready(),verified:!!a.user.emailVerified});return true;
  }
  if(req.method!=='POST')deny(405,'Метод не поддерживается.');
  if(path==='/api/account/email/resend'){
   const a=session(req);if(a.owner)deny(403,'Для администратора действует отдельная защита доступа.');mutation(req,a);limit(req,'mail-resend',5,15*60000);
   if(!mail.ready())deny(503,'Отправка писем временно недоступна. Резервный код продолжает работать.');
   const user=store.get('SELECT * FROM users WHERE id=?',a.key);if(user.email_verified){json(res,200,{verified:true,queued:false});return true;}
   const queued=issue(user,'verify');if(!queued)deny(429,'Письмо пока не отправлено. Подождите минуту; при исчерпании квоты используйте резервный код.');
   json(res,202,{queued:true,message:'Письмо поставлено в очередь. Проверьте входящие и спам.'});return true;
  }
  const acting=session(req,false);if(acting)mutation(req,acting);else publicMutation(req);limit(req,'mail-actions',6,15*60000);
  const data=await body(req,4096);
  if(path==='/api/account/email/reset-request'){
   const email=emailAddress(data.email);if(!email)deny(400,'Введите корректный адрес почты.');
   if(!mail.ready())deny(503,'Отправка писем временно недоступна. Используйте резервный код.');
   if(!store.consume('mail-reset-global',20,3600000,now()))deny(429,'Слишком много запросов. Попробуйте позднее.');
   if(store.consume('mail-reset-address:'+store.hmac(email),3,DAY,now()))issue(store.get('SELECT * FROM users WHERE email=?',email),'reset');
   json(res,200,{ok:true,message:generic});return true;
  }
  const raw=typeof data.token==='string'?data.token:'';
  const row=/^[\w-]{43}$/.test(raw)?current(proofHash(raw),path.endsWith('/verify')?'verify':'reset'):null;
  if(!row)deny(400,invalid);
  if(path==='/api/account/email/verify'){
   const auth=session(req);if(auth.owner||auth.key!==row.user_id)deny(403,'Войдите в тот аккаунт, для которого запрашивали подтверждение.');
   // Matching account login is required: a forwarded verification link cannot approve an attacker's signup.
   store.db.exec('BEGIN IMMEDIATE');try{store.run('UPDATE users SET email_verified=1 WHERE id=?',row.user_id);store.run('DELETE FROM account_email_tokens WHERE user_id=?',row.user_id);store.audit('user_email_verified','ok',now());store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
   json(res,200,{ok:true,verified:true});return true;
  }
  if(!equal(data.newPassword,data.confirmPassword))deny(400,'Пароли не совпадают.');try{validatePassword(data.newPassword);}catch(e){deny(400,e.message);}
  const previous=session(req,false),hash=await passwordJob(()=>hashPassword(data.newPassword));
  if(!current(row.digest,'reset'))deny(400,invalid);
  let recoveryCode;store.db.exec('BEGIN IMMEDIATE');try{
   store.run('UPDATE users SET password=? WHERE id=?',hash,row.user_id);store.run('DELETE FROM user_sessions WHERE user_id=?',row.user_id);store.run('DELETE FROM account_email_tokens WHERE user_id=?',row.user_id);
   recoveryCode=recovery.issue(row.user_id);store.audit('user_password_email_reset','ok',now());store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
  if(previous?.key===row.user_id)appendCookie(res,sessionName,'',0,secure);
  json(res,200,{ok:true,recoveryCode});return true;
 }
 function cleanup(){store.run('DELETE FROM account_email_tokens WHERE expires<=?',now());}
 return {route,issue,cleanup};
}
