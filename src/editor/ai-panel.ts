import { clone } from './model';
import { download } from './assets';
import { AiPlan, AiRequest, createAiRequest, validateAiPlan, applyAiPlan } from './ai';
import type { ToolPort } from './tool-port';

const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const examples=[
 'Ускорь выбранный клип до 1.5× и уменьши его звук до 40%.',
 'Собери вертикальный ролик. Добавь короткий заголовок в начале.',
 'Удали лишний фрагмент и оставь текст в финальном кадре.'
];
const names:Record<string,string>={remove:'Удалить фрагмент',split:'Разделить клип',trim:'Обрезать клип',
 speed:'Изменить скорость',volume:'Настроить звук',transform:'Изменить изображение',caption:'Добавить текст',
 ratio:'Изменить формат',audioAt:'Переместить аудио',cutRange:'Вырезать диапазон'};
export class AiPanel {
  private node:HTMLElement;private input:HTMLTextAreaElement;private request:AiRequest|null=null;
  private plan:AiPlan|null=null;private abort:AbortController|null=null;private generation=0;
  private projectId:string;private previous:HTMLElement|null=null;private disposed=false;
  constructor(private port:ToolPort){
    this.projectId=port.project().id;
    this.node=document.createElement('aside');this.node.className='pe-ai-panel';this.node.hidden=true;
    this.node.ariaLabel='Задание для ИИ-монтажёра';
    this.node.innerHTML=`<header><div><span class="pe-ai-symbol">✦</span><strong>Покадрово AI<small>Ваш замысел. Ваш контроль.</small></strong></div><button type="button" data-ai="close" aria-label="Закрыть панель ИИ">×</button></header>
    <div class="pe-ai-scroll"><div class="pe-ai-connection"><i></i><span>${port.provider?'Подключён: '+esc(port.provider.name):'Нейросеть пока не подключена'}</span></div>
    <label for="pe-ai-prompt">Как смонтировать видео?</label><textarea id="pe-ai-prompt" maxlength="4000" rows="6" placeholder="Опишите задачу: какие кадры оставить, какой темп и настроение нужны…"></textarea>
    <div class="pe-ai-presets">${examples.map((s,i)=>`<button type="button" data-ai="example-${i}">${['Темп и звук','Вертикальный ролик','Убрать лишнее'][i]}</button>`).join('')}</div>
    <p class="pe-ai-context"></p><button type="button" class="pe-ai-submit" data-ai="request">✦ Смонтировать с помощью ИИ</button>
    <button type="button" class="pe-ai-cancel" data-ai="cancel" hidden>Отменить запрос</button>
    <p class="pe-ai-note">${port.provider?'Сервис получит задание и структуру проекта. Видео и аудиофайлы автоматически не отправляются.':'Кнопка станет доступна после подключения сервиса. Сейчас можно сохранить задание; автоматический монтаж не запускается.'}</p>
    <button type="button" class="pe-ai-save" data-ai="save">Сохранить задание в проекте</button>
    <div class="pe-ai-feedback" role="status"></div>
    <section class="pe-ai-plan"><h3>План монтажа</h3><p>Здесь появятся правки. Они применяются только после вашего подтверждения.</p></section>
    <details class="pe-ai-dev"><summary>Подготовка подключения</summary><p>Для разработки интеграции: выгрузите запрос, затем загрузите ответ по протоколу Pokadrovo Edit Plan v1.</p><button type="button" data-ai="download">Скачать JSON-запрос</button><button type="button" data-ai="import">Загрузить JSON-план</button><input type="file" accept=".json,application/json" class="pe-ai-plan-file" hidden/></details>
    </div>`;
    this.input=this.node.querySelector('textarea')!;
    this.readDraft();
    this.input.addEventListener('input',this.draft);
    this.node.addEventListener('click',this.click);
    this.node.addEventListener('keydown',this.key);
    this.node.querySelector('input')!.addEventListener('change',this.importFile);
    port.root.append(this.node);this.refresh();
  }
  get open(){return !this.node.hidden;}
  show(){this.previous=document.activeElement as HTMLElement;this.node.hidden=false;this.refresh();this.input.focus({preventScroll:true});}
  close(){this.saveBrief();this.node.hidden=true;this.previous?.isConnected&&this.previous.focus({preventScroll:true});}
  private say(s:string,error=false){const n=this.node.querySelector<HTMLElement>('.pe-ai-feedback')!;n.textContent=s;n.classList.toggle('error',error);}
  private readDraft(){
    this.input.value=this.port.project().brief;
    try{const saved=localStorage.getItem('pokadrovo.ai.draft.'+this.projectId);if(saved!==null)this.input.value=saved.slice(0,4000);}catch{}
  }
  private draft=()=>{try{localStorage.setItem('pokadrovo.ai.draft.'+this.projectId,this.input.value);}catch{}};
  saveBrief(){
    if(this.port.busy())return;
    const brief=this.input.value.slice(0,4000);
    if(brief!==this.port.project().brief){const p=clone(this.port.project());p.brief=brief;this.port.commit(p,'Задание сохранено в проекте.');}
    this.draft();
  }
  refresh(){
    if(this.port.project().id!==this.projectId){
      this.abort?.abort();this.generation++;this.abort=null;this.request=null;this.plan=null;
      this.projectId=this.port.project().id;this.readDraft();this.renderPlan();
    }
    const p=this.port.project(),selected=this.port.selected();
    this.node.querySelector('.pe-ai-context')!.textContent=`${p.clips.length} видео/фото · ${p.audio.length} аудио · ${p.ratio}${selected?' · клип выбран':''}`;
    (this.node.querySelector('[data-ai="request"]') as HTMLButtonElement).disabled=!this.port.provider||!!this.abort||this.port.busy();
    (this.node.querySelector('[data-ai="import"]') as HTMLButtonElement).disabled=!this.request||!!this.abort;
    this.node.querySelector<HTMLElement>('[data-ai="cancel"]')!.hidden=!this.abort;
  }
  private click=(e:Event)=>{
    const action=(e.target as HTMLElement).closest<HTMLElement>('[data-ai]')?.dataset.ai;if(!action)return;
    e.stopPropagation();
    if(action==='close'){this.close();return;}
    if(action.startsWith('example-')){this.input.value=examples[Number(action.slice(8))];this.draft();this.input.focus();return;}
    if(action==='save'){this.saveBrief();this.say('Задание сохранено. Нейросеть не запускалась.');return;}
    if(action==='request'){void this.send();return;}
    if(action==='cancel'){this.cancel();return;}
    if(action==='download'){void this.downloadRequest();return;}
    if(action==='import'){this.node.querySelector<HTMLInputElement>('.pe-ai-plan-file')!.click();return;}
    if(action==='reject'){this.plan=null;this.renderPlan();this.say('План отклонён. Монтаж не изменён.');return;}
    if(action==='apply'){void this.apply();}
  };
  private key=(e:KeyboardEvent)=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(this.abort)this.cancel();else this.close();}
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.stopPropagation();void this.send();}
  };
  private cancel(){this.abort?.abort();this.generation++;this.abort=null;this.say('Запрос отменён. Проект не изменён.');this.refresh();}
  private async build(){
    if(this.port.busy())throw Error('Дождитесь загрузки файлов или завершения экспорта.');
    this.saveBrief();
    const request=await createAiRequest(this.port.project(),this.input.value,this.port.cursor(),this.port.selected());
    this.request=request;this.plan=null;this.renderPlan();this.refresh();return request;
  }
  private async send(){
    if(!this.port.provider){this.saveBrief();this.say('Нейросеть не подключена. Задание сохранено.',true);return;}
    if(this.abort)return;
    const gen=++this.generation;
    try{
      const request=await this.build();if(this.disposed||gen!==this.generation)return;
      this.abort=new AbortController();this.refresh();this.say('Ожидаем план от сервиса…');
      const raw=await this.port.provider.createPlan(request,this.abort.signal);
      if(this.disposed||gen!==this.generation)return;
      this.plan=validateAiPlan(raw,request);this.renderPlan();this.say('Проверьте план перед применением.');
    }catch(e){if(!this.disposed&&gen===this.generation)this.say(e instanceof Error?e.message:String(e),true);}
    finally{if(!this.disposed&&gen===this.generation){this.abort=null;this.refresh();}}
  }
  private async downloadRequest(){
    try{const request=await this.build();if(this.disposed)return;download(new Blob([JSON.stringify(request,null,2)],{type:'application/json'}),'pokadrovo-ai-request.json');this.say('Запрос скачан. Это не результат работы ИИ.');}
    catch(e){this.say(e instanceof Error?e.message:String(e),true);}
  }
  private importFile=(e:Event)=>{
    const input=e.target as HTMLInputElement,f=input.files?.[0];input.value='';if(!f)return;
    void this.acceptFile(f);
  };
  async acceptFile(file:File){
    this.plan=null;this.renderPlan();
    try{
      if(!this.request)throw Error('Сначала создайте JSON-запрос для этой версии проекта.');
      if(file.size>512000)throw Error('План не должен превышать 512 КБ.');
      const request=this.request,raw=JSON.parse(await file.text());
      if(this.disposed||this.request!==request)return;
      this.plan=validateAiPlan(raw,request);this.renderPlan();this.say('План загружен из файла. Проверьте изменения.');
    }catch(e){this.say(e instanceof Error?e.message:String(e),true);}
  }
  private renderPlan(){
    const node=this.node.querySelector('.pe-ai-plan')!;
    if(!this.plan){node.innerHTML='<h3>План монтажа</h3><p>Здесь появятся правки. Они применяются только после вашего подтверждения.</p>';return;}
    node.innerHTML=`<h3>План: ${this.plan.operations.length} действий</h3><p>${esc(this.plan.summary)}</p><ol>${this.plan.operations.map(o=>`<li><strong>${esc(names[o.type])}</strong><small>${esc('id' in o?o.id:'value' in o?o.value:o.type==='caption'?o.text:'На таймлайне')}</small></li>`).join('')}</ol><div><button type="button" data-ai="apply">Применить план</button><button type="button" data-ai="reject">Отклонить</button></div><small>Все правки можно отменить одним действием.</small>`;
  }
  private async apply(){
    if(!this.request||!this.plan||this.port.busy())return;
    const current=this.port.project(),request=this.request,plan=this.plan;
    try{
      const next=await applyAiPlan(current,request,plan);
      // Check object identity as well: editing during async hashing must never overwrite a newer state.
      if(this.disposed||this.port.project()!==current||this.request!==request||this.port.busy())throw Error('Проект изменился. Создайте новый запрос.');
      this.port.select(null);this.port.commit(next,'План применён. Ctrl/Cmd+Z отменяет все правки.');
      this.plan=null;this.request=null;this.renderPlan();this.refresh();this.say('План применён. Отмена доступна в редакторе.');
    }catch(e){this.say(e instanceof Error?e.message:String(e),true);}
  }
  dispose(){
    this.disposed=true;this.generation++;this.abort?.abort();this.draft();
    this.input.removeEventListener('input',this.draft);this.node.removeEventListener('click',this.click);
    this.node.removeEventListener('keydown',this.key);this.node.querySelector('input')!.removeEventListener('change',this.importFile);
    this.node.remove();
  }
}
