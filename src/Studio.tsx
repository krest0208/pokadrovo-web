import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Plus, Play, Pause, Scissors, Trash2, Download, Upload, Save, FolderOpen, Type, ChevronLeft, ChevronRight, MoveUp, MoveDown, Settings2, Sparkles, MonitorPlay, Volume2, CircleHelp, RotateCcw, Moon, Sun, Home, ArrowRight, WandSparkles, Zap, ShieldCheck, Layers, PlayCircle, ArrowUpRight } from "lucide-react";
import "./pokadrovo.css";


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
 const continueProject=()=>{setPlaying(false);setOpenProjects(false);setScreen("editor")};
 useEffect(()=>{try{const p=JSON.parse(localStorage.getItem(KEY)||"[]") as Project[];setProjects(p);if(p.length){setProject(p[0]);setSelected(p[0].clips[0]?.id||null)}}catch{}},[]);
 useEffect(()=>{const ids=new Set(project.clips.map(c=>c.assetId));let alive=true;(async()=>{for(const c of project.clips){if(assetsRef.current.some(a=>a.id===c.assetId))continue;try{const blob=await readFile(c.assetId);if(blob&&alive){const url=URL.createObjectURL(blob);urlsRef.current.push(url);setAssets(old=>old.some(a=>a.id===c.assetId)?old:[...old,{id:c.assetId,kind:c.kind,name:c.name,blob,url,duration:c.duration}])}}catch{setMessage("Не удалось загрузить часть медиафайлов")}}})();return()=>{alive=false}},[project.id,project.clips.length]);
 useEffect(()=>()=>{urlsRef.current.forEach(URL.revokeObjectURL);cancelAnimationFrame(playbackRef.current)},[]);
 useEffect(()=>{if(!active||!activeAsset){lastAssetRef.current=null;return}const v=videoRef.current;if(active.kind==="video"&&v){if(lastAssetRef.current!==activeAsset.id){v.src=activeAsset.url;lastAssetRef.current=activeAsset.id}if(Math.abs((v.currentTime||0)-sourceTime)>.18){try{v.currentTime=sourceTime}catch{}}if(playing){void v.play().catch(()=>setPlaying(false))}else v.pause()}},[active?.id,activeAsset?.url,sourceTime,playing]);
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
 return <div className="pk-app" data-theme={theme}>
 {screen==="home" ? <HomeScreen
   theme={theme}
   onToggleTheme={toggleTheme}
   onNewProject={startNewProject}
   onContinue={continueProject}
   onOpenProject={openProjectFromHome}
   projects={projects}
 /> : <>

 <header className="pk-top"><div className="pk-editor-brand"><button type="button" className="pk-homeback" title="На главную" onClick={()=>{setPlaying(false);setScreen("home")}}><Home size={17}/><span>Главная</span></button><div className="pk-logo"><span className="pk-mark"><Film size={21}/></span><strong>ПОКАДРОВО</strong><small>STUDIO</small></div></div><div className="pk-topcenter"><span className="pk-dot"/> <input aria-label="Название проекта" value={project.name} onChange={e=>changeProject(p=>({...p,name:e.target.value}))}/><span className="pk-local">Локальный проект</span></div><div className="pk-topright"><button className="pk-theme-toggle" onClick={toggleTheme} type="button" aria-label={theme==="light"?"Включить тёмную тему":"Включить светлую тему"} title={theme==="light"?"Тёмная тема":"Светлая тема"}>{theme==="light"?<Moon size={18}/>:<Sun size={18}/>}<span>{theme==="light"?"Тёмная":"Светлая"}</span></button><button onClick={()=>setOpenProjects(!openProjects)} className="pk-quiet"><FolderOpen size={16}/> Проекты</button><button onClick={save} className="pk-save"><Save size={16}/> Сохранить</button><button onClick={startExport} className="pk-export" disabled={!project.clips.length||exporting}><Download size={16}/>{exporting?"Экспорт...":"Экспорт видео"}</button></div></header>
 {openProjects&&<div className="pk-projectdrop"><div className="pk-drophead"><strong>Мои проекты</strong><button onClick={()=>{chooseProject(makeProject());setMessage("Новый проект создан")}}><Plus size={15}/> Создать</button></div>{projects.length?projects.map(p=><button key={p.id} onClick={()=>chooseProject(p)} className="pk-projectitem"><Film size={18}/><span><b>{p.name}</b><small>{p.clips.length} клипов · {new Date(p.modified).toLocaleDateString("ru-RU")}</small></span></button>):<p>Сохранённых проектов пока нет</p>}</div>}
 <div className="pk-main"><aside className="pk-rail"><button className={tab==="media"?"active":""} onClick={()=>setTab("media")}><FolderOpen size={21}/><span>Медиа</span></button><button className={tab==="text"?"active":""} onClick={()=>setTab("text")}><Type size={21}/><span>Текст</span></button><button className={tab==="projects"?"active":""} onClick={()=>setTab("projects")}><Film size={21}/><span>Проекты</span></button><div className="pk-railbottom"><CircleHelp size={20}/></div></aside>
 <section className="pk-library">{tab==="media"?<><div className="pk-sectiontitle"><strong>Медиатека</strong><span>{assets.length}</span></div><button className="pk-import" onClick={()=>fileInput.current?.click()}><Upload size={18}/> Импортировать файлы</button><input ref={fileInput} style={{display:"none"}} multiple accept="video/*,image/*" type="file" onChange={e=>{void importFiles(e.target.files);e.target.value=""}}/><p className="pk-hint">Видео и фотографии с вашего устройства</p><div className="pk-assetgrid">{assets.map(a=><button className="pk-asset" key={a.id} onClick={()=>{const c:Clip={id:randomId(),assetId:a.id,name:a.name,kind:a.kind,duration:a.duration,start:0,end:a.duration};changeProject(p=>({...p,clips:[...p.clips,c]}));setSelected(c.id);setMessage("Добавлено на таймлайн")}}>{a.kind==="image"?<img src={a.url} alt=""/>:<div className="pk-vicon"><Film size={25}/></div>}<small>{a.kind==="video"?stamp(a.duration):"ФОТО"}</small><p title={a.name}>{a.name}</p></button>)}</div>{!assets.length&&<div className="pk-emptymedia"><MonitorPlay size={32}/><strong>Ваши материалы появятся здесь</strong><p>Импортируйте первое видео, чтобы начать монтаж.</p></div>}</>:tab==="text"?<div className="pk-pad"><h3>Текст на видео</h3><p className="pk-hint">Один заголовок поверх всего проекта</p><label>Надпись</label><textarea rows={4} value={project.title} placeholder="Введите текст для видео" onChange={e=>changeProject(p=>({...p,title:e.target.value}))}/><p className="pk-hint">Текст будет виден в предпросмотре и готовом файле.</p></div>:<div className="pk-pad"><h3>Мои проекты</h3><button className="pk-import" onClick={()=>chooseProject(makeProject())}><Plus size={16}/> Новый проект</button>{projects.map(p=><button className="pk-projectitem" key={p.id} onClick={()=>chooseProject(p)}>{p.name}</button>)}<p className="pk-hint">Сохранение работает в текущем браузере.</p></div>}</section>
 <section className="pk-view"><div className="pk-viewhead"><span><MonitorPlay size={15}/> Окно просмотра</span><span>16:9 <span className="pk-smallsep">·</span> PREVIEW</span></div><div className="pk-monitor"><div className="pk-screen">{active&&activeAsset?(active.kind==="video"?<video key={activeAsset.id} ref={videoRef} playsInline muted preload="auto" className="pk-previewvideo" />:<img ref={stillRef} src={activeAsset.url} alt="Предпросмотр"/>):<div className="pk-placeholder"><div className="pk-symbol"><Film size={54} strokeWidth={1}/></div><strong>Здесь начнётся ваша история</strong><p>Добавьте медиа на таймлайн</p></div>}{project.title&&active&&<div className="pk-overlaytext">{project.title}</div>}</div></div><div className="pk-controls"><span>{stamp(cursor)} <i>/</i> {stamp(total)}</span><div><button onClick={()=>setCursor(Math.max(0,cursor-1))} title="Назад 1 секунда"><ChevronLeft size={18}/></button><button className="pk-play" onClick={()=>{if(total){if(cursor>=total)setCursor(0);setPlaying(!playing)}}} title={playing?"Пауза":"Воспроизвести"}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button onClick={()=>setCursor(Math.min(total,cursor+1))} title="Вперёд 1 секунда"><ChevronRight size={18}/></button></div><span><Volume2 size={15}/> Без звука</span></div><div className="pk-viewbottom"><div><Sparkles size={17}/> <strong>Пространство для идей</strong></div><p>Монтаж в браузере. Расширенные эффекты, звук и ИИ добавим в следующих версиях.</p></div></section>
 <aside className="pk-inspector"><div className="pk-sectiontitle"><strong><Settings2 size={17}/> Свойства</strong></div>{selectedClip?<div className="pk-properties"><div className="pk-chip">КЛИП ВЫБРАН</div><h3 title={selectedClip.name}>{selectedClip.name}</h3><label>Начало исходника, сек.</label><input type="number" min="0" max={selectedClip.end-.1} step=".1" value={Number(selectedClip.start.toFixed(2))} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v))clipEdit(selectedClip.id,c=>({...c,start:Math.min(Math.max(0,v),c.end-.1)}))}}/><label>Конец исходника, сек.</label><input type="number" min={selectedClip.start+.1} max={selectedClip.duration} step=".1" value={Number(selectedClip.end.toFixed(2))} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v))clipEdit(selectedClip.id,c=>({...c,end:Math.max(c.start+.1,Math.min(v,c.duration))}))}}/><div className="pk-detailrow"><span>Длительность</span><b>{span(selectedClip).toFixed(1)} сек.</b></div><div className="pk-detailrow"><span>Тип</span><b>{selectedClip.kind==="video"?"Видео":"Фото"}</b></div><div className="pk-propertyactions"><button onClick={()=>move(-1)}><MoveUp size={16}/> Раньше</button><button onClick={()=>move(1)}><MoveDown size={16}/> Позже</button></div><button className="pk-remove" onClick={remove}><Trash2 size={17}/> Удалить клип</button></div>:<div className="pk-no-select"><Settings2 size={30}/><b>Выберите клип</b><p>Здесь появятся настройки обрезки, длительности и порядка.</p></div>}</aside></div>
 <section className="pk-timeline"><div className="pk-timeheader"><strong><Film size={16}/> Таймлайн</strong><div className="pk-timetools"><button onClick={()=>setPlaying(false)} title="Остановить"><Pause size={15}/></button><button onClick={split} disabled={!active}><Scissors size={16}/> Разделить</button><button onClick={remove} disabled={!selected}><Trash2 size={15}/></button><span>{project.clips.length} клипов</span></div></div><div className="pk-timebody"><div className="pk-tracklabel"><Film size={17}/><span>Видео 1</span></div><div className="pk-trackarea" ref={timelineRef} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(total)setCursor(Math.min(total,Math.max(0,(e.clientX-r.left)/r.width*total)))}}><div className="pk-ticks">{Array.from({length:9},(_,i)=><span key={i}>{stamp(total*i/8)}</span>)}</div>{project.clips.length?<div className="pk-clips">{project.clips.map(c=><button key={c.id} style={{flexGrow:span(c),flexBasis:0}} className={"pk-clip "+(selected===c.id?"selected":"")} onClick={e=>{e.stopPropagation();setSelected(c.id);let t=0;for(const item of project.clips){if(item.id===c.id)break;t+=span(item)}setCursor(t)}}><Film size={15}/><span>{c.name}</span><small>{span(c).toFixed(1)}с</small></button>)}</div>:<div className="pk-dropzone" onClick={()=>fileInput.current?.click()}><Plus size={18}/> Добавьте файлы, чтобы создать первый клип</div>}{total>0&&<div className="pk-playhead" style={{left:(cursor/total*100)+"%"}}><span/></div>}</div></div><div className="pk-status"><span className="pk-dot"/> {message}<span className="pk-statusright">ПОКАДРОВО · РАБОЧАЯ ВЕРСИЯ</span></div></section>
 </>}
 </div>
}

type ThemeMode="light"|"dark";
type HomeScreenProps={
 theme:ThemeMode;
 onToggleTheme:()=>void;
 onNewProject:()=>void;
 onContinue:()=>void;
 onOpenProject:(project:Project)=>void;
 projects:Project[];
};
function HomeScreen({theme,onToggleTheme,onNewProject,onContinue,onOpenProject,projects}:HomeScreenProps){
 return <div className="pk-home" lang="ru">
  <header className="pk-home-header">
   <div className="pk-home-brand"><span className="pk-brand-symbol"><Film size={23} strokeWidth={2.5}/></span><span className="pk-home-brand-word">ПОКАДРОВО<small>видеоредактор нового поколения</small></span></div>
   <nav className="pk-home-nav" aria-label="Навигация главного меню"><a href="#pk-advantages">Преимущества</a><a href="#pk-ai-vision">Наш ИИ</a><button onClick={onContinue}>Монтажёр <ArrowUpRight size={14}/></button></nav>
   <button className="pk-theme-toggle pk-home-theme" onClick={onToggleTheme} aria-label={theme==="light"?"Включить тёмную тему":"Включить светлую тему"} title={theme==="light"?"Тёмная тема":"Светлая тема"}>{theme==="light"?<Moon size={19}/>:<Sun size={19}/>}<span>{theme==="light"?"Тёмная тема":"Светлая тема"}</span></button>
  </header>
  <div className="pk-home-content">
   <section className="pk-home-hero">
    <div className="pk-hero-copy">
     <div className="pk-hero-pill"><span className="pk-pulse"/> ДОБРО ПОЖАЛОВАТЬ В ПОКАДРОВО</div>
     <h1>Ваши идеи.<br/><span>Наш следующий кадр.</span></h1>
     <p className="pk-hero-intro">Начните с простого монтажа уже сейчас. Мы создаём ИИ-редактор, который в будущем будет понимать смысл видео и помогать собирать сильные истории.</p>
     <div className="pk-hero-actions">
      <button type="button" className="pk-home-primary" onClick={onNewProject}><Plus size={19}/> Начать монтаж <ArrowRight size={18}/></button>
      <button type="button" className="pk-home-secondary" onClick={onContinue}><PlayCircle size={18}/> Продолжить проект</button>
     </div>
     <p className="pk-hero-footnote"><ShieldCheck size={15}/> Монтаж в браузере · Проекты сохраняются на устройстве</p>
    </div>
    <div className="pk-hero-showcase" aria-label="Иллюстрация творческой монтажной студии">
      <div className="pk-showcase-top"><span className="pk-showcase-dots"><i/><i/><i/></span><strong><Film size={15}/> Покадрово Studio</strong><span>ПРЕДПРОСМОТР</span></div>
      <div className="pk-showcase-media"><div className="pk-showcase-sun"/><div className="pk-showcase-hill pk-showcase-hill-one"/><div className="pk-showcase-hill pk-showcase-hill-two"/><div className="pk-showcase-focus"><Play size={21} fill="currentColor"/></div><div className="pk-showcase-caption">Истории начинаются с кадра</div></div>
      <div className="pk-showcase-timeline"><div className="pk-showcase-ruler"><span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span></div><div className="pk-showcase-clips"><div><span/><span/><span/></div><div><span/><span/></div></div><div className="pk-showcase-line"/></div>
      <div className="pk-showcase-bottom"><span><span className="pk-live-circle"/> Творческая студия</span><span>16:9</span></div>
      <div className="pk-float-note"><WandSparkles size={19}/><span>Умный монтаж<br/><small>наша следующая цель</small></span></div>
    </div>
   </section>
   <section className="pk-home-advantages" id="pk-advantages">
    <div className="pk-home-section-label">ПОЧЕМУ ПОКАДРОВО</div>
    <h2>Всё начинается с идеи.<br/><span>Мы помогаем воплотить её.</span></h2>
    <div className="pk-home-feature-grid">
     <article className="pk-home-feature"><span className="pk-feature-icon"><Zap size={23}/></span><h3>Начать легко</h3><p>Загружайте свои видео и фотографии, собирайте клипы на таймлайне и сразу смотрите результат.</p><span className="pk-feature-state"><span/> Уже доступно</span></article>
     <article className="pk-home-feature"><span className="pk-feature-icon"><Layers size={23}/></span><h3>Контроль над кадром</h3><p>Обрезайте, делите и переставляйте фрагменты. Добавляйте текст и сохраняйте проекты в браузере.</p><span className="pk-feature-state"><span/> Уже доступно</span></article>
     <article className="pk-home-feature"><span className="pk-feature-icon"><WandSparkles size={23}/></span><h3>ИИ как соавтор</h3><p>Наша большая цель: ИИ, который анализирует сцены, предлагает удачные моменты и помогает довести видео до нужного настроения.</p><span className="pk-feature-state pk-feature-planned"><span/> В разработке</span></article>
    </div>
   </section>
   <section id="pk-ai-vision" className="pk-home-ai">
    <div className="pk-ai-copy"><div className="pk-ai-badge"><WandSparkles size={16}/> НАШЕ ВИДЕНИЕ</div><h2>Монтажёр, который<br/>понимает <em>вашу историю.</em></h2><p>Мы хотим создать один из лучших ИИ-видеоредакторов: не просто набор эффектов, а помощника, который понимает сюжет, ритм, стиль и ваши пожелания. Эти возможности ещё предстоит реализовать и проверить на практике.</p><button type="button" onClick={onNewProject}>Создать первый проект <ArrowRight size={17}/></button></div>
    <div className="pk-ai-checklist"><div className="pk-ai-list-heading">Что мы планируем для ИИ</div><div><WandSparkles size={18}/><span><strong>Умный выбор кадров</strong><small>Находить лучшие моменты в видео</small></span><b>ПЛАН</b></div><div><Zap size={18}/><span><strong>Монтаж по описанию</strong><small>Собирать ролик по вашим словам</small></span><b>ПЛАН</b></div><div><Film size={18}/><span><strong>Автосубтитры и звук</strong><small>Работа с речью, музыкой и ритмом</small></span><b>ПЛАН</b></div></div>
   </section>
   {projects.length>0&&<section className="pk-home-recent"><div className="pk-recent-title"><div><div className="pk-home-section-label">ВАШИ ПРОЕКТЫ</div><h2>Продолжим с того кадра?</h2></div><button onClick={onContinue}>Открыть монтажёр <ArrowRight size={16}/></button></div><div className="pk-recent-list">{projects.slice(0,3).map(p=><button key={p.id} onClick={()=>onOpenProject(p)} className="pk-recent-item"><span><Film size={20}/></span><span><strong>{p.name||"Без названия"}</strong><small>{p.clips.length} клипов · сохранён {new Date(p.modified).toLocaleDateString("ru-RU")}</small></span><ArrowRight size={19}/></button>)}</div></section>}
   <footer className="pk-home-footer"><strong>ПОКАДРОВО</strong><span>Создаём видеоредактор, который растёт вместе с вашими идеями.</span><span>Веб-версия · ранняя стадия</span></footer>
  </div>
 </div>
}
