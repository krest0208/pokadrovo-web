import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Plus, Play, Pause, Scissors, Trash2, Download, Upload, Save, FolderOpen, Type, ChevronLeft, ChevronRight, MoveUp, MoveDown, Settings2, Sparkles, MonitorPlay, Volume2, CircleHelp, RotateCcw, Moon, Sun, Home, ArrowRight, WandSparkles, Zap, ShieldCheck, Layers, PlayCircle, ArrowUpRight } from "lucide-react";
import BrandMark from "./BrandMark";
import { ArrowLeft, CheckCircle2, Grid2X2, FileVideo2, FileImage, MousePointer2, SlidersHorizontal, Video, ZoomIn, ZoomOut, X } from "lucide-react";
import "./pokadrovo.css";
import "./workspace-pro.css";
import AiHome from "./AiHome";


type Clip = { id:string; assetId:string; name:string; kind:"video"|"image"; duration:number; start:number; end:number };
type Asset = { id:string; name:string; kind:"video"|"image"; blob:Blob; url:string; duration:number };
type Project = { id:string; name:string; clips:Clip[]; title:string; created:number; modified:number };
const KEY="pokadrovo-projects-v1";
const randomId=()=>crypto.randomUUID();
const stamp=(t:number)=>{const s=Math.max(0,Math.floor(t));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")};
const span=(c:Clip)=>Math.max(.1,c.end-c.start);
function openDb():Promise<IDBDatabase>{return new Promise((res,rej)=>{const q=indexedDB.open("pokadrovo-media-v1",1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains("files"))q.result.createObjectStore("files")};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function storeFile(id:string,blob:Blob){const db=await openDb();await new Promise<void>((res,rej)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put(blob,id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)});db.close()}
async function readFile(id:string):Promise<Blob|undefined>{const db=await openDb();const result=await new Promise<Blob|undefined>((res,rej)=>{const tx=db.transaction("files");const q=tx.objectStore("files").get(id);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});db.close();return result}
function makeProject():Project{return {id:randomId(),name:"Новый проект",clips:[],title:"",created:Date.now(),modified:Date.now()}}
export default function Studio(){
 const [projects,setProjects]=useState<Project[]>([]);
 const [project,setProject]=useState<Project>(makeProject);
 const [assets,setAssets]=useState<Asset[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const [cursor,setCursor]=useState(0);
 const [playing,setPlaying]=useState(false);
 const [tab,setTab]=useState<"media"|"text"|"projects">("media");
 const [message,setMessage]=useState("Начните с импорта видео или изображения");
 const [exporting,setExporting]=useState(false);
 const [openProjects,setOpenProjects]=useState(false);
 const [theme,setTheme]=useState<"light"|"dark">("light");
 const [screen,setScreen]=useState<"home"|"editor">("home");
 const [timelineZoom,setTimelineZoom]=useState(1);
 const [aiBrief,setAiBrief]=useState("");
 const fileInput=useRef<HTMLInputElement>(null);
 const videoRef=useRef<HTMLVideoElement>(null);
 const stillRef=useRef<HTMLImageElement>(null);
 const playbackRef=useRef(0);
 const urlsRef=useRef<string[]>([]);
 const lastAssetRef=useRef<string|null>(null);
 const timelineRef=useRef<HTMLDivElement>(null);
 const projectRef=useRef(project);projectRef.current=project;
 const assetsRef=useRef(assets);assetsRef.current=assets;
 const total=project.clips.reduce((s,c)=>s+span(c),0);
 const activeIndex=(()=>{let acc=0;for(let i=0;i<project.clips.length;i++){if(cursor<acc+span(project.clips[i])||i===project.clips.length-1)return i;acc+=span(project.clips[i])}return -1})();
 const active=project.clips[activeIndex];
 const activeAsset=active?assets.find(a=>a.id===active.assetId):undefined;
 const localStart=project.clips.slice(0,Math.max(0,activeIndex)).reduce((s,c)=>s+span(c),0);
 const sourceTime=active?active.start+Math.max(0,cursor-localStart):0;
 const selectedClip=project.clips.find(c=>c.id===selected);
 function changeProject(fn:(p:Project)=>Project){setProject(p=>({...fn(p),modified:Date.now()}))}
 useEffect(()=>{
   try{
     if(localStorage.getItem("pokadrovo-theme-v2")==="dark")setTheme("dark");
   }catch{}
 },[]);
 const toggleTheme=()=>{
   setTheme(old=>{
     const next=old==="light"?"dark":"light";
     try{localStorage.setItem("pokadrovo-theme-v2",next)}catch{}
     return next;
   });
 };
 const startNewProject=()=>{setPlaying(false);setProject(makeProject());setSelected(null);setCursor(0);setOpenProjects(false);setMessage("Новый проект создан. Добавьте видео или фото");setScreen("editor")};
 const startFromIdea=(idea:string)=>{setAiBrief(idea);startNewProject();setMessage(idea?"Задание добавлено в проект. ИИ-обработка пока не подключена.":"Новый проект создан. Добавьте медиа");};
 const importFromHome=(files:FileList|null,idea:string)=>{if(!files?.length)return;setAiBrief(idea);setScreen("editor");setOpenProjects(false);void importFiles(files);};
 const continueProject=()=>{setPlaying(false);setOpenProjects(false);setScreen("editor")};
 useEffect(()=>{try{const p=JSON.parse(localStorage.getItem(KEY)||"[]") as Project[];setProjects(p);if(p.length){setProject(p[0]);setSelected(p[0].clips[0]?.id||null)}}catch{}},[]);
 useEffect(()=>{const ids=new Set(project.clips.map(c=>c.assetId));let alive=true;(async()=>{for(const c of project.clips){if(assetsRef.current.some(a=>a.id===c.assetId))continue;try{const blob=await readFile(c.assetId);if(blob&&alive){const url=URL.createObjectURL(blob);urlsRef.current.push(url);setAssets(old=>old.some(a=>a.id===c.assetId)?old:[...old,{id:c.assetId,kind:c.kind,name:c.name,blob,url,duration:c.duration}])}}catch{setMessage("Не удалось загрузить часть медиафайлов")}}})();return()=>{alive=false}},[project.id,project.clips.length]);
 useEffect(()=>()=>{urlsRef.current.forEach(URL.revokeObjectURL);cancelAnimationFrame(playbackRef.current)},[]);
 useEffect(()=>{if(!active||!activeAsset){lastAssetRef.current=null;return}const v=videoRef.current;if(active.kind==="video"&&v){if(lastAssetRef.current!==activeAsset.id){v.src=activeAsset.url;lastAssetRef.current=activeAsset.id}if(Math.abs((v.currentTime||0)-sourceTime)>.18){try{v.currentTime=sourceTime}catch{}}if(playing){void v.play().catch(()=>setPlaying(false))}else v.pause()}},[active?.id,activeAsset?.url,sourceTime,playing,screen]);
 useEffect(()=>{if(!playing||!active)return;let start=performance.now(),initial=cursor;function tick(now:number){const next=initial+(now-start)/1000;if(next>=total){setCursor(0);setPlaying(false);return}setCursor(next);playbackRef.current=requestAnimationFrame(tick)}playbackRef.current=requestAnimationFrame(tick);return()=>cancelAnimationFrame(playbackRef.current)},[playing,active?.id,total]);
 const chooseProject=(p:Project)=>{setPlaying(false);setProject(p);setSelected(p.clips[0]?.id||null);setCursor(0);setOpenProjects(false);lastAssetRef.current=null};
 const openProjectFromHome=(p:Project)=>{chooseProject(p);setScreen("editor")};
 const save=()=>{const updated=[project,...projects.filter(p=>p.id!==project.id)].sort((a,b)=>b.modified-a.modified);setProjects(updated);try{localStorage.setItem(KEY,JSON.stringify(updated));setMessage("Проект сохранён в этом браузере")}catch{setMessage("Не удалось сохранить проект: хранилище переполнено")}};
 const importFiles=async(list:FileList|null)=>{if(!list)return;for(const file of Array.from(list)){const kind=file.type.startsWith("video/")?"video":file.type.startsWith("image/")?"image":null;if(!kind){setMessage("Поддерживаются видео и изображения");continue}const id=randomId(),url=URL.createObjectURL(file);urlsRef.current.push(url);let duration=5;if(kind==="video"){duration=await new Promise<number>(resolve=>{const el=document.createElement("video");el.preload="metadata";el.onloadedmetadata=()=>resolve(Number.isFinite(el.duration)?Math.max(.2,el.duration):5);el.onerror=()=>resolve(5);el.src=url})}const asset:Asset={id,name:file.name,kind,blob:file,url,duration};try{await storeFile(id,file)}catch{setMessage("Файл добавлен только на текущую сессию: недостаточно места")}setAssets(old=>[...old,asset]);const newClip:Clip={id:randomId(),assetId:id,name:file.name,kind,duration,start:0,end:duration};changeProject(p=>({...p,clips:[...p.clips,newClip]}));setSelected(newClip.id);setMessage("Добавлено: "+file.name)}};
 const clipEdit=(id:string,fn:(c:Clip)=>Clip)=>changeProject(p=>({...p,clips:p.clips.map(c=>c.id===id?fn(c):c)}));
 const split=()=>{if(!active)return;const offset=cursor-localStart;if(offset<.15||offset>span(active)-.15){setMessage("Поставьте курсор внутри клипа для разделения");return}const cut=active.start+offset;const left={...active,end:cut};const right={...active,id:randomId(),start:cut};changeProject(p=>({...p,clips:p.clips.flatMap(c=>c.id===active.id?[left,right]:[c])}));setSelected(right.id);setMessage("Клип разделён")};
 const remove=()=>{if(!selected)return;changeProject(p=>({...p,clips:p.clips.filter(c=>c.id!==selected)}));setSelected(null);setCursor(0)};
 const move=(d:number)=>{if(!selectedClip)return;const i=project.clips.findIndex(c=>c.id===selectedClip.id),j=i+d;if(j<0||j>=project.clips.length)return;changeProject(p=>{const arr=[...p.clips];[arr[i],arr[j]]=[arr[j],arr[i]];return {...p,clips:arr}});setCursor(0)};
 const startExport=async()=>{if(!project.clips.length)return;if(!("MediaRecorder" in window)){setMessage("Браузер не поддерживает экспорт. Попробуйте Chrome");return}setPlaying(false);setExporting(true);setMessage("Готовим видео. Не закрывайте вкладку");try{
 const canvas=document.createElement("canvas");canvas.width=960;canvas.height=540;const ctx=canvas.getContext("2d")!;const stream=canvas.captureStream(25);const mime=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(t=>MediaRecorder.isTypeSupported(t))||"";const recorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:4000000}:{videoBitsPerSecond:4000000});const chunks:BlobPart[]=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const complete=new Promise<Blob>(resolve=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:"video/webm"}))});recorder.start(300);
 for(const clip of project.clips){const media=assetsRef.current.find(a=>a.id===clip.assetId);if(!media)continue;let el:HTMLVideoElement|HTMLImageElement;if(clip.kind==="video"){const v=document.createElement("video");v.src=media.url;v.muted=true;v.playsInline=true;await new Promise<void>((resolve,reject)=>{v.onloadeddata=()=>resolve();v.onerror=()=>reject(new Error("Не удалось открыть видео"));v.load()});v.currentTime=clip.start;await new Promise<void>(resolve=>{if(v.seeking)v.onseeked=()=>resolve();else resolve()});await v.play();el=v}else{const img=new Image();img.src=media.url;await img.decode();el=img}
 const started=performance.now();while((performance.now()-started)/1000<span(clip)){const elapsed=(performance.now()-started)/1000;ctx.fillStyle="black";ctx.fillRect(0,0,960,540);const w=el instanceof HTMLVideoElement?el.videoWidth:el.naturalWidth;const h=el instanceof HTMLVideoElement?el.videoHeight:el.naturalHeight;if(w&&h){const scale=Math.min(960/w,540/h);ctx.drawImage(el,(960-w*scale)/2,(540-h*scale)/2,w*scale,h*scale)}if(project.title){ctx.font="bold 42px Arial";ctx.textAlign="center";ctx.lineWidth=5;ctx.strokeStyle="black";ctx.strokeText(project.title,480,460);ctx.fillStyle="white";ctx.fillText(project.title,480,460)}await new Promise(r=>setTimeout(r,40))}if(el instanceof HTMLVideoElement){el.pause();el.removeAttribute("src");el.load()}}
 recorder.stop();const blob=await complete;stream.getTracks().forEach(t=>t.stop());const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=(project.name||"Pokadrovo")+".webm";link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setMessage("Экспорт завершён. Видео сохранено в формате WebM без звука");
 }catch(e){setMessage("Ошибка экспорта: "+(e instanceof Error?e.message:"попробуйте другой файл"))}finally{setExporting(false)}};
 useEffect(()=>{
    if(screen!=="editor")return;
    const onKey=(event:KeyboardEvent)=>{
      const editing=(event.target as HTMLElement|null)?.closest("input,textarea,[contenteditable='true']");
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();save();return}
      if(editing)return;
      if(event.code==="Space"){event.preventDefault();if(total>0)setPlaying(v=>!v)}
      if(event.key==="Delete"&&selected){event.preventDefault();remove()}
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  });
 return <div className="pk-app" data-theme={theme}>
 {screen==="home" ? <AiHome
   theme={theme}
   onToggleTheme={toggleTheme}
   onCreate={startFromIdea}
   onContinue={continueProject}
   onImport={importFromHome}
   onOpenProject={(id)=>{const p=projects.find(item=>item.id===id);if(p)openProjectFromHome(p)}}
   projects={projects.map(p=>({id:p.id,name:p.name,modified:p.modified,count:p.clips.length}))}
 /> : <>

 <header className="px-topbar">
  <div className="px-top-left">
    <button className="px-square-btn" title="На главную" aria-label="На главную" onClick={()=>{setPlaying(false);setScreen("home")}}><Home size={18}/></button>
    <BrandMark size={36}/>
    <span className="px-wordmark">покадрово<small>STUDIO</small></span>
    <span className="px-top-divider"/>
    <div className="px-project-info"><input aria-label="Название проекта" value={project.name} onChange={e=>changeProject(p=>({...p,name:e.target.value}))}/><span><span className="px-saved-dot"/> На этом устройстве</span></div>
  </div>
  <div className="px-top-actions">
    <button className="px-square-btn" title={theme==="light"?"Тёмная тема":"Светлая тема"} aria-label={theme==="light"?"Тёмная тема":"Светлая тема"} onClick={toggleTheme}>{theme==="light"?<Moon size={18}/>:<Sun size={18}/>}</button>
    <button className="px-secondary-btn" onClick={()=>setOpenProjects(v=>!v)}><FolderOpen size={16}/><span>Проекты</span></button>
    <button className="px-secondary-btn" onClick={save}><Save size={16}/><span>Сохранить</span></button>
    <button className="px-primary-btn" onClick={startExport} disabled={exporting||!project.clips.length}><Download size={16}/>{exporting?"Экспорт…":"Экспорт"}</button>
  </div>
 </header>
 {openProjects&&<div className="px-project-menu">
   <div className="px-menu-heading"><strong>Сохранённые проекты</strong><button onClick={()=>{chooseProject(makeProject());setOpenProjects(false)}}><Plus size={14}/> Новый</button></div>
   {projects.length?projects.map(p=><button key={p.id} className="px-project-row" onClick={()=>chooseProject(p)}><BrandMark size={27}/><span><strong>{p.name||"Без названия"}</strong><small>{p.clips.length} клипов · {new Date(p.modified).toLocaleDateString("ru-RU")}</small></span><ChevronRight size={15}/></button>):<p className="px-hint">Сохранённых проектов пока нет.</p>}
 </div>}
 {aiBrief&&<div className="px-ai-brief"><WandSparkles size={16}/><span><strong>Ваш замысел:</strong> {aiBrief}</span><small>ИИ пока не подключён</small><button title="Убрать задание" aria-label="Убрать задание" onClick={()=>setAiBrief("")}><X size={15}/></button></div>}
 <div className="px-editor">
  <nav className="px-toolrail" aria-label="Инструменты">
    <button className={tab==="media"?"is-active":""} onClick={()=>setTab("media")}><Grid2X2 size={21}/><span>Медиа</span></button>
    <button className={tab==="text"?"is-active":""} onClick={()=>setTab("text")}><Type size={21}/><span>Текст</span></button>
    <button className={tab==="projects"?"is-active":""} onClick={()=>setTab("projects")}><FolderOpen size={21}/><span>Проекты</span></button>
    <small>v0.3</small>
  </nav>
  <aside className="px-bin">
    <input ref={fileInput} hidden multiple type="file" accept="video/*,image/*" onChange={e=>{void importFiles(e.currentTarget.files);e.currentTarget.value=""}}/>
    {tab==="media"?<>
      <header className="px-bin-heading"><div><h3>Медиатека</h3><p>Ваши материалы</p></div><span>{assets.length}</span></header>
      <button className="px-upload" onClick={()=>fileInput.current?.click()}><Upload size={16}/> Импортировать файлы</button>
      <div className="px-bin-category">МАТЕРИАЛЫ <span>{assets.length} файлов</span></div>
      {assets.length?<div className="px-asset-grid">{assets.map(a=><button key={a.id} className="px-asset" title={"Добавить на дорожку: "+a.name} onClick={()=>{
        const c:Clip={id:randomId(),assetId:a.id,name:a.name,kind:a.kind,duration:a.duration,start:0,end:a.duration};changeProject(p=>({...p,clips:[...p.clips,c]}));setSelected(c.id);setMessage("Добавлено на таймлайн");
      }}><span className="px-asset-picture">{a.kind==="image"?<img src={a.url} alt="" loading="lazy"/>:<FileVideo2 size={25}/>}<small>{a.kind==="video"?stamp(a.duration):"ФОТО"}</small></span><span className="px-asset-name">{a.name}</span></button>)}</div>:
      <div className="px-bin-empty"><span><Upload size={25}/></span><strong>Добавьте первое видео</strong><p>Загрузите видео или фотографии со своего устройства.</p><button onClick={()=>fileInput.current?.click()}>Выбрать файл <ArrowRight size={14}/></button></div>}
      {assets.length>0&&<p className="px-hint">Нажмите на материал, чтобы добавить его на монтажную дорожку.</p>}
    </>:tab==="text"?<>
      <header className="px-bin-heading"><div><h3>Текст</h3><p>Надписи на видео</p></div></header>
      <label className="px-field-label" htmlFor="px-text">Надпись в кадре</label>
      <textarea id="px-text" className="px-textarea" rows={5} placeholder="Например: моё путешествие" value={project.title} onChange={e=>changeProject(p=>({...p,title:e.target.value}))}/>
      <p className="px-hint">Текст отображается поверх всего ролика и попадёт в экспорт.</p>
      <div className="px-text-preset"><span>ВАШ ТЕКСТ</span><strong>Классический титр</strong><small>Белый · по центру</small></div>
    </>:<>
      <header className="px-bin-heading"><div><h3>Проекты</h3><p>Сохранены в браузере</p></div></header>
      <button className="px-upload" onClick={()=>chooseProject(makeProject())}><Plus size={16}/> Новый проект</button>
      <div className="px-bin-category">ПОСЛЕДНИЕ</div>
      {projects.map(p=><button key={p.id} className="px-project-row" onClick={()=>chooseProject(p)}><BrandMark size={29}/><span><strong>{p.name}</strong><small>{p.clips.length} клипов</small></span></button>)}
      {!projects.length&&<p className="px-hint">Сохраните текущий монтаж, чтобы он появился здесь.</p>}
    </>}
  </aside>
  <section className="px-preview">
    <header className="px-panel-header"><span><MonitorPlay size={15}/> Предпросмотр</span><span className="px-panel-spec">16:9 <i/> 960 × 540</span></header>
    <div className="px-preview-area"><div className="px-canvas">
      {active&&activeAsset?(active.kind==="video"?<video key={activeAsset.id} ref={videoRef} playsInline muted preload="auto" className="px-video"/>:<img src={activeAsset.url} alt="Предпросмотр"/>):
       <div className="px-empty-canvas"><BrandMark size={60}/><strong>Начните создавать свою историю</strong><span>Добавьте файлы на таймлайн</span><button onClick={()=>fileInput.current?.click()}><Plus size={15}/> Добавить видео</button></div>}
      {project.title&&active&&<div className="px-overlay-title">{project.title}</div>}
    </div></div>
    <div className="px-player-controls"><span><b>{stamp(cursor)}</b> / {stamp(total)}</span><div><button title="Назад на секунду" onClick={()=>setCursor(Math.max(0,cursor-1))}><ChevronLeft size={19}/></button><button className="px-play" title={playing?"Пауза":"Воспроизвести"} disabled={!total} onClick={()=>{if(total){if(cursor>=total)setCursor(0);setPlaying(v=>!v)}}}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button title="Вперёд на секунду" onClick={()=>setCursor(Math.min(total,cursor+1))}><ChevronRight size={19}/></button></div><small>Пробел — пауза</small></div>
  </section>
  <aside className="px-settings">
    <header className="px-panel-header"><span><SlidersHorizontal size={15}/> Параметры</span><small>{selectedClip?"КЛИП":"ПРОЕКТ"}</small></header>
    {selectedClip?<div className="px-settings-body">
      <div className="px-file-details"><span>{selectedClip.kind==="video"?<FileVideo2 size={22}/>:<FileImage size={22}/>}</span><div><strong title={selectedClip.name}>{selectedClip.name}</strong><small>{selectedClip.kind==="video"?"Видео":"Фото"} · {span(selectedClip).toFixed(1)} сек.</small></div></div>
      <h4>Обрезка фрагмента</h4><p className="px-hint">Настройте начало и конец исходного клипа.</p>
      <div className="px-trim-fields"><label>Начало, с<input type="number" min="0" max={selectedClip.end-.1} step=".1" value={Number(selectedClip.start.toFixed(2))} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v))clipEdit(selectedClip.id,c=>({...c,start:Math.min(Math.max(0,v),c.end-.1)}))}}/></label><label>Конец, с<input type="number" min={selectedClip.start+.1} max={selectedClip.duration} step=".1" value={Number(selectedClip.end.toFixed(2))} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v))clipEdit(selectedClip.id,c=>({...c,end:Math.max(c.start+.1,Math.min(v,c.duration))}))}}/></label></div>
      <div className="px-metric"><span>Длительность</span><strong>{span(selectedClip).toFixed(1)} c</strong></div><div className="px-metric"><span>Исходный файл</span><strong>{stamp(selectedClip.duration)}</strong></div>
      <h4>Порядок клипа</h4><div className="px-move-actions"><button onClick={()=>move(-1)}><MoveUp size={16}/> Раньше</button><button onClick={()=>move(1)}><MoveDown size={16}/> Позже</button></div><button className="px-delete" onClick={remove}><Trash2 size={16}/> Удалить клип</button>
    </div>:<div className="px-settings-body"><div className="px-empty-settings"><span><MousePointer2 size={24}/></span><strong>Выберите клип</strong><p>Нажмите на фрагмент на таймлайне, чтобы изменить его параметры.</p></div><h4>Сведения о проекте</h4><div className="px-metric"><span>Клипов</span><strong>{project.clips.length}</strong></div><div className="px-metric"><span>Длительность</span><strong>{stamp(total)}</strong></div><div className="px-metric"><span>Формат экспорта</span><strong>WebM</strong></div></div>}
  </aside>
 </div>
 <section className="px-timeline">
   <header className="px-timeline-top"><div className="px-timeline-name"><Layers size={17}/><strong>Таймлайн</strong><span>{project.clips.length} клипов</span></div><div className="px-timeline-tools"><button disabled={!active} title="Разделить" onClick={split}><Scissors size={16}/><span>Разделить</span></button><button disabled={!selected} title="Удалить" onClick={remove}><Trash2 size={16}/></button><i/><button title="Уменьшить масштаб" onClick={()=>setTimelineZoom(z=>Math.max(.5,Number((z-.25).toFixed(2))))}><ZoomOut size={16}/></button><input type="range" aria-label="Масштаб таймлайна" min=".5" max="3" step=".25" value={timelineZoom} onChange={e=>setTimelineZoom(Number(e.target.value))}/><button title="Увеличить масштаб" onClick={()=>setTimelineZoom(z=>Math.min(3,Number((z+.25).toFixed(2))))}><ZoomIn size={16}/></button><small>{Math.round(timelineZoom*100)}%</small></div></header>
   <div className="px-timeline-scroll"><div className="px-timeline-grid">
     <div className="px-track-label-head">ДОРОЖКИ</div>
     <div className="px-track-labels"><div><Video size={15}/> Видео 1</div><div><Type size={15}/> Текст</div></div>
     <div className="px-track-content" style={{width:Math.max(760,total*64*timelineZoom)}}>
       <div className="px-ruler" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(total)setCursor(Math.min(total,Math.max(0,(e.clientX-r.left)/r.width*total)))}}>{Array.from({length:9},(_,i)=><span key={i}>{stamp(total*i/8)}</span>)}</div>
       <div className="px-playhead" style={{left:total?(cursor/total*100)+"%":"0%"}} hidden={!total}><span/></div>
       <div className="px-video-track" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(total)setCursor(Math.min(total,Math.max(0,(e.clientX-r.left)/r.width*total)))}}>
         {project.clips.length?<div className="px-clips">{project.clips.map(c=><button key={c.id} style={{flexGrow:span(c),flexBasis:0}} title={c.name} className={"px-clip "+(selected===c.id?"is-selected":"")} onClick={e=>{e.stopPropagation();setSelected(c.id);let t=0;for(const item of project.clips){if(item.id===c.id)break;t+=span(item)}setCursor(t)}}><span>{c.kind==="video"?<Video size={12}/>:<FileImage size={12}/>} <b>{c.name}</b></span><small>{span(c).toFixed(1)} сек.</small></button>)}</div>:<button className="px-track-empty" onClick={()=>fileInput.current?.click()}><Plus size={16}/> Добавьте материалы, чтобы начать монтаж</button>}
       </div>
       <div className="px-text-track">{project.title&&project.clips.length?<button onClick={()=>setTab("text")}><Type size={13}/> {project.title}</button>:<span>Добавьте текст во вкладке «Текст»</span>}</div>
     </div>
   </div></div>
 </section>
 <div className="px-status"><span><CheckCircle2 size={14}/>{message}</span><span>Веб-версия · WebM без звука · Локальные проекты</span></div>
 </>}
 </div>
}

