import * as React from 'react';
import AiHome from './AiHome';
import HomeFormats from './HomeFormats';
import { Editor } from './editor/editor';
import { Asset, Mode, Project, Ratio, newProject } from './editor/model';
import { loadProjects } from './editor/assets';
import { t } from './editor/copy';
import './editor/editor.css';
import './editor/tools.css';
import './home-formats.css';

type State={screen:'home'|'editor';theme:'light'|'dark';mode:Mode;ratio:Ratio;project:Project|null;projects:Project[];error:string};
/** Web-only shell. The existing layered AiHome and its callback contract remain intact. */
export default class Studio extends React.Component<Record<string,never>,State>{
 state:State={screen:'home',theme:'light',mode:'video',ratio:'16:9',project:null,projects:[],error:''};
 private host:HTMLDivElement|null=null;
 private editor:Editor|null=null;
 private assets=new Map<string,Asset>();
 private pending:File[]=[];
 componentDidMount(){
  let projects:Project[]=[];let error='';let theme:'light'|'dark'='light';
  try{projects=loadProjects();theme=localStorage.getItem('pokadrovo-theme-v2')==='dark'?'dark':'light';}catch{error=t.storageError;}
  this.setState({projects,project:projects[0]||null,theme,error});
 }
 componentDidUpdate(){
  if(this.state.screen==='editor'&&this.host&&!this.editor&&this.state.project){
   this.editor=new Editor(this.host,{
    project:this.state.project,assets:this.assets,theme:this.state.theme,onTheme:this.toggleTheme,
    onHome:p=>this.setState({screen:'home',project:p}),
    onSave:p=>this.setState(s=>({projects:[p,...s.projects.filter(c=>c.id!==p.id)],project:p}))
   });
   if(this.pending.length){const files=this.pending;this.pending=[];void this.editor.importFiles(files);}
  }else if(this.state.screen==='home'&&this.editor){this.editor.dispose();this.editor=null;}
  this.editor?.setTheme(this.state.theme);
 }
 componentWillUnmount(){this.editor?.dispose();this.assets.forEach(a=>URL.revokeObjectURL(a.url));this.assets.clear();}
 private toggleTheme=()=>this.setState(s=>{const theme=s.theme==='light'?'dark':'light';try{localStorage.setItem('pokadrovo-theme-v2',theme);}catch{}return {theme};});
 private create=(brief:string)=>{const p=newProject(this.state.mode,brief);p.name=this.state.mode==='reels'?'Reels / Shorts':t.newProject;p.ratio=this.state.ratio;this.setState({project:p,screen:'editor'});};
 private attach=(files:FileList|null,brief:string)=>{if(!files?.length)return;this.pending=Array.from(files);this.create(brief);};
 private resume=()=>{if(this.state.project)this.setState({screen:'editor'});else this.create('');};
 render(){return this.state.screen==='home'?<div key="home" className="ps-shell" data-theme={this.state.theme}>
   {this.state.error&&<p role="status" className="ps-storage-error">{this.state.error}</p>}
   <AiHome theme={this.state.theme} onToggleTheme={this.toggleTheme} onCreate={this.create} onContinue={this.resume} onImport={this.attach}
    onOpenProject={id=>{const project=this.state.projects.find(p=>p.id===id);if(project)this.setState({project,screen:'editor'});}}
    projects={this.state.projects.map(p=>({id:p.id,name:p.name,count:p.clips.length,modified:p.modified}))}/>
   <HomeFormats mode={this.state.mode} ratio={this.state.ratio} onChoose={(mode,ratio)=>this.setState({mode,ratio})}/>
  </div>:<div key="editor" ref={node=>{this.host=node;}}/>;}
}
