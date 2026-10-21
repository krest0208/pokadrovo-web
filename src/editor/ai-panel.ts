import { clone, clock, totalLength } from './model';
import { download } from './assets';
import { AiPlan, AiRequest, AiMedia, AiService, createAiRequest, validateAiPlan, applyAiPlan, simulateAiPlan } from './ai';
import type { MediaAnalysis, OmniResult } from './omni';
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
  private available:boolean;private statusGeneration=0;private connectionAbort=new AbortController();private requiresMedia=false;
  private mediaClipId='';private analysis:MediaAnalysis|null=null;
  constructor(private port:ToolPort){
    this.available=!!port.provider&&!port.provider.getStatus;
    this.projectId=port.project().id;
    this.node=document.createElement('aside');this.node.className='pe-ai-panel';this.node.hidden=true;
    this.node.ariaLabel='Задание для ИИ-монтажёра';
    this.node.innerHTML=`<header><div><span class="pe-ai-symbol">✦</span><strong>Покадрово AI<small>Ваш замысел. Ваш контроль.</small></strong></div><button type="button" data-ai="close" aria-label="Закрыть панель ИИ">×</button></header>
    <div class="pe-ai-scroll"><div class="pe-ai-connection"><i></i><span>${port.provider?(port.provider.getStatus?'Проверяем настройки ':'Подключён: ')+esc(port.provider.name):'Нейросеть пока не подключена'}</span></div>
    <label class="pe-ai-mode-label" ${port.provider?.modes?'':'hidden'}>Режим монтажа<select class="pe-ai-mode" aria-label="Режим монтажа">${port.provider?.modes?.map(m=>`<option value="${m.id}">${esc(m.label)}</option>`).join('')||''}</select></label><p class="pe-ai-mode-note pe-ai-note"></p>
    <label for="pe-ai-prompt">Как смонтировать видео?</label><textarea id="pe-ai-prompt" maxlength="4000" rows="6" placeholder="Опишите задачу: какие кадры оставить, какой темп и настроение нужны…"></textarea>
    <div class="pe-ai-presets">${examples.map((s,i)=>`<button type="button" data-ai="example-${i}">${['Темп и звук','Вертикальный ролик','Убрать лишнее'][i]}</button>`).join('')}</div>
    <p class="pe-ai-context"></p><button type="button" class="pe-ai-submit" data-ai="request">✦ Смонтировать с помощью ИИ</button>
    <section class="pe-ai-media" ${port.provider?.supportsMedia?'':'hidden'}><h3 class="pe-ai-media-title">Разобрать исходник</h3>
    <p class="pe-ai-media-description">MP4 до 60 секунд и 12 МБ. Анализируется весь выбранный файл.</p>
    <label>Исходник из проекта<select class="pe-ai-media-source" aria-label="Файл для анализа"></select></label>
    <label class="pe-ai-consent"><input type="checkbox" class="pe-ai-media-consent"/> <span class="pe-ai-consent-copy">Разрешаю отправить выбранный файл провайдеру для анализа.</span></label>
    <button type="button" class="pe-ai-submit" data-ai="analyze">Разобрать файл и предложить монтаж</button></section>
    <p class="pe-ai-note pe-ai-billing-note">Подарочный баланс: 3 монеты. Успешный ИИ-запрос — 1 монета; один Reels и 7 дней с первого запуска. На сервере Покадрово файл не сохраняется.</p>
    <button type="button" class="pe-ai-cancel" data-ai="cancel" hidden>Отменить запрос</button>
    <p class="pe-ai-note">${port.provider?'Первая кнопка отправляет только задание, структуру проекта и предыдущий анализ этого файла. Для передачи самого видео используйте отдельную кнопку с согласием.':'Кнопка станет доступна после подключения сервиса. Сейчас можно сохранить задание; автоматический монтаж не запускается.'}</p>
    <button type="button" class="pe-ai-save" data-ai="save">Сохранить задание в проекте</button>
    <div class="pe-ai-feedback" role="status"></div>
    <section class="pe-ai-analysis" hidden></section>
    <section class="pe-ai-plan"><h3>План монтажа</h3><p>Здесь появятся правки. Они применяются только после вашего подтверждения.</p></section>
    <details class="pe-ai-dev"><summary>Подготовка подключения</summary><p>Для разработки интеграции: выгрузите запрос, затем загрузите ответ по протоколу Pokadrovo Edit Plan v1.</p><button type="button" data-ai="download">Скачать JSON-запрос</button><button type="button" data-ai="import">Загрузить JSON-план</button><input type="file" accept=".json,application/json" class="pe-ai-plan-file" hidden/></details>
    </div>`;
    this.input=this.node.querySelector('textarea')!;
    this.readDraft();
    this.input.addEventListener('input',this.draft);
    this.node.addEventListener('click',this.click);
    this.node.addEventListener('keydown',this.key);
    this.node.querySelector('.pe-ai-plan-file')!.addEventListener('change',this.importFile);
    this.node.querySelector('.pe-ai-media-source')!.addEventListener('change',this.mediaChange);
    this.node.querySelector('.pe-ai-media-consent')!.addEventListener('change',this.mediaChange);
    this.node.querySelector('.pe-ai-mode')!.addEventListener('change',this.serviceChange);
    this.node.querySelector<HTMLSelectElement>('.pe-ai-mode')!.value=port.provider?.service||'';
    port.root.append(this.node);this.refresh();
    void this.checkConnection();
  }
  get open(){return !this.node.hidden;}
  show(){this.previous=document.activeElement as HTMLElement;this.node.hidden=false;this.refresh();this.input.focus({preventScroll:true});void this.checkConnection();}
  close(){this.saveBrief();this.node.hidden=true;this.previous?.isConnected&&this.previous.focus({preventScroll:true});}
  private say(s:string,error=false){const n=this.node.querySelector<HTMLElement>('.pe-ai-feedback')!;n.textContent=s;n.classList.toggle('error',error);}
  private async checkConnection(){
    const provider=this.port.provider;if(!provider?.getStatus||this.disposed)return;const generation=++this.statusGeneration;
    try{const status=await provider.getStatus(this.connectionAbort.signal);if(this.disposed||generation!==this.statusGeneration)return;
     this.available=status.available;this.requiresMedia=!!status.requiresMedia;let reason=status.reason;
     if(provider.service!=='yandex-edit'&&!status.owner&&status.trial?.projectId&&status.trial.projectId!==this.projectId){this.available=false;reason='Бесплатная проба уже начата в другом проекте. Продолжите монтаж в нём.';}
     this.node.querySelector('.pe-ai-connection span')!.textContent=reason;
     this.node.querySelector('.pe-ai-billing-note')!.textContent=status.owner?'Тест администратора без списаний монет. Запрос учитывается в общем лимите выбранного подключения; расходы API несёт сайт.':provider.service==='yandex-edit'?'Стоимость режима будет указана в монетах. Тариф ещё готовится; покупка и списания пока недоступны.':`Подарочный баланс: ${status.billing?.remainingCoins ?? status.trial?.remaining ?? 0} монет. Успешный запрос — ${status.billing?.requestCostCoins ?? 1} монета. Один Reels, 7 дней с первого запуска. При ошибке монета возвращается. Покупка пока не открыта.`;
    }catch(error){if(!this.disposed&&generation===this.statusGeneration){this.available=false;this.node.querySelector('.pe-ai-connection span')!.textContent=error instanceof Error?error.message:'Нет связи с сервисом ИИ.';}}
    finally{if(!this.disposed&&generation===this.statusGeneration)this.refresh();}
  }
  private serviceChange=()=>{
    if(this.abort)return;const service=this.node.querySelector<HTMLSelectElement>('.pe-ai-mode')!.value as AiService;
    if(!this.port.provider?.modes?.some(m=>m.id===service))return;
    this.port.provider.setService?.(service);this.available=false;this.plan=null;this.request=null;this.say('');this.node.querySelector<HTMLInputElement>('.pe-ai-media-consent')!.checked=false;this.renderPlan();this.refresh();void this.checkConnection();
  };
  private mediaChange=(event:Event)=>{const select=this.node.querySelector<HTMLSelectElement>('.pe-ai-media-source')!;if(event.target===select&&select.value!==this.mediaClipId)this.node.querySelector<HTMLInputElement>('.pe-ai-media-consent')!.checked=false;this.mediaClipId=select.value;this.refresh();};
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
      this.analysis=null;this.mediaClipId='';this.renderAnalysis();
    }
    const p=this.port.project(),selected=this.port.selected();
    this.node.querySelector('.pe-ai-context')!.textContent=`${p.clips.length} видео/фото · ${p.audio.length} аудио · ${p.ratio}${selected?' · клип выбран':''}`;
    const service=this.port.provider?.service,reels=service==='reels-trial',visual=service==='source-analysis',router=visual||service==='deepseek-edit';
    const validReels=reels?p.mode==='reels'&&p.ratio==='9:16'&&totalLength(p)<=60:!router||['9:16','16:9'].includes(p.ratio)&&totalLength(p)<=60;
    this.node.querySelector<HTMLSelectElement>('.pe-ai-mode')!.disabled=!!this.abort;
    this.node.querySelector<HTMLElement>('.pe-ai-media')!.hidden=!this.port.provider?.supportsMedia;
    this.node.querySelector('.pe-ai-media-title')!.textContent=visual?'Визуальный разбор и советы':'Разобрать видео и звук';
    this.node.querySelector('.pe-ai-media-description')!.textContent=visual?'MP4 до 60 секунд и 12 МБ. Модель анализирует изображение; речь и звуковая дорожка не распознаются.':'MP4 до 60 секунд и 12 МБ. После первого анализа доступен WAV. Анализируется весь выбранный файл.';
    this.node.querySelector('.pe-ai-consent-copy')!.textContent=visual?'Разрешаю передать выбранный файл целиком через OpenRouter выбранной в настройках модели. Звук в этом режиме не анализируется.':'Разрешаю передать выбранный файл целиком, включая звук, в Qwen через Alibaba Cloud для анализа.';
    this.node.querySelector('[data-ai="analyze"]')!.textContent=visual?'Разобрать исходник и дать советы':'Разобрать файл и предложить монтаж';
    this.node.querySelector('[data-ai="request"]')!.textContent=visual?'Для разбора выберите файл ниже':'✦ Подготовить план монтажа';
    this.node.querySelector('.pe-ai-mode-note')!.textContent=router?(!validReels?'Проба: готовый ролик до 60 секунд, формат 9:16 или 16:9.':visual?'Разбор не изменяет проект. После него выберите режим плана для подготовки правок.':'Модель плана получает задание, структуру проекта и предыдущий анализ. Распознавание речи и автоматические субтитры здесь не подключены.'):reels?(validReels?'Для первого запроса пробы используйте анализ MP4-видео со звуком.':'Включите режим Reels и сократите ролик до 60 секунд.'):'Яндекс получает задание, структуру проекта и предыдущий анализ, без исходного видео. Пользовательский тариф готовится.';
    (this.node.querySelector('[data-ai="request"]') as HTMLButtonElement).disabled=!this.port.provider||!this.available||!!this.abort||this.port.busy()||!validReels||this.requiresMedia;
    const source=this.node.querySelector<HTMLSelectElement>('.pe-ai-media-source')!;
    const clips=[...p.clips,...p.audio].filter(c=>(visual?c.kind==='video':c.kind!=='image')&&this.port.assets.has(c.assetId));
    if(!clips.some(c=>c.id===this.mediaClipId)){this.mediaClipId=clips.find(c=>c.id===selected?.id)?.id||clips[0]?.id||'';this.node.querySelector<HTMLInputElement>('.pe-ai-media-consent')!.checked=false;}
    source.innerHTML=clips.length?clips.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(clock(c.duration))}</option>`).join(''):'<option value="">Сначала добавьте файл в проект</option>';
    source.value=this.mediaClipId;source.disabled=!!this.abort;
    const consent=this.node.querySelector<HTMLInputElement>('.pe-ai-media-consent')!;consent.disabled=!!this.abort;
    this.node.querySelector<HTMLButtonElement>('[data-ai="analyze"]')!.disabled=!this.port.provider?.supportsMedia||!this.available||!!this.abort||this.port.busy()||!validReels||!this.mediaClipId||!consent.checked;
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
    if(action==='analyze'){void this.send(true);return;}
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
  private async prepareMedia():Promise<AiMedia>{
    if(!this.node.querySelector<HTMLInputElement>('.pe-ai-media-consent')!.checked)throw Error('Подтвердите отправку файла провайдеру.');
    const p=this.port.project(),clip=[...p.clips,...p.audio].find(c=>c.id===this.mediaClipId),asset=clip&&this.port.assets.get(clip.assetId);
    if(!clip||!asset)throw Error('Выберите исходник из проекта.');
    if(asset.duration>60||asset.blob.size>12*1024*1024)throw Error('Для первой пробы нужен отдельный исходник до 60 секунд и 12 МБ. Обрезка на таймлайне не уменьшает отправляемый исходник.');
    const video=clip.kind==='video',mime=video?'video/mp4':'audio/wav';
    if(video?!(/\.mp4$/i.test(asset.name)||asset.blob.type==='video/mp4'):!(/\.wav$/i.test(asset.name)||['audio/wav','audio/x-wav','audio/wave'].includes(asset.blob.type)))throw Error('Для пробы используйте MP4-видео или WAV-аудио.');
    this.port.pause();
    const bytes=new Uint8Array(await asset.blob.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return {clipId:clip.id,assetId:clip.assetId,mime,data:btoa(binary)};
  }
  private async send(withMedia=false){
    if(!this.port.provider){this.saveBrief();this.say('Нейросеть не подключена. Задание сохранено.',true);return;}
    if(this.abort)return;
    if(!this.available){this.say('Сначала настройте подключение в админ-панели.',true);void this.checkConnection();return;}
    const gen=++this.generation;
    try{
      if(withMedia&&this.port.provider.service==='source-analysis'&&!this.input.value.trim())this.input.value='Разбери исходник: опиши сцены, предложи начало ролика, последовательность кадров и конкретные улучшения монтажа.';
      const request=await this.build();if(this.disposed||gen!==this.generation)return;
      this.abort=new AbortController();this.refresh();this.say(withMedia?'Подготавливаем выбранный файл…':'Ожидаем план от сервиса…');
      const media=withMedia?await this.prepareMedia():undefined;
      if(this.disposed||gen!==this.generation||this.abort.signal.aborted)return;
      this.say(withMedia?(this.port.provider.service==='source-analysis'?'Анализируем изображение и готовим советы. Звук не распознаётся. До 90 секунд…':'Qwen анализирует изображение, речь и звуки. До 90 секунд…'):'Ожидаем план от сервиса…');
      const raw=await this.port.provider.createPlan(request,this.abort.signal,media);
      if(this.disposed||gen!==this.generation)return;
      if(raw&&typeof raw==='object'&&'plan' in raw&&'analysis' in raw){
        const result=raw as OmniResult;
        if(result.analysis){this.analysis=result.analysis;this.renderAnalysis();}
        this.plan=result.plan===null?null:this.validatePlan(result.plan,request);
        const charge=result.billing;const tokens=charge?.chargedCoins?` Списано монет: ${charge.chargedCoins}. Осталось: ${charge.remainingCoins ?? 0}.`:'';
        this.say((this.plan?'Результат готов. Проверьте план перед применением.':result.summary||'Анализ готов. Монтаж не изменён.')+tokens);
      }else{this.plan=this.validatePlan(raw,request);this.say('Проверьте план перед применением.');}
      this.renderPlan();
    }catch(e){if(!this.disposed&&gen===this.generation)this.say(e instanceof Error?e.message:String(e),true);}
    finally{if(!this.disposed&&gen===this.generation){this.abort=null;this.refresh();void this.checkConnection();}}
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
      this.plan=this.validatePlan(raw,request);this.renderPlan();this.say('План загружен из файла. Проверьте изменения.');
    }catch(e){this.say(e instanceof Error?e.message:String(e),true);}
  }
  private renderPlan(){
    const node=this.node.querySelector('.pe-ai-plan')!;
    if(!this.plan){node.innerHTML='<h3>План монтажа</h3><p>Здесь появятся правки. Они применяются только после вашего подтверждения.</p>';return;}
    node.innerHTML=`<h3>План: ${this.plan.operations.length} действий</h3><p>${esc(this.plan.summary)}</p><ol>${this.plan.operations.map(o=>`<li><strong>${esc(names[o.type])}</strong><small>${esc('id' in o?o.id:'value' in o?o.value:o.type==='caption'?o.text:'На таймлайне')}</small></li>`).join('')}</ol><div><button type="button" data-ai="apply">Применить план</button><button type="button" data-ai="reject">Отклонить</button></div><small>Все правки можно отменить одним действием.</small>`;
  }
  private validatePlan(raw:unknown,request:AiRequest){
    const plan=validateAiPlan(raw,request),next=simulateAiPlan(request.project,plan);
    if(this.port.provider?.service==='reels-trial'&&(next.ratio!=='9:16'||next.mode!=='reels'||totalLength(next)>60.001))throw Error('План выходит за ограничения Reels: нужен формат 9:16 и не более 60 секунд. Монтаж не изменён.');
    if(['source-analysis','deepseek-edit'].includes(this.port.provider?.service||'')&&(!['9:16','16:9'].includes(next.ratio)||totalLength(next)>60.001))throw Error('Пробный план должен сохранять формат 9:16 или 16:9 и длительность до 60 секунд.');
    return plan;
  }
  private renderAnalysis(){
    const node=this.node.querySelector<HTMLElement>('.pe-ai-analysis')!;node.hidden=!this.analysis;if(!this.analysis)return;
    const a=this.analysis;
    node.innerHTML=`<h3>Что происходит в исходнике</h3><p>${esc(a.summary)}</p>${a.scope==='visual'?'<p class="pe-ai-note">Визуальный разбор: звук и речь не анализировались.</p>':`<h4>Речь</h4><p>${esc(a.speech||'Речь не расшифрована.')}</p><h4>Звуки и музыка</h4><p>${esc(a.audio||'Описание звуков не получено.')}</p>`}${a.advice?.length?`<h4>Советы по монтажу</h4><ul>${a.advice.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}<p class="pe-ai-note">Таймкоды ниже относятся к исходному файлу ${esc(this.port.assets.get(a.assetId)?.name||'')}. Это оценка модели: проверьте её перед монтажом.</p><ol>${a.events.map(e=>`<li><strong>${esc(clock(e.from))}–${esc(clock(e.to))}</strong><p>${esc(e.visual)}</p><p>${esc(e.audio)}</p>${e.speech?`<p>Речь: ${esc(e.speech)}</p>`:''}</li>`).join('')}</ol>${a.limitations.length?`<h4>Что требует проверки</h4><ul>${a.limitations.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}`;
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
    this.disposed=true;this.generation++;this.abort?.abort();this.connectionAbort.abort();this.draft();
    this.input.removeEventListener('input',this.draft);this.node.removeEventListener('click',this.click);
    this.node.removeEventListener('keydown',this.key);this.node.querySelector('.pe-ai-plan-file')!.removeEventListener('change',this.importFile);
    this.node.querySelector('.pe-ai-media-source')!.removeEventListener('change',this.mediaChange);this.node.querySelector('.pe-ai-media-consent')!.removeEventListener('change',this.mediaChange);
    this.node.querySelector('.pe-ai-mode')!.removeEventListener('change',this.serviceChange);
    this.node.remove();
  }
}
