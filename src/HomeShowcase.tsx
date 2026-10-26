import * as React from 'react';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
export {default as Coin} from './CoinMark';
import coast from './home/assets/coastal-story.webp';
import coffee from './home/assets/coffee-story.webp';
import city from './home/assets/city-story.webp';
import './home/showcase-motion.css';

export type StoryCollection='travel'|'coffee'|'city';
const stories:Record<StoryCollection,{asset:string;title:string;kicker:string;kind:string;descriptions:string[]}>= {
 travel:{asset:coast,title:'Выходные у моря',kicker:'НЕБОЛЬШОЕ ПУТЕШЕСТВИЕ',kind:'Фильм о поездке',descriptions:['Камера в руках путешественника','Дорога вдоль синего моря','Путешественница на смотровой площадке','Чашка кофе и карта у моря','Волны на прибрежных камнях','Прогулка по берегу на закате']},
 coffee:{asset:coffee,title:'Утро начинается здесь',kicker:'ИСТОРИЯ О ВКУСЕ',kind:'Вертикальный Reels',descriptions:['Бариста готовит фильтр для кофе','Синяя керамическая чашка свежего кофе','Бариста за стойкой кофейни','Кофейные зёрна на фактурной ткани','Горячая вода в кофейном фильтре','Кофе и выпечка в мягком свете окна']},
 city:{asset:city,title:'Город в моём ритме',kicker:'ПРОГУЛКА В СИНИЙ ЧАС',kind:'История для влога',descriptions:['Камера в руках автора городского влога','Городская улица и пешеходный мост вечером','Автор в синей куртке рассматривает архитектуру','Кеды на пешеходном переходе','Велосипед у бетонной стены','Прогулка по вечерней улице к кафе']}
};
const examples:StoryCollection[]=['travel','coffee','city'];
export function Shot({index=0,collection='travel',className='',children}:{index?:number;collection?:StoryCollection;className?:string;children?:React.ReactNode}){
 const frame=((Math.trunc(index)%6)+6)%6,story=stories[collection];
 return <div className={`pk-shot ${className}`} data-collection={collection}><svg className="pk-shot-image" viewBox={`${frame%3*512} ${Math.floor(frame/3)*512} 512 512`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={story.descriptions[frame]}><image href={story.asset} width="1536" height="1024"/></svg>{children}</div>;
}
export function Arrow(){return <svg viewBox="0 0 40 24" fill="none" aria-hidden="true"><path d="M2 12h34M26 2l10 10-10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
function Wave(){return <div className="pk-wave" aria-hidden="true">{Array.from({length:48},(_,i)=><i key={i} style={{height:`${12+(i*17%29)}px`}}/>)}</div>;}
export function Timeline({compact=false,collection='travel'}:{compact?:boolean;collection?:StoryCollection}){
 return <div className={`pk-timeline ${compact?'is-compact':''}`} role="img" aria-label={`Схема монтажа «${stories[collection].title}»: четыре фрагмента, звук и заголовок`}><div className="pk-time-ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span></div><div className="pk-title-track">{stories[collection].title}</div><div className="pk-video-track">{[1,0,2,5].map((n,i)=><Shot key={i} index={n} collection={collection}><span>{['Начало','Детали','Герой','Финал'][i]}</span></Shot>)}</div><Wave/><i className="pk-playhead"/></div>;
}
export function HeroStory({scene}:{scene:number}){
 const collection=examples[scene]||examples[0],example=stories[collection],reduced=useReducedMotion();
 return <div className="pk-hero-story" aria-label="Из снятых кадров в монтажную последовательность">
  <div className="pk-story-source"><span className="pk-art-label">Ваши кадры</span><div className="pk-source-pile"><Shot index={0} collection={collection}/><Shot index={3} collection={collection}/><Shot index={4} collection={collection}/></div><span className="pk-source-caption">Видео + фотографии</span></div>
  <span className="pk-story-arrow"><Arrow/></span>
  <AnimatePresence initial={false} mode="wait"><motion.div className="pk-story-result" key={collection} initial={{opacity:0,y:reduced?0:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:-6}} transition={{duration:reduced?0:.2,ease:'easeOut'}}><div className="pk-result-fan"><div className="pk-fan-card back"><Shot index={5} collection={collection}/></div><div className="pk-fan-card middle"><Shot index={2} collection={collection}/></div><div className="pk-fan-card front"><Shot index={1} collection={collection}><div className="pk-result-title"><span>{example.kicker}</span><strong>{example.title}</strong></div></Shot><div className="pk-result-bar"><span>{example.kind}</span></div></div></div><div className="pk-hero-timeline"><Timeline compact collection={collection}/></div></motion.div></AnimatePresence>
 </div>;
}
const steps=[
 {title:'Добавьте то, что сняли',text:'Видео с телефона, фотографии, звук. Соберите материалы в одном проекте.'},
 {title:'Расскажите, какой ролик нужен',text:'Задайте настроение, длительность и главную мысль. Пишите обычными словами.'},
 {title:'Разберите материал с ИИ',text:'ИИ разбирает выбранное видео, речь и звуки. Передача файла только с вашего согласия. Доступность указана в студии.'},
 {title:'Посмотрите предложенные правки',text:'ИИ предлагает план. Вы решаете, что применить, и сохраняете контроль над монтажом.'},
 {title:'Доведите до своего стиля',text:'Подрежьте кадры, настройте звук и добавьте титры. Любую правку можно отменить.'},
 {title:'Сохраните готовый ролик',text:'Выберите формат, проверьте результат и экспортируйте видео из студии.'}
];
function ProcessArt({step}:{step:number}){
 if(step===0)return <div className="pk-import-art"><div className="pk-art-toolbar"><span>Материалы проекта</span><b>+</b></div><div className="pk-media-grid">{[0,1,2,3,4,5].map(i=><Shot key={i} index={i} collection="travel"><span>{`Кадр ${i+1}`}</span></Shot>)}</div><div className="pk-file-tray">＋ Видео, фото и аудио</div></div>;
 if(step===1)return <div className="pk-brief-art"><div className="pk-chat-user">Собери короткий ролик для кофейни. Начни с деталей, покажи приготовление и готовую чашку.</div><div className="pk-brief-tags"><span>30 секунд</span><span>Живые детали</span><span>Звуки кофейни</span></div><div className="pk-brief-photo"><Shot index={4} collection="coffee"/><span>Ваша идея задаёт направление.</span></div></div>;
 if(step===2)return <div className="pk-analysis-art"><Shot index={2} collection="city"><span className="pk-analysis-frame"/></Shot><div className="pk-analysis-notes"><div><b>Картинка</b><span>Человек в городе</span></div><div><b>Детали</b><span>Архитектура, вечерний свет</span></div><div><b>Контекст</b><span>Городская прогулка</span></div></div></div>;
 if(step===3)return <div className="pk-plan-art"><div className="pk-art-toolbar"><span>Предложенный план</span><b>✦</b></div>{['Начать с крупного плана кофе','Показать процесс приготовления','Завершить готовой чашкой'].map((s,i)=><div className="pk-plan-row" key={s}><span>0{i+1}</span><strong>{s}</strong><b>✓</b></div>)}<div className="pk-plan-confirm">Применить правки</div></div>;
 if(step===4)return <div className="pk-edit-art"><div className="pk-edit-preview"><Shot index={1} collection="city"><strong>{stories.city.title}</strong></Shot><div><span>Громкость</span><b>70%</b><i/><span>Титр</span><b>В начале</b></div></div><Timeline collection="city"/></div>;
 return <div className="pk-export-art"><div className="pk-export-landscape"><Shot index={1} collection="coffee"><strong>Утро<br/>начинается здесь</strong></Shot><span>16:9</span></div><div className="pk-export-portrait"><Shot index={5} collection="coffee"><strong>Ваше утро.</strong></Shot><span>9:16</span></div><div className="pk-export-check">✓ Ваш ролик, ваш формат</div></div>;
}
export function ProcessGallery(){return <section id="pkh-method" className="pk-section pk-process" aria-labelledby="pk-process-title"><div className="pk-section-heading"><p className="pk-kicker">Как это работает</p><h2 id="pk-process-title">От снятых кадров<br/><span>к готовой истории.</span></h2><p>От папки с исходниками до ролика, который хочется показать.</p></div><div className="pk-process-grid">{steps.map((step,i)=><article className={`pk-process-card step-${i}`} key={step.title}><div className="pk-process-art" role="img" aria-label={`Шаг ${i+1}: ${step.title}`}><ProcessArt step={i}/></div><div className="pk-process-copy"><span>0{i+1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></div></article>)}</div></section>;}
