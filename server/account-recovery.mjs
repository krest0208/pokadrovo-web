import {randomBytes} from 'node:crypto';
import {equal,hashPassword,checkPassword,validatePassword} from './security.mjs';
import {body,deny,json,appendCookie} from './http.mjs';

const normalize=value=>typeof value==='string'?value.replace(/[\s-]/g,'').toUpperCase():'';
const generic='Почта или резервный код не подошли. Проверьте данные и попробуйте ещё раз.';
export function createAccountRecovery({store,now,session,sameOrigin,publicMutation,passwordJob,limit,accountsEnabled,secure,sessionName}){
 const absentDigest=store.hmac('account-recovery:missing');
 store.db.exec('CREATE TABLE IF NOT EXISTS account_recovery(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, digest TEXT NOT NULL, created INTEGER NOT NULL)');
 function issue(userId){
  const code=randomBytes(24).toString('hex').toUpperCase().match(/.{1,6}/g).join('-');
  store.run('INSERT INTO account_recovery(user_id,digest,created) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest,created=excluded.created',userId,store.hmac('account-recovery:'+userId+':'+normalize(code)),now());
  return code;
 }
 async function route(req,res,url){
  if(req.method==='POST'&&url.pathname==='/api/account/recover'){
   if(!accountsEnabled)deny(404,'Вход пользователей отключён.');publicMutation(req);limit(req,'account-recovery',6,15*60000);
   if(!store.consume('account-recovery-global',60,15*60000,now()))deny(429,'Слишком много попыток. Повторите позднее.');
   const data=await body(req,4096),email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
   const user=email.length<=254?store.get('SELECT u.id,u.password,u.status,r.digest FROM users u LEFT JOIN account_recovery r ON r.user_id=u.id WHERE u.email=?',email):null;
   const code=normalize(data.recoveryCode),candidate=store.hmac('account-recovery:'+(user?.id||'missing')+':'+code);
   const matches=equal(candidate,user?.digest||absentDigest);
   if(!/^[A-F0-9]{48}$/.test(code)||!matches||!user?.password||user.status!=='active')deny(400,generic);
   if(!equal(data.newPassword,data.confirmPassword))deny(400,'Пароли не совпадают.');
   try{validatePassword(data.newPassword);}catch(e){deny(400,e.message);}
   const previousSession=session(req,false);
   const hash=await passwordJob(()=>hashPassword(data.newPassword));
   // Verify the proof again after asynchronous hashing; only one racing reset can consume it.
   const fresh=store.get('SELECT u.password,u.status,r.digest FROM users u JOIN account_recovery r ON r.user_id=u.id WHERE u.id=?',user.id);
   if(!fresh||fresh.status!=='active'||!equal(fresh.digest,user.digest)||!equal(fresh.password,user.password))deny(400,generic);
   let recoveryCode;
   store.db.exec('BEGIN IMMEDIATE');try{
    store.run('UPDATE users SET password=? WHERE id=?',hash,user.id);
    store.run('DELETE FROM user_sessions WHERE user_id=?',user.id);
    recoveryCode=issue(user.id);store.audit('user_password_recovered','ok',now());store.db.exec('COMMIT');
   }catch(e){store.db.exec('ROLLBACK');throw e;}
   // A reset never signs in automatically or changes an unrelated account's cookie.
   if(previousSession?.key===user.id)appendCookie(res,sessionName,'',0,secure);
   json(res,200,{ok:true,recoveryCode});return true;
  }
  if(url.pathname==='/api/account/recovery-code'){
   const auth=session(req);if(auth.owner)deny(403,'Настройки администратора находятся в разделе защиты доступа.');
   if(req.method==='GET'){const row=store.get('SELECT created FROM account_recovery WHERE user_id=?',auth.key);json(res,200,{configured:!!row,created:row?.created||null});return true;}
   if(req.method!=='POST')deny(405,'Метод не поддерживается.');sameOrigin(req);if(!equal(req.headers['x-csrf-token'],auth.csrf))deny(403,'Обновите страницу и повторите действие.');limit(req,'issue-recovery',6,15*60000);
   const data=await body(req,4096),user=store.get('SELECT password,status FROM users WHERE id=?',auth.key);
   if(!user?.password||!await passwordJob(()=>checkPassword(data.password,user.password)))deny(403,'Текущий пароль не подошёл.');
   const current=session(req),fresh=store.get('SELECT password,status FROM users WHERE id=?',auth.key);
   if(current.key!==auth.key||fresh?.status!=='active'||!equal(fresh.password,user.password))deny(401,'Сеанс изменился. Войдите снова.');
   const recoveryCode=issue(auth.key);store.audit('user_recovery_rotated','ok',now());json(res,200,{recoveryCode});return true;
  }
  return false;
 }
 return {issue,route};
}
