import React,{useState} from 'react';
import {Project,normalizeProject,totalLength,clock} from './editor/model';
import {saveProject,download} from './editor/assets';
import './projects.css';

export default function ProjectLibrary({projects,theme,onHome,onNew,onOpen,onImport}:{projects:Project[];theme:'light'|'dark';onHome:()=>void;onNew:()=>void;onOpen:(id:string)=>void;onImport:()=>void}){
  const [error,setError]=useState('');
  const importFile=async(file?:File)=>{
    if(!file)return;
    try{
      if(file.size>10*1024*1024)throw Error('Файл проекта слишком большой.');
      const raw=JSON.parse(await file.text()),values=Array.isArray(raw)?raw:[raw];
      const imported=values.map(normalizeProject);
      for(const project of imported)saveProject(project);
      onImport();setError('');
    }catch(e){setError('Не удалось открыть проект: '+(e as Error).message);}
  };
  return <main className="pk-library" data-theme={theme}>
    <nav><button onClick={onHome}>← Покадрово</button><span>МОНТАЖНАЯ СТУДИЯ</span></nav>
    <header><div><h1>Мои проекты</h1><p>Сохраняются в этом браузере. Исходные видео, фото и музыка остаются на вашем устройстве.</p></div><button className="pk-library-primary" onClick={onNew}>+ Новый проект</button></header>
    <div className="pk-library-actions"><label>Открыть проект JSON<input type="file" accept=".json,application/json" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label><button disabled={!projects.length} onClick={()=>download(new Blob([JSON.stringify(projects,null,2)],{type:'application/json'}),'Pokadrovo-projects.json')}>Скачать проекты JSON</button></div>
    <p className="pk-library-note">JSON сохраняет монтаж, но не содержит исходные медиафайлы. Храните их отдельно.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="pk-library-grid">{projects.length?projects.map(project=><button className="pk-library-project" key={project.id} onClick={()=>onOpen(project.id)}><span>{project.mode==='reels'?'REELS / SHORTS':'VIDEO'} · {project.ratio}</span><strong>{project.name}</strong><small>{project.clips.length} клипов · {clock(totalLength(project))} · {new Date(project.modified).toLocaleDateString('ru-RU')}</small><b>Продолжить монтаж →</b></button>):<section><h2>Ваша первая история начинается здесь</h2><p>Откройте монтажёр и добавьте видео, музыку или фотографии.</p><button className="pk-library-primary" onClick={onNew}>Создать проект</button></section>}</div>
  </main>;
}
