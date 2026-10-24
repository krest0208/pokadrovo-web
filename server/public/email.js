'use strict';
(()=>{
 const $=id=>document.getElementById(id),fragment=new URLSearchParams(location.hash.slice(1));
 let proof=fragment.get('verify')||fragment.get('reset')||'',kind=fragment.has('verify')?'verify':'reset',csrf='',recovery='',busy=false;
 // Proofs are kept only in this page's memory, never URLs sent to HTTP, telemetry or storage.
 history.replaceState(null,'',location.pathname);
 const text=(id,value)=>{$(id).textContent=value;};
 async function request(path,data){const res=await fetch('/api/account'+path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});let value;try{value=await res.json();}catch{throw Error('Сервис временно недоступен. Повторите позднее.');}if(!res.ok)throw Error(value.error||'Не удалось выполнить действие.');return value;}
 async function initialise(){
  if(!/^[\w-]{43}$/.test(proof)){text('title','Откройте ссылку из письма');text('description','Эта страница подтверждает почту или помогает восстановить пароль. Полную ссылку вы получите в письме от Покадрово.');$('login').hidden=false;return;}
  try{const s=await request('/session');csrf=s.csrf;if(!s.accountsEnabled)throw Error('Вход пользователей пока отключён.');
   if(kind==='verify'){text('title','Подтвердите вашу почту');if(!s.user||s.user.role==='owner'){text('description','Войдите в нужный аккаунт, затем заново откройте ссылку из письма. Администратор использует отдельную защиту доступа.');$('login').hidden=false;return;}text('description','Вы вошли как '+s.user.email+'. Нажмите кнопку, если письмо адресовано вам.');$('verify-form').hidden=false;}
   else{text('title','Новый пароль');text('description','Задайте пароль, чтобы снова открыть свои проекты. Ссылка используется один раз.');$('reset-form').hidden=false;}
  }catch(e){text('title','Не удалось открыть действие');text('notice',e.message);$('login').hidden=false;}
 }
 for(const name of ['verify','reset'])$(name+'-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;text('notice','Проверяем…');
  try{const d=new FormData(form),r=await request('/email/'+name,{token:proof,...Object.fromEntries(d)});proof='';form.reset();form.hidden=true;
   if(name==='verify'){text('title','Почта подтверждена');text('description','Теперь для восстановления доступа можно запросить письмо на этот адрес.');text('notice','Готово. Вернитесь к своим проектам.');$('login').hidden=false;}
   else{recovery=r.recoveryCode;text('title','Пароль обновлён');text('description','Сохраните резервный код и войдите с новым паролем.');text('notice','Все прежние сеансы завершены.');text('recovery-code',recovery);$('receipt').hidden=false;$('copy-code').focus();}
  }catch(e){text('notice',e.message);}finally{busy=false;button.disabled=false;for(const input of form.querySelectorAll('input[type=password]'))input.value='';}
 });
 $('copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(recovery);text('notice','Код скопирован. Сохраните его в надёжном месте.');}catch{text('notice','Не удалось скопировать автоматически. Выделите код и скопируйте вручную.');}});
 $('saved-code').addEventListener('click',()=>{recovery='';text('recovery-code','');$('receipt').hidden=true;$('login').hidden=false;$('login').focus();});
 void initialise();
})();
