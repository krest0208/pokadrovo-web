import * as React from 'react';
import { ArrowUpRight, AudioLines, Check, Coins, Film, Layers3, Moon, Sun, Text } from 'lucide-react';
import BrandMark from './BrandMark';
import './ai-plans.css';

const plans = [
  { id:'start', name:'Старт', label:'Знакомство с ИИ', power:'Базовая', depth:1, coins:1, unit:'за один разбор или план', status:'Пробный режим', model:'Gemma 4 26B A4B', detail:'Визуальный разбор через OpenRouter', context:'262 тыс. токенов', icon:Film,
    description:'Когда нужно быстро разобраться в кадрах и найти отправную точку для монтажа.',
    features:['Содержание кадра и заметные события', 'Советы по последовательности сцен', 'План правок по вашему заданию'],
    limitation:'Бесплатный визуальный разбор не распознаёт речь и звуковую дорожку.' },
  { id:'yandex', name:'Сценарист', label:'Яндекс · текстовый план', power:'Расширенная · текст', depth:2, coins:3, unit:'за один план монтажа', status:'Тест владельца · тариф готовится', model:'YandexGPT 5.1 Pro', detail:'Yandex AI Studio · план по описанию проекта', context:'32 768 токенов', icon:Text,
    description:'Когда важны структура рассказа, понятные русские формулировки и точное следование вашему заданию.',
    features:['План по брифу и текущему таймлайну', 'Работа с результатами предыдущего разбора', 'Предложения по сценам и текстам титров'],
    limitation:'В этом режиме исходные видео и звук в Яндекс не отправляются. Интеграция подготовлена для теста владельца. Платный доступ для пользователей ещё не открыт.' },
  { id:'author', name:'Автор', label:'Кадры + звук', power:'Расширенная', depth:2, coins:5, unit:'за один разбор или план', status:'Готовим запуск', model:'Qwen3.8-Omni-Flash', detail:'Видео, звук и текст в одной модели', context:'1 млн токенов', icon:AudioLines,
    description:'Для разговорных роликов, обзоров и историй, в которых важно услышать происходящее.',
    features:['Совместный разбор видео и звука', 'Учет речи и событий при подготовке советов', 'Предложения по акцентам и титрам'],
    limitation:'Платный уровень ещё не открыт. Возможности проверим на реальных исходниках перед запуском.' },
  { id:'studio', name:'Студия', label:'Подробная работа с историей', power:'Максимальная в линейке', depth:3, coins:15, unit:'за разбор + подробный план', status:'В разработке', model:'Qwen3.8-Omni-Flash + Qwen3.8-Max', detail:'Omni разбирает материал, Max собирает план', context:'До 1 млн токенов на модель', icon:Layers3,
    description:'Для задач с подробным брифом, несколькими смысловыми акцентами и точными требованиями к истории.',
    features:['Всё, что запланировано в «Авторе»', 'Отдельный этап проработки структуры', 'Подробный план по сценам и титрам'],
    limitation:'Связка моделей ещё не подключена. Это проект тарифа, а не доступная сейчас услуга.' }
];

const comparison = [
  ['Основная задача','Разобрать кадры','Составить текстовый план с Яндексом','Понять кадры и звук','Продумать структуру истории'],
  ['Модель анализа','Gemma 4 26B A4B','Использует предыдущий разбор','Qwen3.8-Omni-Flash','Qwen3.8-Omni-Flash'],
  ['Работа с речью и звуком','Нет в бесплатном разборе','Без прямой обработки медиа','Запланирована','Запланирована через Omni'],
  ['План монтажа','По заданию и проекту','YandexGPT 5.1 Pro по брифу, таймлайну и предыдущему разбору','С учетом разбора материала','Отдельный этап с Qwen3.8-Max'],
  ['Предварительная цена','1 монета / действие','3 монеты / план','5 монет / действие','15 монет / разбор и план'],
  ['Доступность','При подключенном пробном ИИ','Тест владельца после настройки Яндекса','Готовим запуск','В разработке']
];

type Props={theme:'light'|'dark';onTheme:()=>void;onHome:()=>void;onStart:()=>void};
export default function AiPlans({theme,onTheme,onHome,onStart}:Props){
  React.useEffect(()=>{const previous=document.title;document.title='Тарифы — мощность — нейросети | Покадрово';return()=>{document.title=previous;};},[]);
  return <div className="pk-plans" data-theme={theme}>
    <a className="pk-plans-skip" href="#plans-main">К тарифам</a>
    <header className="pk-plans-header">
      <a href="/" className="pk-plans-brand" onClick={event=>{event.preventDefault();onHome();}}><BrandMark size={40}/><span>покадрово</span></a>
      <nav aria-label="Навигация по тарифам"><a href="#ai-levels">Уровни ИИ</a><a href="#ai-compare">Сравнить</a><a href="#ai-coins">Монеты</a></nav>
      <button type="button" className="pk-plans-theme" onClick={onTheme} aria-label={theme==='light'?'Включить тёмную тему':'Включить светлую тему'}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button>
    </header>
    <main id="plans-main">
      <section className="pk-plans-hero">
        <span className="pk-plans-eyebrow">Тарифы — мощность — нейросети</span>
        <h1>Вашей истории —<br/><em>своя мощность.</em></h1>
        <p>От первого разбора кадров до подробного плана монтажа. Выбирайте глубину работы ИИ под свою задачу.</p>
        <a className="pk-plans-link" href="#ai-levels">Посмотреть уровни <ArrowUpRight size={18}/></a>
        <div className="pk-plans-draft"><Coins size={20}/><p><strong>Предварительные тарифы.</strong> Цены указаны в монетах. Платные уровни и покупка монет пока не открыты; курс к рублю объявим перед запуском оплаты.</p></div>
      </section>
      <section id="ai-levels" className="pk-plans-levels" aria-label="Тарифы и возможности нейросетей">
        {plans.map(plan=>{const Icon=plan.icon;return <article key={plan.id} className={'pk-plan-card pk-plan-'+plan.id}>
          <div className="pk-plan-card-top"><span>{plan.label}</span><Icon size={25}/></div>
          <h2>{plan.name}</h2><p className="pk-plan-description">{plan.description}</p>
          <div className="pk-plan-price"><Coins size={26}/><strong>{plan.coins}</strong><span>{plan.coins===1?'монета':plan.coins<5?'монеты':'монет'}</span></div><p className="pk-plan-unit">{plan.unit}</p>
          <div className="pk-plan-power"><div><span>Мощность</span><strong>{plan.power}</strong></div><div className="pk-plan-meter" aria-hidden="true">{[0,1,2].map(n=><i key={n} className={n<plan.depth?'is-on':''}/>)}</div></div>
          <div className="pk-plan-model"><span>Нейросеть</span><h3>{plan.model}</h3><p>{plan.detail}</p><small>Контекст модели: {plan.context}</small></div>
          <ul>{plan.features.map(feature=><li key={feature}><Check size={17}/><span>{feature}</span></li>)}</ul>
          <p className="pk-plan-limit">{plan.limitation}</p><span className="pk-plan-status">{plan.status}</span>
        </article>;})}
      </section>
      <section id="ai-compare" className="pk-plans-comparison" aria-labelledby="ai-compare-title">
        <span className="pk-plans-eyebrow">Разница по делу</span><h2 id="ai-compare-title">Что меняется с уровнем</h2>
        <p>Мощность здесь — глубина рабочего процесса. Это не оценка качества в процентах: результат зависит от исходника и задания.</p>
        <div className="pk-plans-table-wrap" tabIndex={0} role="region" aria-label="Сравнение тарифов, таблицу можно прокрутить"><table><caption>Возможности и предварительная стоимость уровней ИИ</caption><thead><tr><th scope="col">Возможность</th>{plans.map(plan=><th key={plan.id} scope="col">{plan.name}</th>)}</tr></thead><tbody>{comparison.map(([name,...values])=><tr key={name}><th scope="row">{name}</th>{values.map((value,index)=><td key={index}>{value}</td>)}</tr>)}</tbody></table></div>
        <div className="pk-plans-context"><Film size={24}/><p><strong>Сейчас в пробе: исходник до 60 секунд и 12 МиБ.</strong> Большое окно контекста у модели не увеличивает лимиты загрузки сайта. Длинные видео, автоматические субтитры по таймкодам и поиск музыки пока не входят в эти тарифы.</p></div>
      </section>
      <section id="ai-coins" className="pk-plans-coins" aria-labelledby="ai-coins-title"><div><span className="pk-plans-eyebrow">Один баланс</span><h2 id="ai-coins-title">Платите за работу ИИ.<br/><em>Монтируйте в своём ритме.</em></h2><p>Монеты Покадрово — единицы оплаты действий в студии. Токены модели — внутренний способ расчёта провайдера; это разные вещи.</p></div><div className="pk-plans-rules">
        <div><span>01</span><p><strong>Понятная единица</strong>Разбор исходника и создание плана — два отдельных действия. В «Студии» предлагаем объединить их в один запуск за 15 монет.</p></div>
        <div><span>02</span><p><strong>Подарок на знакомство</strong>В пробном режиме — 3 монеты, один проект и 7 дней с первого запуска. Доступ зависит от подключения и лимитов ИИ-сервиса.</p></div>
        <div><span>03</span><p><strong>Сначала план, затем правки</strong>ИИ предлагает изменения, вы решаете, какие применить. Работа вручную с таймлайном не расходует ИИ-монеты.</p></div>
      </div></section>
      <section className="pk-plans-faq" aria-label="Вопросы о тарифах">
        <details><summary>Какая нейросеть будет создавать план в «Старте»?</summary><p>Gemma указана для визуального анализа. План правок создаёт бесплатная текстовая модель, выбранная в настройках студии. Её доступность проверяется отдельно: у бесплатных сервисов есть ограничения.</p></details>
        <details><summary>Что умеет Яндекс в «Сценаристе»?</summary><p>YandexGPT 5.1 Pro получает описание проекта, параметры таймлайна и, если он есть, предыдущий разбор исходника. На этой основе предлагает план монтажа и тексты титров. Самостоятельно смотреть видео или слушать звук в текущей интеграции он не может. Распознавание речи через SpeechKit — отдельная возможность, которая пока не подключена.</p><p>Тест владельца не расходует монеты Покадрово, но запросы к API Яндекса оплачиваются с баланса Yandex Cloud. Для обычных пользователей тариф ещё закрыт; 3 монеты за план — предварительное предложение.</p></details>
        <details><summary>Можно уже купить «Автора» или «Студию»?</summary><p>Пока нет. Здесь представлен проект линейки. Qwen Omni подготовлен в интеграции, но платный доступ пользователям не открыт. Связку Omni с Max предстоит реализовать и проверить. Эти цены не меняют текущие списания в студии.</p></details>
        <details><summary>Чем более дорогой уровень лучше?</summary><p>«Автор» добавляет работу со звуком, «Студия» — отдельную модель для проработки плана. Мы проверим пользу на одинаковых исходниках перед запуском. Более дорогой запрос сам по себе не гарантирует удачный монтаж.</p></details>
        <details><summary>Откуда взяты характеристики моделей?</summary><p>Из документации провайдеров, проверенной 22 октября 2026 года. Это возможности самих моделей; доступные действия Покадрово описаны отдельно выше.</p><div className="pk-plans-sources"><a href="https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/generation/models" target="_blank" rel="noopener noreferrer">YandexGPT 5.1 Pro ↗</a><a href="https://openrouter.ai/google/gemma-4-26b-a4b-it:free" target="_blank" rel="noopener noreferrer">Gemma 4 ↗</a><a href="https://www.alibabacloud.com/help/en/model-studio/qwen3-8-omni-flash" target="_blank" rel="noopener noreferrer">Qwen Omni ↗</a><a href="https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max" target="_blank" rel="noopener noreferrer">Qwen Max ↗</a></div></details>
      </section>
      <section className="pk-plans-cta"><div><span className="pk-plans-eyebrow">Начните с материала</span><h2>Есть кадры?<br/>Откройте студию.</h2></div><button type="button" onClick={onStart}>Открыть студию <ArrowUpRight size={22}/></button></section>
    </main>
    <footer className="pk-plans-footer"><a href="/" onClick={event=>{event.preventDefault();onHome();}}>← На главную</a><span>© {new Date().getFullYear()} Покадрово</span><a href="#plans-main">Тарифы — мощность — нейросети ↑</a></footer>
  </div>;
}
