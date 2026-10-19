export type User = { id:string; name:string; email:string|null; emailVerified:boolean; role:'user'|'owner'; created:number; passwordSet:boolean };
export type Provider = { id:'google'|'facebook'|'instagram'; ready:boolean; professionalOnly:boolean; note:string };
export type Session = { user:User|null; csrf:string; providers:Provider[]; accountsEnabled?:boolean; guestEditingEnabled?:boolean; socialLoginEnabled?:boolean };
let active:Session|null=null;
export class AccountError extends Error { constructor(message:string,public status:number){super(message);} }
export const currentUser=()=>active?.user||null;
export const storageScope=()=>active?.user?.id||(active?.accountsEnabled===false||active?.guestEditingEnabled===true?'guest-local':null);
export function acceptSession(session:Session){active=session;return session;}
export async function request<T=Record<string,unknown>>(path:string,method='GET',data?:unknown):Promise<T>{
 if(location.protocol==='file:')throw new AccountError('Регистрация и админ-панель работают через локальный сервер. Запустите start-local и откройте localhost:5173.',503);
 const headers:Record<string,string>={'Accept':'application/json'};
 if(method!=='GET') {headers['Content-Type']='application/json';headers['X-CSRF-Token']=active?.csrf||'';}
 if(path.startsWith('/projects'))headers['X-PK-Account']=active?.user?.id||'';
 let response:Response;
 try {response=await fetch('/api/account'+path,{method,headers,credentials:'same-origin',body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});}
 catch {throw new AccountError('Нет связи с сервером. Проверьте подключение к интернету и повторите.',503);}
 let value:Record<string,unknown>;try{value=await response.json();}catch{throw new AccountError('Сервис регистрации временно недоступен. Попробуйте ещё раз позже.',503);}
 if(!response.ok){
  if(response.status===401&&!['/login','/register'].includes(path))window.dispatchEvent(new Event('pokadrovo:session-expired'));
  throw new AccountError(typeof value.error==='string'?value.error:'Не удалось выполнить запрос.',response.status);
 }
 return value as T;
}
export async function getSession(){return acceptSession(await request<Session>('/session'));}
export async function signIn(email:string,password:string){return acceptSession(await request<Session>('/login','POST',{email,password}));}
export async function register(email:string,password:string,confirmPassword:string,acceptPrivacy:boolean){return acceptSession(await request<Session>('/register','POST',{email,password,confirmPassword,acceptPrivacy}));}
export async function logout(){await request('/logout','POST',{});active=null;return getSession();}
export async function socialLogin(provider:Provider['id']){const result=await request<{url:string}>('/oauth/'+provider,'POST',{});const url=new URL(result.url);if(url.protocol!=='https:'||!['accounts.google.com','www.facebook.com','www.instagram.com'].includes(url.hostname))throw Error('Некорректный адрес входа.');window.location.assign(url.href);}
let saves=Promise.resolve();
/** Sequential metadata saves cannot cross an account switch. Original media are never uploaded. */
export function syncProject(project:unknown){
 const scope=storageScope();if(!scope||!currentUser())return;
 const snapshot=JSON.parse(JSON.stringify(project));
 saves=saves.catch(()=>{}).then(async()=>{
  if(storageScope()!==scope)return;
  await request('/projects','PUT',{project:snapshot});
  if(storageScope()===scope)window.dispatchEvent(new CustomEvent('pokadrovo:sync-status',{detail:'Настройки проекта сохранены на сервере. Исходники остаются на устройстве.'}));
 }).catch(error=>{if(storageScope()===scope)window.dispatchEvent(new CustomEvent('pokadrovo:sync-status',{detail:'Локальная копия сохранена, но серверная — нет. '+String(error.message)}));});
}
export const flushProjectSaves=()=>saves;
