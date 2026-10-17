import { useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, CirclePlay, Clapperboard, Command, Film, FolderOpen, Layers, Menu, Moon, Paperclip, Play, Scissors, Sparkles, Sun, WandSparkles, X } from "lucide-react";
import BrandMark from "./BrandMark";
import "./ai-home.css";

type RecentProject={id:string;name:string;count:number;modified:number};
type AiHomeProps={
 theme:"light"|"dark";
 onToggleTheme:()=>void;
 onCreate:(prompt:string)=>void;
 onContinue:()=>void;
 onImport:(files:FileList|null,prompt:string)=>void;
 onOpenProject:(id:string)=>void;
 projects:RecentProject[];
};

const scenarios=[
 {label:"Динамичный Reels",text:"Собери динамичный ролик на 30 секунд. Оставь лучшие моменты, убери паузы и предложи ритм монтажа.",tag:"30 СЕК"},
 {label:"Влог из поездки",text:"Помоги собрать атмосферный влог о путешествии: лучшие кадры, плавный темп и естественная история.",tag:"ВЛОГ"},
 {label:"Видео для YouTube",text:"Сделай монтаж видео для YouTube: выдели главное, предложи порядок сцен и места для субтитров.",tag:"YOUTUBE"}
];
const steps=[
 {n:"01",title:"Расскажите идею",description:"Опишите результат своими словами или выберите готовый пример.",icon:Command},
 {n:"02",title:"Добавьте материалы",description:"Загрузите свои видео и фотографии. Всё останется на устройстве.",icon:Paperclip},
 {n:"03",title:"Управляйте монтажом",description:"Собирайте ролик на таймлайне. В будущем ИИ возьмёт черновой монтаж на себя.",icon:Clapperboard}
];

export default function AiHome({theme,onToggleTheme,onCreate,onContinue,onImport,onOpenProject,projects}:AiHomeProps){
 const [prompt,setPrompt]=useState("");
 const [stage,setStage]=useState(1);
 const [mobileMenu,setMobileMenu]=useState(false);
 const inputRef=useRef<HTMLInputElement>(null);
 const ready=prompt.trim().length>0;
 const create=()=>onCreate(prompt.trim());
 return <div className="ah" data-theme={theme}>
   <header className="ah-header">
     <div className="ah-header-inner">
       <button className="ah-brand" type="button" title="Покадрово: главное меню" onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}><BrandMark size={39}/><span>покадрово<small>AI VIDEO STUDIO</small></span></button>
       <nav className={"ah-nav "+(mobileMenu?"ah-nav-open":"")} aria-label="Меню">
         <a href="#ah-how" onClick={()=>setMobileMenu(false)}>Как это работает</a>
         <a href="#ah-tools" onClick={()=>setMobileMenu(false)}>Возможности</a>
         <a href="#ah-future" onClick={()=>setMobileMenu(false)}>Наше видение</a>
       </nav>
       <div className="ah-header-actions">
         <button className="ah-theme" title={theme==="light"?"Включить тёмную тему":"Включить светлую тему"} aria-label={theme==="light"?"Включить тёмную тему":"Включить светлую тему"} onClick={onToggleTheme}>{theme==="light"?<Moon size={18}/>:<Sun size={18}/>}</button>
         <button className="ah-top-cta" onClick={onContinue}>Монтажёр <ArrowUpRight size={17}/></button>
         <button className="ah-menu-button" onClick={()=>setMobileMenu(v=>!v)} aria-label="Открыть меню">{mobileMenu?<X size={21}/>:<Menu size={21}/>}</button>
       </div>
     </div>
   </header>
   <main>
    <section className="ah-hero">
      <div className="ah-hero-grid"/>
      <div className="ah-orb ah-orb-one"/>
      <div className="ah-orb ah-orb-two"/>
      <div className="ah-hero-content">
        <div className="ah-hero-left">
          <div className="ah-brow"><span className="ah-brow-pulse"/> НОВЫЙ ВЗГЛЯД НА ВИДЕОМОНТАЖ <span className="ah-brow-v">ALPHA</span></div>
          <h1>Идея — ваша.<br/><span>Каждый кадр</span><br/>под контролем.</h1>
          <p className="ah-hero-lead">Мы строим ИИ, который будет понимать видео и монтировать по вашим словам. А уже сегодня у вас есть редактор, где можно собрать свою историю вручную.</p>
          <div className="ah-stats"><span><Check size={15}/> Веб-редактор работает</span><span><Sparkles size={15}/> ИИ развивается</span></div>
          <div className="ah-hero-actions"><button className="ah-hero-main" onClick={create}>Создать проект <ArrowRight size={18}/></button><button className="ah-hero-outline" onClick={()=>document.getElementById("ah-how")?.scrollIntoView({behavior:"smooth"})}><CirclePlay size={18}/> Узнать больше</button></div>
          <div className="ah-hero-mini"><div className="ah-avatar-stack"><i/><i/><i/></div><p>Для тех, у кого есть идея,<br/>но нет времени на сложный монтаж.</p></div>
        </div>
        <div className="ah-hero-right">
          <div className="ah-editor-mock" aria-label="Интерактивная демонстрация рабочего пространства">
            <div className="ah-mock-chrome"><div className="ah-chrome-dots"><i/><i/><i/></div><span><BrandMark size={17}/> Покадрово / Мой проект</span><span>● ПРЕДПРОСМОТР</span></div>
            <div className="ah-mock-body">
              <div className="ah-mock-rail"><span><Clapperboard size={16}/></span><span><WandSparkles size={16}/></span><span><Layers size={16}/></span></div>
              <div className={"ah-shot ah-shot-"+stage}>
                <div className="ah-shot-sky"><div className="ah-shot-sun"/></div>
                <div className="ah-shot-mountain ah-mountain-back"/>
                <div className="ah-shot-mountain ah-mountain-front"/>
                <div className="ah-shot-label"><span>НАШЛИ ИСТОРИЮ</span><strong>Moments worth keeping.</strong></div>
                <span className="ah-shot-play"><Play size={21} fill="currentColor"/></span>
                <span className="ah-shot-corner">4K / 24 FPS</span>
              </div>
            </div>
            <div className="ah-mock-footer"><span>00:12 <i>/</i> 00:30</span><span>▶ <i className="ah-transport-wave"/></span><span>16:9</span></div>
            <div className="ah-mock-timeline"><div className="ah-mock-ticks"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span></div><div className="ah-mock-clips"><span/><span/><span/><span/></div><div className="ah-mock-audio"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div><div className="ah-mock-head"/></div>
          </div>
          <div className="ah-floating-note ah-floating-ai"><div><WandSparkles size={20}/></div><span><strong>Покадрово AI</strong><small>Интеллектуальный монтаж — наша цель</small></span></div>
          <div className="ah-floating-note ah-floating-cut"><div><Scissors size={18}/></div><span><strong>Лучший момент</strong><small>00:08 — 00:12 · пример</small></span></div>
          <div className="ah-demo-toggle"><span>Пример процесса</span><div>{["Материалы","Анализ","Монтаж"].map((name,i)=><button key={i} aria-pressed={stage===i} className={stage===i?"selected":""} onClick={()=>setStage(i)}>{name}</button>)}</div></div>
        </div>
      </div>
      <div className="ah-hero-bottom"><span>ОДНА ИДЕЯ. ТЫСЯЧИ КАДРОВ.</span><span>ПРОКРУТИТЕ ВНИЗ <ChevronRight size={15}/></span></div>
    </section>

    <section className="ah-composer-zone" aria-label="Сформулировать идею монтажа">
      <div className="ah-composer-heading"><div className="ah-composer-badge"><WandSparkles size={17}/></div><div><h2>С чего начнём?</h2><p>Опишите идею. Сохраним её в проекте, пока мы разрабатываем ИИ-монтаж.</p></div></div>
      <div className="ah-composer">
        <label htmlFor="ah-idea">ВАШЕ ЗАДАНИЕ ДЛЯ МОНТАЖА</label>
        <textarea id="ah-idea" maxLength={1600} rows={3} value={prompt} placeholder="Например: собери стильный 30-секундный ролик для Reels, выбери лучшие моменты и добавь динамики..." onChange={e=>setPrompt(e.target.value)} />
        <div className="ah-composer-actions"><button className="ah-attach" type="button" onClick={()=>inputRef.current?.click()}><Paperclip size={16}/> Прикрепить видео</button><span>{prompt.length}/1600</span><button className="ah-send" onClick={create}>{ready?"Перейти с заданием":"Открыть редактор"} <ArrowRight size={17}/></button></div>
        <input ref={inputRef} type="file" multiple accept="video/*,image/*" hidden onChange={e=>{onImport(e.currentTarget.files,prompt.trim());e.currentTarget.value=""}} />
      </div>
      <div className="ah-scenario-row"><span>ПОПРОБУЙТЕ ПРИМЕР:</span>{scenarios.map(s=><button key={s.label} onClick={()=>{setPrompt(s.text);document.getElementById("ah-idea")?.focus()}}><span>{s.label}</span><ArrowUpRight size={13}/></button>)}</div>
      <div className="ah-composer-disclaimer"><Sparkles size={14}/> ИИ-обработка пока не подключена. Задания сохраняются как план, монтаж выполняется в редакторе.</div>
    </section>

    <section className="ah-process" id="ah-how">
      <div className="ah-section-head"><div className="ah-eyebrow">ПРОСТОЙ ПУТЬ К ВИДЕО</div><h2>От задумки до первого кадра<br/><em>без лишних действий.</em></h2><p>Мы проектируем всё вокруг одной задачи: превратить вашу идею в готовую историю.</p></div>
      <div className="ah-step-grid">{steps.map(item=><article className="ah-step" key={item.n}><div className="ah-step-top"><span>{item.n}</span><item.icon size={21}/></div><h3>{item.title}</h3><p>{item.description}</p><div className="ah-step-line"/></article>)}</div>
    </section>

    <section className="ah-showcase" id="ah-tools">
      <div className="ah-showcase-copy"><div className="ah-mini-label"><span/> УЖЕ СЕГОДНЯ</div><h2>Монтажная студия,<br/><em>которая всегда рядом.</em></h2><p>Импортируйте свои файлы, собирайте историю на таймлайне, обрезайте клипы, добавляйте текст и сохраняйте локальные проекты.</p><button onClick={onContinue}>Открыть монтажёр <ArrowRight size={17}/></button><div className="ah-showcase-small"><Check size={15}/> Ручной монтаж уже доступен</div></div>
      <div className="ah-showcase-art"><div className="ah-art-track"><div className="ah-art-clip"><div className="ah-art-scene"><i/><b/></div><span>Первая встреча</span></div><div className="ah-art-clip"><div className="ah-art-scene second"><i/><b/></div><span>Поворот сюжета</span></div><div className="ah-art-clip"><div className="ah-art-scene third"><i/><b/></div><span>Финальный кадр</span></div></div><div className="ah-art-cursor"/><div className="ah-art-tool"><Scissors size={16}/> 00:08.4 <strong>РАЗДЕЛЕНИЕ КЛИПА</strong></div></div>
    </section>

    <section className="ah-future" id="ah-future">
      <div className="ah-future-grid"><div className="ah-future-left"><div className="ah-future-label"><span>01 / СЛЕДУЮЩАЯ ГЛАВА</span><span><Sparkles size={15}/> НАША МИССИЯ</span></div><h2>ИИ не кнопка.<br/><em>ИИ — сам монтажёр.</em></h2><p>Мы создаём интеллект, который будет понимать видео, выбирать сильные моменты и выполнять изменения прямо на таймлайне. Встроенный редактор останется вашим инструментом контроля.</p><button onClick={()=>document.getElementById("ah-idea")?.scrollIntoView({behavior:"smooth"})}>Записать идею <ArrowRight size={17}/></button></div>
      <div className="ah-future-right"><div className="ah-future-panel-title"><WandSparkles size={19}/> Планируемые инструменты <span>ROADMAP</span></div>{["Монтаж по текстовому запросу","Умный поиск лучших моментов","Автосубтитры и очистка речи","Монтаж под ритм музыки"].map((v,i)=><div className="ah-roadmap-item" key={v}><span>0{i+1}</span><strong>{v}</strong><small>В ПЛАНАХ</small></div>)}</div></div>
    </section>

    {projects.length>0&&<section className="ah-recent"><header><div><span>ВАШИ ПРОЕКТЫ</span><h2>Продолжите с того кадра.</h2></div><button onClick={onContinue}>Все проекты <ArrowRight size={17}/></button></header><div className="ah-recent-grid">{projects.slice(0,3).map(p=><button key={p.id} onClick={()=>onOpenProject(p.id)}><span className="ah-recent-icon"><BrandMark size={33}/></span><span><strong>{p.name||"Без названия"}</strong><small>{p.count} клипов · {new Date(p.modified).toLocaleDateString("ru-RU")}</small></span><ArrowUpRight size={19}/></button>)}</div></section>}
    <section className="ah-end"><BrandMark size={43}/><h2>Создайте свою<br/>следующую историю.</h2><button onClick={()=>onCreate("")}>Начать монтаж <ArrowRight size={18}/></button></section>
   </main>
   <footer className="ah-footer"><div><BrandMark size={25}/><strong>покадрово</strong></div><p>ИИ, который учится монтировать вместе с вами.</p><span>WEB ALPHA · 2026</span></footer>
 </div>;
}
