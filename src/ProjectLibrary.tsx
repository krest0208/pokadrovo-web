import React,{useRef,useState} from 'react';
import { ChevronDown, Clock3, Download, Film, FolderOpen, Plus, Upload } from 'lucide-react';
import BrandMark from './BrandMark';
import {Project,normalizeProject,totalLength,clock} from './editor/model';
import {saveProject,download} from './editor/assets';
import './projects.css';

type Props={balance?:React.ReactNode;projects:Project[];theme:'light'|'dark';onHome:()=>void;onNew:()=>void;onOpen:(id:string)=>void;onImport:()=>void};
export default function ProjectLibrary({projects,theme,onHome,onNew,onOpen,onImport,balance}:Props){
  const [error,setError]=useState(''),[importing,setImporting]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const importFile=async(file?:File)=>{
    if(!file||importing)return;
    setImporting(true);setError('');
    try{
      if(file.size>10*1024*1024)throw Error('Файл проекта слишком большой.');
      const raw=JSON.parse(await file.text()),values=Array.isArray(raw)?raw:[raw];
      const imported=values.map(normalizeProject);
      for(const project of imported)saveProject(project);
      onImport();
    }catch(e){setError('Не удалось открыть проект: '+(e as Error).message);}
    finally{setImporting(false);}
  };
  return <main className="pk-library" data-theme={theme}>
    <nav aria-label="Навигация проектов"><button className="pk-library-brand" type="button" onClick={onHome} aria-label="Покадрово: на главную"><BrandMark size={36}/><strong>покадрово</strong></button><span>ВАШЕ ПРОСТРАНСТВО</span>{balance}</nav>
    <header><div><p className="pk-library-eyebrow">Продолжите с того же кадра</p><h1>Мои проекты</h1><p>Все ваши истории в одном месте. Выберите проект или начните новый.</p></div><button type="button" className="pk-library-primary" onClick={onNew}><Plus size={19} aria-hidden="true"/> Новый проект</button></header>
    <details className="pk-library-backups"><summary><span><FolderOpen size={19} aria-hidden="true"/> Импорт и резервная копия</span><ChevronDown size={18} aria-hidden="true"/></summary><div className="pk-library-backup-body">
      <div className="pk-library-actions"><input ref={input} type="file" accept=".json,application/json" hidden aria-label="Файл проекта JSON" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/><button type="button" disabled={importing} onClick={()=>input.current?.click()}><Upload size={18} aria-hidden="true"/>{importing?'Открываю…':'Открыть файл проекта'}</button><button type="button" disabled={!projects.length} onClick={()=>download(new Blob([JSON.stringify(projects,null,2)],{type:'application/json'}),'Pokadrovo-projects.json')}><Download size={18} aria-hidden="true"/> Скачать проекты</button></div>
      <p className="pk-library-note">Файлы JSON сохраняют монтаж. Исходные видео, фото и музыку храните отдельно.</p>
    </div></details>
    {error&&<p className="pk-library-error" role="alert">{error}</p>}
    <div className="pk-library-grid">{projects.length?projects.map(project=><button type="button" className="pk-library-project" key={project.id} onClick={()=>onOpen(project.id)}>
      <span className="pk-project-cover"><span className="pk-project-frame" aria-hidden="true" style={{aspectRatio:project.ratio.replace(':','/')}}><Film size={30}/></span><span className="pk-project-format">{project.mode==='reels'?'Reels / Shorts':'Видео'} · {project.ratio}</span><span className="pk-project-strips" aria-hidden="true"><i/><i/><i/></span></span>
      <span className="pk-project-content"><strong>{project.name}</strong><span className="pk-project-meta"><span><Clock3 size={15} aria-hidden="true"/>{clock(totalLength(project))}</span><span>Клипов: {project.clips.length}</span></span><span className="pk-project-updated">Изменён {new Date(project.modified).toLocaleDateString('ru-RU')}</span><span className="pk-project-open">Продолжить монтаж</span></span>
    </button>):<section className="pk-library-empty"><div className="pk-library-empty-art" aria-hidden="true"><span/><span/><span><Film size={42}/></span></div><h2>Начните свою первую историю</h2><p>Добавьте видео, фотографии или музыку. Кадры соберутся на таймлайне. Дальше дело за вами.</p><button type="button" className="pk-library-primary" onClick={onNew}><Plus size={19} aria-hidden="true"/> Создать проект</button></section>}</div>
    <p className="pk-library-storage">Исходники доступны в том же браузере и на том же устройстве. Сохраните резервную копию монтажа перед переносом проекта.</p>
  </main>;
}
