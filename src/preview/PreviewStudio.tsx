import React from 'react';
import AiHome from '../AiHome';
import HomeFormats from '../HomeFormats';
import { Editor } from '../editor/editor';
import { Asset,Mode,Project,Ratio,newProject,normalizeProject,totalLength,clock } from '../editor/model';
import { download,loadProjects,saveProject } from './assets';
import { previewStorage,record } from './storage';
import { AdminPreview } from './admin';
import '../editor/editor.css';
import '../editor/tools.css';
import '../editor/workspace.css';
import '../motion/site-motion.css';
import '../home-formats.css';
import './preview.css';
import '../design-system.css';

type Screen='home'|'editor'|'projects'|'admin';
type State={screen:Screen;theme:'light'|'dark';projects:Project[];project:Project|null;mode:Mode;ratio:Ratio;notice:string};
export default class PreviewStudio extends React.Component<{initialScreen?:'home'|'admin';adminView?:'overview'|'api'},State>{
  state:State={screen:this.props.initialScreen||'home',theme:previewStorage.getItem('theme')==='dark'?'dark':'light',projects:loadProjects(),project:null,mode:'video',ratio:'16:9',notice:''};
  private host:HTMLDivElement|null=null;
  private editor:Editor|null=null;
  private assets=new Map<string,Asset>();
  private pending:File[]=[];
  componentDidMount(){record('site_view');window.addEventListener('pokadrovo:preview-notice',this.notice);window.addEventListener('pokadrovo:metric',this.metric);window.addEventListener('pokadrovo:preview-saved',this.refresh);}
  componentDidUpdate(){
    if(this.state.screen==='editor'&&this.host&&!this.editor&&this.state.project){
      try{this.editor=new Editor(this.host,{project:this.state.project,assets:this.assets,theme:this.state.theme,onTheme:this.toggleTheme,onSave:this.saved,onHome:project=>{this.saved(project);this.go('home');}});
        if(this.pending.length){const files=this.pending;this.pending=[];void this.editor.importFiles(files);}
      }catch(error){this.setState({screen:'home',notice:(error as Error).message});}
    }
    this.editor?.setTheme(this.state.theme);
  }
  componentWillUnmount(){this.editor?.dispose();this.assets.forEach(asset=>URL.revokeObjectURL(asset.url));window.removeEventListener('pokadrovo:preview-notice',this.notice);window.removeEventListener('pokadrovo:metric',this.metric);window.removeEventListener('pokadrovo:preview-saved',this.refresh);}
  private notice=(event:Event)=>this.setState({notice:String((event as CustomEvent).detail)});
  private metric=(event:Event)=>{const kind=(event as CustomEvent).detail?.kind;if(['export_completed','ai_request'].includes(kind))record(kind);};
  private refresh=()=>this.setState({projects:loadProjects()});
  private saved=(project:Project)=>{this.setState({project,projects:loadProjects()});};
  private leave(){if(this.editor){const project=this.editor.project;saveProject(project);this.setState({project});this.editor.dispose();this.editor=null;}}
  private go=(screen:Screen)=>{this.leave();this.setState({screen,projects:loadProjects(),notice:''});if(screen==='home')record('site_view');};
  private create=(brief='')=>{this.leave();const project=newProject(this.state.mode,brief);project.ratio=this.state.ratio;project.name=project.mode==='reels'?'Reels / Shorts':'Новый проект';saveProject(project);this.setState({screen:'editor',project,notice:''});record('editor_open');};
  private open=(id:string)=>{this.leave();const project=loadProjects().find(p=>p.id===id);if(project){this.setState({screen:'editor',project,notice:''});record('editor_open');}};
  private resume=()=>{const project=this.state.project||loadProjects()[0];project?this.open(project.id):this.create();};
  private attach=(files:FileList|null,brief:string)=>{if(files?.length){this.pending=Array.from(files);this.create(brief);}};
  private toggleTheme=()=>this.setState(s=>{const theme=s.theme==='light'?'dark':'light';previewStorage.setItem('theme',theme);return {theme};});
  private importProjects=async(files:FileList|null)=>{
    if(!files?.[0])return;
    try{if(files[0].size>10*1024*1024)throw Error('Файл проекта слишком большой.');const raw=JSON.parse(await files[0].text());const values=Array.isArray(raw)?raw:[raw];for(const value of values)saveProject(normalizeProject(value));this.refresh();}
    catch(error){this.setState({notice:'Не удалось открыть проект: '+(error as Error).message});}
  };
  render(){const s=this.state;return <div className="pk-chat-app" data-theme={s.theme}>
    <nav className="pk-chat-nav" aria-label="Предпросмотр Покадрово"><strong>покадрово<span>ПРЕДПРОСМОТР</span></strong><div>{(['home','editor','projects','admin'] as Screen[]).map((screen,index)=><button type="button" key={screen} aria-pressed={s.screen===screen} onClick={()=>screen==='editor'?this.resume():this.go(screen)}>{['Сайт','Монтажёр','Проекты','Админ-панель'][index]}</button>)}</div><span className="pk-chat-mode">Без регистрации</span></nav>
    {s.notice&&<div className="pk-chat-notice" role="status">{s.notice}<button type="button" aria-label="Закрыть сообщение" onClick={()=>this.setState({notice:''})}>×</button></div>}
    {s.screen==='home'?<div className="ps-shell" data-theme={s.theme}><AiHome guestMode account={{id:'chat-preview',name:'Мои проекты',role:'preview'}} theme={s.theme} onAccount={()=>this.go('projects')} onToggleTheme={this.toggleTheme} onCreate={this.create} onContinue={this.resume} onImport={this.attach} onOpenProject={this.open} projects={s.projects.map(p=>({id:p.id,name:p.name,count:p.clips.length,modified:p.modified}))}/><HomeFormats mode={s.mode} ratio={s.ratio} onChoose={(mode,ratio)=>this.setState({mode,ratio})} onStart={()=>this.create()}/></div>
    :s.screen==='editor'?<div ref={node=>{this.host=node;}}/>
    :s.screen==='admin'?<AdminPreview onOpen={this.open} onHome={()=>this.go('home')} initialView={this.props.adminView}/>
    :<main className="pk-chat-projects"><span className="pk-chat-eyebrow">ВАША МОНТАЖНАЯ</span><header><div><h1>Мои проекты</h1><p>{previewStorage.durable?'Хранятся в этом браузере. Исходные файлы остаются у вас.':'Доступны в этом окне. Экспортируйте проект перед закрытием.'}</p></div><button type="button" onClick={()=>this.create()}>+ Новый проект</button></header><div className="pk-chat-project-actions"><label>Открыть проект JSON<input type="file" accept=".json,application/json" onChange={e=>void this.importProjects(e.target.files)}/></label><button type="button" disabled={!s.projects.length} onClick={()=>download(new Blob([JSON.stringify(s.projects,null,2)],{type:'application/json'}),'Pokadrovo-projects.json')}>Скачать проекты JSON</button></div><div className="pk-chat-project-grid">{s.projects.length?s.projects.map(p=><button type="button" className="pk-chat-project" key={p.id} onClick={()=>this.open(p.id)}><span>{p.mode==='reels'?'REELS / SHORTS':'VIDEO'} · {p.ratio}</span><strong>{p.name}</strong><small>{p.clips.length} клипов · {clock(totalLength(p))} · {new Date(p.modified).toLocaleDateString('ru-RU')}</small><b>Продолжить монтаж</b></button>):<div className="pk-chat-empty"><h2>Здесь будет ваша первая история</h2><p>Добавьте видео, музыку или фотографии и начните монтаж без аккаунта.</p><button type="button" onClick={()=>this.create()}>Создать проект</button></div>}</div></main>}
  </div>;}
}
