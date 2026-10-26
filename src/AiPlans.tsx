import * as React from 'react';
import {Film,AudioLines,Check} from 'lucide-react';
import BrandMark from './BrandMark';
import ThemeToggle from './motion/ThemeToggle';
import './ai-plans.css';
type Props={balance?:React.ReactNode;theme:'light'|'dark';onTheme:()=>void;onHome:()=>void;onStart:()=>void};
export default function AiPlans({theme,onTheme,onHome,onStart}:Props){
 React.useEffect(()=>{const previous=document.title;document.title='Монтаж с ИИ | Покадрово';return()=>{document.title=previous;};},[]);
 return <div className="pk-plans" data-theme={theme}>
  <a className="pk-plans-skip" href="#plans-main">К содержимому</a>
  <header className="pk-plans-header"><a href="/" className="pk-plans-brand" onClick={e=>{e.preventDefault();onHome();}}><BrandMark size={40}/><span>покадрово</span></a><nav aria-label="Навигация по возможностям ИИ"><a href="#ai-workflow">Как это работает</a><a href="#ai-source">Исходники</a></nav><ThemeToggle className="pk-plans-theme" theme={theme} onToggle={onTheme}/></header>
  <main id="plans-main" tabIndex={-1}>
   <section className="pk-plans-hero"><span className="pk-plans-eyebrow">ПОКАДРОВО AI · QWEN</span><h1>От материала<br/><em>к понятному монтажу.</em></h1><p>Опишите идею, разберите выбранный исходник и получите план правок. Вы решаете, какие изменения войдут в ролик.</p><button className="pk-ai-primary" type="button" onClick={onStart}>Открыть студию</button></section>
   <section id="ai-workflow" className="pk-ai-workflow" aria-label="Три шага работы с ИИ">{[
    {Icon:Film,title:'Добавьте материал',text:'Загрузите видео в проект. Выберите исходник для разбора и подтвердите его передачу в Qwen.'},
    {Icon:AudioLines,title:'Задайте направление',text:'Опишите смысл, темп и нужные изменения. Qwen может разобрать изображение, речь и звуки выбранного файла.'},
    {Icon:Check,title:'Проверьте правки',text:'Посмотрите предложенный план и примените его в редакторе. Все изменения можно отменить одним действием.'}
   ].map(({Icon,title,text},i)=><article className="pk-plan-card" key={title}><div><Icon size={27} aria-hidden="true"/><span>0{i+1}</span></div><h2>{title}</h2><p>{text}</p></article>)}</section>
   <section id="ai-source" className="pk-ai-source"><div><span className="pk-plans-eyebrow">ВАШИ ИСХОДНИКИ</span><h2>Начните с короткой истории.</h2><p>Для разбора сейчас подходит отдельный MP4 до 60 секунд и 7 МБ. Поддерживаются короткие проекты 9:16 и 16:9.</p><p>Обрезка на таймлайне не уменьшает отправляемый файл. Доступность подключения и лимиты показаны в панели ИИ.</p></div><aside><h3>Вы контролируете результат</h3><p>План по описанию получает структуру проекта и предыдущий разбор. Для понимания самого видео нужно отдельно отправить исходник с согласием.</p><p>Таймкоды и распознанные слова проверяйте по записи. Правки применяются после вашего подтверждения.</p></aside></section>
   <section className="pk-plans-cta"><div><span className="pk-plans-eyebrow">ЕСТЬ КАДРЫ?</span><h2>Соберите свою историю.</h2></div><button type="button" onClick={onStart}>Начать монтаж</button></section>
  </main><footer className="pk-plans-footer"><a href="/" onClick={e=>{e.preventDefault();onHome();}}>На главную</a><span>Покадрово · Монтаж с ИИ</span><a href="/legal/privacy">Политика обработки данных</a></footer>
 </div>;
}
