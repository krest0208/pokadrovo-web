import RecoveryCodeNotice from './account/RecoveryCodeNotice';
import * as React from 'react';
import AiHome from './AiHome';
import HomeFormats from './HomeFormats';
import ProjectLibrary from './ProjectLibrary';
import AiPlans from './AiPlans';
import SiteMotion from './motion/SiteMotion';
import type { Editor } from './editor/editor';
import { OmniAiProvider } from './editor/omni';
import { Asset, Mode, Project, Ratio, newProject, normalizeProject } from './editor/model';
import { loadProjects, saveProject, replaceProjectCache, importOwnerLegacy } from './editor/assets';
import { AuthDialog, ProfileView } from './account/AccountViews';
import { Session, User, getSession, logout, request, acceptSession, currentUser, flushProjectSaves } from './account/api';
import { t } from './editor/copy';
import './editor/editor.css';
import './editor/tools.css';
import './home-formats.css';
import './mobile.css';
import './editor/workspace.css';
import './design-system.css';

type Intent = { kind:'create'|'resume'|'open'|'projects'; brief?:string; id?:string; mode?:Mode; ratio?:Ratio };
const canEdit=(session:Session|null)=>!!session?.user||(session?.accountsEnabled===false||session?.guestEditingEnabled===true);
const accountKey=(session:Session|null)=>session?.user?.id||((session?.accountsEnabled===false||session?.guestEditingEnabled===true)?'guest-local':null);
type State={screen:'home'|'editor'|'profile'|'projects'|'pricing';theme:'light'|'dark';mode:Mode;ratio:Ratio;project:Project|null;projects:Project[];error:string;session:Session|null;checking:boolean;auth:boolean;authMode:'register'|'login';recoveryCode:string};
export default class Studio extends React.Component<Record<string,never>,State>{
 state:State={screen:typeof location!=='undefined'&&['/ai','/pricing'].includes(location.pathname.replace(/\/$/,''))?'pricing':'home',theme:'light',mode:'video',ratio:'16:9',project:null,projects:[],error:'',session:null,checking:true,auth:false,authMode:'register',recoveryCode:''};
 private host:HTMLDivElement|null=null; private editor:Editor|null=null; private assets=new Map<string,Asset>();
 private pending:File[]=[]; private intent:Intent|null=null; private disposed=false; private starting=false; private revision=0; private refreshBusy=false;
 componentDidMount(){
  this.disposed=false;
  try{this.setState({theme:localStorage.getItem('pokadrovo-theme-v2')==='dark'?'dark':'light'});}catch{}
  window.addEventListener('pokadrovo:session-expired',this.expired);window.addEventListener('focus',this.recheck);window.addEventListener('popstate',this.onPop);window.addEventListener('pokadrovo:sync-status',this.syncStatus);
  const q=new URLSearchParams(location.search),auth=q.get('auth');
  if(q.has('signedIn')){try{const raw=sessionStorage.getItem('pokadrovo.auth.intent');if(raw)this.intent=JSON.parse(raw);}catch{} }
  if(location.pathname==='/studio')this.intent={kind:'resume'};
  void getSession().then(async session=>{
   if(this.disposed)return;await this.adopt(session);
   if(canEdit(session)&&this.intent)this.runIntent();
   else if(session.user&&location.pathname==='/profile')this.navigate('profile');
   else if(canEdit(session)&&['/projects',...(session.accountsEnabled===false?['/profile']:[])].includes(location.pathname))this.navigate('projects');
   else if(session.accountsEnabled!==false&&!session.user&&(auth||['/profile','/projects','/studio'].includes(location.pathname)))this.setState({auth:true,authMode:auth==='register'?'register':'login'});
   if(session.accountsEnabled!==false&&q.get('authError'))this.setState({error:'Не удалось войти. Используйте почту и пароль.',auth:true,authMode:'login'});
   if(location.search)history.replaceState({},'',location.pathname);
  }).catch(e=>{if(!this.disposed)this.setState({checking:false,error:e.message});});
 }
 componentDidUpdate(){
  if(this.state.screen==='editor'&&this.host&&!this.editor&&!this.starting&&this.state.project&&canEdit(this.state.session)){
   this.starting=true;const node=this.host,rev=this.revision;
   void import('./editor/editor').then(({Editor})=>{
    if(this.disposed||this.state.screen!=='editor'||node!==this.host||rev!==this.revision||!canEdit(this.state.session)||!this.state.project)return;
    this.editor=new Editor(node,{project:this.state.project,assets:this.assets,theme:this.state.theme,onTheme:this.toggleTheme,
     aiProvider:this.state.session?.user?new OmniAiProvider():undefined,
     onHome:p=>{try{saveProject(p);}catch{}this.setState({project:p});this.navigate('home');},
     onSave:p=>this.setState(s=>({projects:[p,...s.projects.filter(c=>c.id!==p.id)],project:p}))});
    if(this.pending.length){const files=this.pending;this.pending=[];void this.editor.importFiles(files);}
   }).catch(e=>this.setState({error:String(e.message),screen:'home'})).finally(()=>{this.starting=false;});
  }else if(this.state.screen!=='editor'&&this.editor){this.editor.dispose();this.editor=null;this.revision++;}
  this.editor?.setTheme(this.state.theme);
 }
 componentWillUnmount(){this.disposed=true;this.revision++;this.editor?.dispose();this.assets.forEach(a=>URL.revokeObjectURL(a.url));this.assets.clear();window.removeEventListener('pokadrovo:session-expired',this.expired);window.removeEventListener('focus',this.recheck);window.removeEventListener('popstate',this.onPop);window.removeEventListener('pokadrovo:sync-status',this.syncStatus);}
 private async adopt(session:Session){
  if(this.disposed)return;
  const changed=accountKey(session)!==accountKey(this.state.session);
  if(changed){this.revision++;this.editor?.dispose();this.editor=null;this.assets.forEach(a=>URL.revokeObjectURL(a.url));this.assets.clear();}
  let projects:Project[]=[];
  if(canEdit(session)){try{projects=loadProjects();if(session.user){const r=await request<{projects:unknown[]}>('/projects');if(currentUser()?.id!==session.user.id)return;const map=new Map(projects.map(p=>[p.id,p]));for(const raw of r.projects){const p=normalizeProject(raw),old=map.get(p.id);if(!old||old.modified<p.modified)map.set(p.id,p);}projects=[...map.values()].sort((a,b)=>b.modified-a.modified);replaceProjectCache(projects);}}catch(e){this.setState({error:(e as Error).message});}}
  await new Promise<void>(done=>this.setState(s=>({session,checking:false,projects,project:changed?(projects[0]||null):(s.project||projects[0]||null),screen:changed&&s.screen!=='pricing'?'home':s.screen}),done));
 }
 private syncStatus=(event:Event)=>{const status=this.host?.querySelector('.pe-status');if(status)status.textContent=String((event as CustomEvent).detail||'');};
 private navigate=(screen:State['screen'])=>{history.pushState({},'',screen==='home'?'/':screen==='editor'?'/studio':screen==='projects'?'/projects':screen==='pricing'?'/ai':'/profile');this.setState({screen});window.scrollTo({top:0,behavior:'instant'});};
 private onPop=()=>{if(['/ai','/pricing'].includes(location.pathname.replace(/\/$/,'')))this.setState({screen:'pricing'});else if(location.pathname==='/studio')void this.authorize({kind:'resume'});else if(location.pathname==='/projects'){if(canEdit(this.state.session))this.setState({screen:'projects'});else void this.authorize({kind:'projects'});}else if(location.pathname==='/profile')this.openAccount();else this.setState({screen:'home'});};
 private recheck=()=>{if(this.refreshBusy||this.state.checking||this.disposed)return;this.refreshBusy=true;void getSession().then(s=>{if(!s.user&&this.state.session?.user)this.expired();else if(accountKey(s)!==accountKey(this.state.session)||s.accountsEnabled!==this.state.session?.accountsEnabled||s.guestEditingEnabled!==this.state.session?.guestEditingEnabled||s.legal?.version!==this.state.session?.legal?.version||s.legal?.ready!==this.state.session?.legal?.ready||s.mail?.enabled!==this.state.session?.mail?.enabled||s.user?.emailVerified!==this.state.session?.user?.emailVerified)void this.adopt(s);}).catch(()=>{}).finally(()=>{this.refreshBusy=false;});};
 private expired=()=>{if(this.disposed)return;if(this.state.session?.accountsEnabled===false){this.pending=[];this.intent=null;void getSession().then(s=>this.adopt(s)).then(()=>this.navigate('home')).catch(e=>this.setState({error:e.message}));return;}this.editor?.dispose();this.editor=null;this.revision++;acceptSession({user:null,csrf:'',providers:this.state.session?.providers||[]});this.intent={kind:'resume'};this.setState({session:null,screen:'home',project:null,projects:[],auth:true,authMode:'login',error:'Сеанс завершён. Войдите снова.'});void getSession().then(session=>{if(!this.disposed)this.setState({session});}).catch(()=>{});};
 private rememberIntent(){try{if(this.intent)sessionStorage.setItem('pokadrovo.auth.intent',JSON.stringify(this.intent));else sessionStorage.removeItem('pokadrovo.auth.intent');}catch{}}
 private authorize=async(intent:Intent)=>{
  this.intent=intent;this.rememberIntent();this.setState({error:''});
  try{const s=await getSession();if(canEdit(s)){await this.adopt(s);this.runIntent();}else{await this.adopt(s);this.setState({auth:true,authMode:'register'});}}
  catch(e){this.setState({error:(e as Error).message,auth:this.state.session?.accountsEnabled!==false,authMode:'login'});}
 };
 private runIntent(){const intent=this.intent;this.intent=null;this.rememberIntent();if(!canEdit(this.state.session))return;
  if(!intent){this.openAccount();return;}
  if(intent.kind==='projects'){this.setState({auth:false,error:''});this.navigate('projects');return;}
  let project:Project|null=null;
  if(intent.kind==='open')project=this.state.projects.find(p=>p.id===intent.id)||null;
  else if(intent.kind==='resume')project=this.state.project||this.state.projects[0]||null;
  if(!project){project=newProject(intent.mode||this.state.mode,intent.brief||'');project.ratio=intent.ratio||this.state.ratio;project.name=project.mode==='reels'?'Reels / Shorts':t.newProject;try{saveProject(project);}catch{}}
  const p=project;this.setState(s=>({project:p,projects:[p,...s.projects.filter(x=>x.id!==p.id)],auth:false,error:''}),()=>this.navigate('editor'));
 }
 private create=(brief:string)=>{void this.authorize({kind:'create',brief,mode:this.state.mode,ratio:this.state.ratio});};
 private attach=(files:FileList|null,brief:string)=>{if(!files?.length)return;this.pending=Array.from(files);this.create(brief);};
 private openProjects=()=>{this.persistEditor();void this.authorize({kind:'projects'});};
 private resume=()=>{void this.authorize({kind:'resume'});};
 private openProject=(id:string)=>{void this.authorize({kind:'open',id});};
 private toggleTheme=()=>this.setState(s=>{const theme=s.theme==='light'?'dark':'light';try{localStorage.setItem('pokadrovo-theme-v2',theme);}catch{}return {theme};});
 private persistEditor(){if(this.editor){const p=this.editor.flushPendingChanges();this.setState(s=>({project:p,projects:[p,...s.projects.filter(x=>x.id!==p.id)]}));}}
 private openAccount=()=>{if(this.state.checking||!this.state.session){void getSession().then(s=>this.adopt(s)).then(()=>this.openAccount()).catch(e=>this.setState({checking:false,error:e.message}));return;}this.persistEditor();if(this.state.session?.accountsEnabled===false&&!this.state.session?.user){this.navigate('projects');}else if(this.state.session?.user){this.navigate('profile');}else this.setState({auth:true,authMode:'register'});};
 private openSignIn=()=>{this.persistEditor();this.setState({auth:true,authMode:'login',error:''});void getSession().then(async session=>{await this.adopt(session);if(session.user){this.setState({auth:false});this.openAccount();}}).catch(e=>this.setState({error:e.message}));};
 private openAdmin=()=>{const s=this.state.session;if(s?.user?.role!=='owner'||!s.adminPath||!/^\/(?!\/)[\w!/-]+$/.test(s.adminPath))return;this.persistEditor();void flushProjectSaves().then(()=>window.location.assign(s.adminPath!));};
 private closeAuth=()=>this.setState({auth:false,error:''});
 private authenticated=(s:Session)=>{const {recoveryCode,...safe}=s;void this.adopt(safe).then(()=>{this.setState({auth:false,error:'',recoveryCode:recoveryCode||''});this.runIntent();});};
 private signOut=()=>{void flushProjectSaves().then(()=>logout()).then(async s=>{this.pending=[];this.intent=null;this.rememberIntent();this.setState({recoveryCode:''});await this.adopt(s);this.navigate('home');}).catch(e=>{if(e.status===401)this.expired();else this.setState({error:e.message});});};
 private changedUser=(u:User)=>{if(this.state.session){const session=acceptSession({...this.state.session,user:u});this.setState({session});}};
 private restoreLegacy=()=>{if(this.state.session?.user?.role!=='owner'||!confirm('Добавить в аккаунт администратора проекты, сохранённые в этом браузере до регистрации?'))return;try{const projects=importOwnerLegacy();this.setState({projects,error:'Старые локальные проекты добавлены в аккаунт.'});}catch(e){this.setState({error:(e as Error).message});}};
 render(){const s=this.state,user=s.session?.user;const balance=undefined;return <>
  <SiteMotion screen={s.screen}/>
  {s.screen==='pricing'?<AiPlans balance={balance} theme={s.theme} onTheme={this.toggleTheme} onHome={()=>this.navigate('home')} onStart={this.resume}/>:s.screen==='home'?<div key="home" className="ps-shell" data-theme={s.theme}>
   <AiHome balance={balance} guestMode={s.checking||!user&&canEdit(s.session)} registrationEnabled={s.session?.accountsEnabled===true} onSignIn={this.openSignIn} theme={s.theme} onToggleTheme={this.toggleTheme} onCreate={this.create} onContinue={this.resume} onProjects={this.openProjects} onImport={this.attach} onOpenProject={this.openProject} account={user?{id:user.id,name:user.name,role:user.role}:null} onAccount={this.openAccount} onAdmin={user?.role==='owner'&&s.session?.adminPath?this.openAdmin:undefined} projects={s.projects.map(p=>({id:p.id,name:p.name,count:p.clips.length,modified:p.modified}))}/>
   <HomeFormats mode={s.mode} ratio={s.ratio} onChoose={(mode,ratio)=>this.setState({mode,ratio})} onStart={()=>this.create('')}/>
  </div>:s.screen==='projects'?<ProjectLibrary balance={balance} projects={s.projects} theme={s.theme} onHome={()=>this.navigate('home')} onNew={()=>this.create('')} onOpen={this.openProject} onImport={()=>this.setState({projects:loadProjects()})}/>:s.screen==='profile'&&user?<><ProfileView balance={balance} onRecoveryCode={code=>this.setState({recoveryCode:code})} user={user} projects={s.projects} theme={s.theme} onTheme={this.toggleTheme} onHome={()=>this.navigate('home')} onEditor={this.resume} onNew={()=>this.create('')} onOpen={this.openProject} onLogout={this.signOut} onUser={this.changedUser} onAdmin={user?.role==='owner'&&s.session?.adminPath?this.openAdmin:undefined}/>{user.role==='owner'&&<button className="au-legacy" onClick={this.restoreLegacy}>Восстановить проекты прежней версии из этого браузера</button>}</>:<div className="pk-workspace" data-theme={s.theme}>{canEdit(s.session)&&<nav className="au-editor-account" data-theme={s.theme} aria-label="Аккаунт и баланс"><button onClick={this.openAccount} title={user?'Профиль · '+user.name:'Аккаунт'}>{user?'Профиль':'Аккаунт'}</button>{user?.role==='owner'&&s.session?.adminPath&&<button onClick={this.openAdmin}>Админ-панель</button>}{balance}</nav>}<div key="editor" ref={node=>{this.host=node;}}/></div>}
  {s.error&&!s.auth&&<button className="au-shell-notice" onClick={()=>this.setState({error:''})} title="Закрыть сообщение" role="status">{s.error} ×</button>}
  {s.auth&&!s.recoveryCode&&s.session?.accountsEnabled!==false&&<AuthDialog session={s.session} theme={s.theme} initialMode={s.authMode} error={s.error} onClose={this.closeAuth} onSuccess={this.authenticated} onRecoveryCode={code=>this.setState({recoveryCode:code})}/>}
  {s.recoveryCode&&<RecoveryCodeNotice code={s.recoveryCode} theme={s.theme} onClose={()=>this.setState({recoveryCode:''})}/>}
 </>;}
}
