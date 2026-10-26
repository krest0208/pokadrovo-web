import React,{useEffect,useRef} from 'react';
import adminHtml from '../../server/public/admin.html?raw';
import adminCss from '../../server/public/admin.css?raw';
import {loadProjects,download} from './assets';
import {previewStorage,events,record} from './storage';
import {clock,totalLength} from '../editor/model';

const names:Record<string,string>={site_view:'Открытие главной',editor_open:'Открытие монтажёра',project_saved:'Сохранение проекта',export_completed:'Подготовка видео к скачиванию',ai_request:'Задание для ИИ',settings_saved:'Сохранение параметров ИИ'};
export function AdminPreview({onOpen,onHome,initialView='overview'}:{onOpen:(id:string)=>void;onHome:()=>void;initialView?:'overview'|'api'}){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const shadow=host.current!.shadowRoot||host.current!.attachShadow({mode:'open'});
    const style=document.createElement('style');
    style.textContent=adminCss.replace(/:root/g,':host').replace(/100dvh/g,'760px')+'\n:host{display:block;background:#f4f7fc}.app{min-height:760px}.sidebar{position:relative;top:auto;height:auto;min-height:760px}.main{align-self:start;margin:0}.chart{height:auto;min-height:180px;padding:18px 0}.local-chart{width:100%;display:grid;gap:12px}.local-chart-row{display:grid;grid-template-columns:80px 1fr 44px;gap:10px;align-items:center;font-size:11px}.local-bar{height:8px;background:#e8effa;border-radius:4px;overflow:hidden}.local-bar i{height:100%;display:block;background:#326deb}.preview-links{display:flex;flex-wrap:wrap;gap:10px}.table-wrap{overflow:auto}.top-right{flex-wrap:wrap}.main-footer{gap:10px}@media(max-width:900px){.sidebar{min-height:0}.main{margin:0}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}';
    const parsed=new DOMParser().parseFromString(adminHtml,'text/html');
    for(const selector of ['#login-screen','#oauth-view','#logout','[data-view="oauth"]','[data-view="billing"]','#billing-view'])parsed.querySelector(selector)?.remove();
    for(const id of ['openrouter-form','yandex-form','ai-capacity'])parsed.getElementById(id)?.closest('article')?.remove();
    const shell=document.createElement('div');shell.className='admin-body';
    for(const node of Array.from(parsed.body.childNodes))shell.append(document.importNode(node,true));
    shell.querySelectorAll('script').forEach(n=>n.remove());
    const q=<T extends HTMLElement=HTMLElement>(selector:string)=>shell.querySelector<T>(selector)!;
    const text=(selector:string,value:string)=>{const node=shell.querySelector(selector);if(node)node.textContent=value;};
    const el=(tag:string,cls='',value='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=value;return node;};
    q('#app').hidden=false;
    text('.secure-badge','Предпросмотр');text('#owner-name','Администратор');
    text('.owner-card small','Локальная версия');text('.sidebar-note strong','Проекты в этом браузере');text('.sidebar-note p','Регистрация и серверный вход отключены для предпросмотра.');
    text('.top-right a','Открыть сайт');
    text('[data-view="users"]','Проекты');text('[data-view="security"]','Хранение');text('[data-view="audit"]','Журнал действий');
    text('#users-view h2','Проекты студии');text('#users-view .muted','Проекты, созданные в этом предпросмотре.');
    text('#users-view .subtle-note','Исходные видео и музыка остаются на вашем устройстве.');
    q<HTMLInputElement>('#users-query').placeholder='Поиск по названию проекта';
    q('#users-prev').remove();q('#users-next').remove();q('#users-page').remove();
    q('#users-view thead tr').replaceChildren(...['Проект','Формат','Клипы','Длительность','Изменён',''].map(v=>el('th','',v)));
    text('#api-view .muted','Qwen3.8-Omni-Flash. В автономном режиме ИИ недоступен.');text('#key-status','Ключ не добавлен');
    const form=q<HTMLFormElement>('#settings-form');
    for(const name of ['password','removeKey'])form.querySelector(`[name="${name}"]`)?.closest('label')?.remove();
    q('#ai-extra-settings').remove();
    const key=form.elements.namedItem('apiKey') as HTMLInputElement;key.disabled=true;key.value='';key.placeholder='Доступно после запуска сервера';key.removeAttribute('name');
    text('#settings-key-note','Настоящий API-ключ добавляется в серверной версии. В этом окне его ввод отключён.');
    text('#settings-form button[type="submit"]','Сохранить выбор');
    const explanation=q('#api-view .explanation');explanation.replaceChildren(el('h3','','ИИ недоступен в автономном режиме'),el('p','','На рабочем сайте используется Qwen. API-ключ здесь не вводится; запросы к нейросети не выполняются.'));
    const provider=form.elements.namedItem('provider') as HTMLSelectElement,model=form.elements.namedItem('model') as HTMLInputElement;
    for(const option of Array.from(provider.options)){option.hidden=option.value!=='qwen';option.disabled=option.value!=='qwen';}provider.value='qwen';model.value='qwen3.8-omni-flash';model.readOnly=true;
    const note=()=>{text('#ai-provider-note',provider.value==='custom'?'Укажите модель вашего провайдера. Для него потребуется отдельный серверный обработчик.':'Укажите идентификатор модели из API-кабинета '+provider.selectedOptions[0].textContent+'.');text('#settings-form .form-error','');};
    provider.addEventListener('change',note);model.addEventListener('input',()=>text('#settings-form .form-error',''));note();
    form.addEventListener('submit',event=>{event.preventDefault();const value=model.value.trim();if(!/^[\w./:-]{0,120}$/.test(value)){text('#settings-form .form-error','В идентификаторе модели допустимы латинские буквы, цифры, точка, дефис, подчёркивание, / и : без пробелов.');return;}previewStorage.setItem('ai',JSON.stringify({provider:provider.value,model:value}));model.value=value;record('settings_saved');text('#settings-form .form-error',previewStorage.durable?'Выбор сохранён в этом браузере. ИИ недоступен в автономном режиме.':'Выбор сохранён на время этого окна. ИИ недоступен в автономном режиме.');});
    const storage=q('#security-view');storage.replaceChildren(el('div','view-heading'));
    storage.firstElementChild!.append(el('h2','','Хранение проектов'));
    const storageCard=el('article','card explanation');storageCard.append(el('h3','',previewStorage.durable?'Сохранение в браузере':'Хранение в текущем окне'),el('p','','В этой версии нет аккаунтов и формы входа. Настройки монтажа и медиа хранятся отдельно от рабочего сайта.'),el('p','','Перед закрытием сохраните проекты в JSON. Файл JSON содержит монтаж и названия исходников; сами видео, музыку и изображения храните отдельно.'));
    const backup=el('button','primary','Скачать проекты JSON');backup.setAttribute('type','button');backup.addEventListener('click',()=>download(new Blob([JSON.stringify(loadProjects(),null,2)],{type:'application/json'}),'Pokadrovo-projects.json'));storageCard.append(backup);storage.append(storageCard);
    text('#audit-view h2','Журнал этого предпросмотра');text('#audit-view .muted','Последние локальные действия. Это не журнал рабочего сервера.');
    text('.chart-card h3','Открытия монтажёра');text('.chart-card .card-heading p','По дням · в этом окне');q('.chart-legend').remove();text('.chart-bottom span','Только локальные события предпросмотра');
    text('.lower-grid .card:first-child h3','Форматы проектов');text('.lower-grid .card:first-child .card-heading p','Текущая библиотека');
    const integrations=shell.querySelectorAll('.integration-row');
    const integrationLabels=[['Сайт и монтажёр','Доступны'],['Регистрация и вход','Убраны'],['Покупки и выручка','Не подключены'],['Нейросеть','Не подключена']];
    integrations.forEach((row,index)=>{row.replaceChildren(el('span','',integrationLabels[index][0]),el('b','',integrationLabels[index][1]));});
    text('.lower-grid .card:last-child .subtle-note','Это интерактивный предпросмотр. Сервер, домен и платежи не подключены.');
    text('#metric-notes','Здесь считаются только действия в этом окне. Эти показатели не являются посещаемостью опубликованного сайта.');text('.main-footer span:last-child','Предпросмотр · без публикации');
    let selected:string=initialView;
    const titles:Record<string,string>={overview:'Обзор и статистика',users:'Проекты',api:'Подключение нейросети',security:'Хранение',audit:'Журнал действий'};
    const renderProjects=()=>{
      const projects=loadProjects(),query=q<HTMLInputElement>('#users-query').value.toLocaleLowerCase();text('#users-count',`${projects.length} проектов`);
      q('#users-body').replaceChildren(...projects.filter(p=>p.name.toLocaleLowerCase().includes(query)).map(p=>{const row=el('tr');for(const value of [p.name,p.ratio,String(p.clips.length),clock(totalLength(p)),new Date(p.modified).toLocaleDateString('ru-RU')])row.append(el('td','',value));const cell=el('td'),button=el('button','secondary','Открыть');button.addEventListener('click',()=>onOpen(p.id));cell.append(button);row.append(cell);return row;}));
      if(!q('#users-body').children.length){const row=el('tr'),cell=el('td','',projects.length?'Проекты не найдены.':'Пока нет проектов. Откройте монтажёр и создайте первый.');cell.setAttribute('colspan','6');row.append(cell);q('#users-body').append(row);}
    };
    const render=()=>{
      const days=Number(q<HTMLSelectElement>('#period').value),from=Date.now()-days*86400000,log=events().filter(e=>e.at>=from),projects=loadProjects();
      const count=(kind:string)=>log.filter(e=>e.kind===kind).length;
      const cards=[['Открытия главной',count('site_view'),'В этом предпросмотре'],['Открытия монтажёра',count('editor_open'),'За выбранный период'],['Ваши проекты',projects.length,'В текущем браузере'],['Экспорты видео',count('export_completed'),'Подготовлены к скачиванию']];
      q('#metrics').replaceChildren(...cards.map(([label,value,note])=>{const card=el('article','metric');card.append(el('span','metric-label',String(label)),el('strong','metric-number',String(value)),el('span','metric-note',String(note)));return card;}));
      text('#period-note',`Локальная статистика · последние ${days} дней`);
      const rows=[['Открытия редактора',count('editor_open')],['Сохранения проектов',count('project_saved')],['Экспорты видео',count('export_completed')]] as const,max=Math.max(1,...rows.map(r=>r[1]));
      q('#pipeline').replaceChildren(...rows.map(([label,value])=>{const row=el('div','flow-row'),line=el('div'),bar=el('div','flow-track'),fill=el('i');line.append(el('span','',label),el('strong','',String(value)));fill.style.width=value/max*100+'%';bar.append(fill);row.append(line,bar);return row;}));
      q('#breakdowns').replaceChildren(...(['video','reels'] as const).map(mode=>{const row=el('div','breakdown-row');row.append(el('span','',mode==='video'?'Обычное видео':'Reels / Shorts'),el('strong','',String(projects.filter(p=>p.mode===mode).length)));return row;}));
      const daily=new Map<string,number>();for(const event of log.filter(e=>e.kind==='editor_open')){const day=new Date(event.at).toLocaleDateString('ru-RU');daily.set(day,(daily.get(day)||0)+1);}
      const chart=el('div','local-chart'),peak=Math.max(1,...daily.values());
      if(!daily.size)chart.append(el('p','muted','Откройте монтажёр. Здесь появится первое событие.'));
      for(const [day,value]of Array.from(daily).slice(-7)){const row=el('div','local-chart-row'),bar=el('span','local-bar'),fill=el('i');fill.style.width=value/peak*100+'%';bar.append(fill);row.append(el('span','',day),bar,el('strong','',String(value)));chart.append(row);}
      q('#chart').replaceChildren(chart);q('#chart-table').replaceChildren(...Array.from(daily).map(([day,value])=>el('p','',`${day}: ${value} открытий`)));
      q('#audit-body').replaceChildren(...events().slice(-100).reverse().map(event=>{const row=el('tr');for(const value of [new Date(event.at).toLocaleString('ru-RU'),names[event.kind]||event.kind,'Локально'])row.append(el('td','',value));return row;}));renderProjects();
    };
    shell.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.view!;shell.querySelectorAll<HTMLElement>('.view').forEach(view=>view.hidden=view.id!==selected+'-view');shell.querySelectorAll<HTMLElement>('[data-view]').forEach(b=>b.classList.toggle('active',b===button));text('#page-title',titles[selected]);render();}));
    for(const id of ['#refresh','#audit-refresh'])q(id).addEventListener('click',render);
    q('#period').addEventListener('change',render);q('#users-search').addEventListener('submit',e=>{e.preventDefault();renderProjects();});
    q('#show-table').addEventListener('click',()=>{q('#chart-table').hidden=!q('#chart-table').hidden;text('#show-table',q('#chart-table').hidden?'Показать таблицу':'Скрыть таблицу');});
    shell.querySelectorAll('a').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();onHome();}));
    shadow.replaceChildren(style,shell);q<HTMLButtonElement>(`[data-view="${selected}"]`).click();
    return()=>shadow.replaceChildren();
  },[onHome,onOpen,initialView]);
  return <div ref={host} className="pk-chat-admin" aria-label="Админ-панель предпросмотра"/>;
}
