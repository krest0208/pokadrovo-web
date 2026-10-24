'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const app = $('app'); let csrf = '', currentView = 'overview', owner = null, settings = null, noticeTimer, idleTimer, agentPoll;
  const text = (node, value) => { node.textContent = String(value); };
  const number = value => new Intl.NumberFormat('ru-RU').format(value || 0);
  const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC';
  const element = (tag, className, value) => { const el = document.createElement(tag); if (className) el.className = className; if (value !== undefined) text(el, value); return el; };
  function notify(message) { clearTimeout(noticeTimer); text($('live'), message); $('live').hidden = false; noticeTimer = setTimeout(() => { $('live').hidden = true; }, 7000); }
  function locked(message = '') {
    csrf = ''; owner = null; settings = null; clearTimeout(idleTimer); clearTimeout(agentPoll);
    app.hidden = true; $('login-screen').hidden = false; text($('login-error'), message);
    $('login-form').elements.password.value = ''; $('login-form').elements.code.value = '';
    for (const id of ['metrics', 'chart', 'chart-table', 'pipeline', 'audit-body', 'breakdowns', 'metric-notes', 'users-body', 'ai-usage', 'ai-metrics', 'ai-model-usage', 'ai-days', 'ai-capacity', 'ai-usage-notes', 'openrouter-catalog', 'site-agent-reports', 'billing-orders', 'legal-requests', 'database-readiness', 'database-checks', 'database-backups']) $(id).replaceChildren();
    for (const form of app.querySelectorAll('form')) form.reset();
    text($('totp-secret'), ''); $('totp-confirm').hidden = true; text($('ai-quota'), '');
  }
  function armIdle() { clearTimeout(idleTimer); if (owner) idleTimer = setTimeout(() => { void request('/logout', { method: 'POST', data: {} }).catch(() => {}); locked('Сеанс завершён после 30 минут бездействия.'); }, 30 * 60000); }
  document.addEventListener('pointerdown', armIdle, { passive: true }); document.addEventListener('keydown', armIdle);
  async function request(path, options = {}) {
    const response = await fetch('/api/admin' + path, { method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(options.data !== undefined ? { body: JSON.stringify(options.data) } : {}), signal: AbortSignal.timeout(15000) });
    let data; try { data = await response.json(); } catch { throw Error('Сервер недоступен. Проверьте локальный запуск.'); }
    if (!response.ok) { if (response.status === 401 && path !== '/login') locked('Войдите повторно.'); throw Error(data.error || 'Запрос не выполнен.'); }
    return data;
  }
  async function unlocked(data) {
    owner = data; csrf = data.csrf; $('login-screen').hidden = true; app.hidden = false;
    document.querySelector('[data-view="oauth"]').hidden = data.socialLoginEnabled !== true;
    text($('owner-name'), data.login); $('login-form').reset(); armIdle();
    await switchView('overview');
  }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
  function bindForm(id, submit) {
    const form = $(id);
    form.addEventListener('submit', async e => {
      e.preventDefault(); const button = form.querySelector('button[type=submit]');
      if (button.disabled) return; button.disabled = true;
      const error = form.querySelector('.form-error') || $('login-error'); text(error, '');
      try { await submit(formData(form), form); }
      catch (e) { text(error, e.name === 'TimeoutError' ? 'Сервер не ответил вовремя.' : e.message); }
      finally { button.disabled = false; for (const input of form.querySelectorAll('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password]')) input.value = ''; if (form.id === 'login-form') { $('owner-password').type = 'password'; $('toggle-owner-password').setAttribute('aria-pressed', 'false'); text($('toggle-owner-password'), 'Показать пароль'); } }
    });
  }
  $('toggle-owner-password').addEventListener('click', () => { const input = $('owner-password'), show = input.type === 'password'; input.type = show ? 'text' : 'password'; $('toggle-owner-password').setAttribute('aria-pressed', String(show)); text($('toggle-owner-password'), show ? 'Скрыть пароль' : 'Показать пароль'); });
  bindForm('login-form', async data => { const response = await request('/login', { method: 'POST', data }); await unlocked(response); });
  $('logout').addEventListener('click', async () => { try { await request('/logout', { method: 'POST', data: {} }); locked(); } catch (e) { notify('Не удалось подтвердить выход на сервере. ' + e.message); } });
  const titles = { users: '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438', oauth: 'Google / Facebook / Instagram', overview: 'Обзор и статистика', api: 'Подключение нейросети', security: 'Защита доступа', audit: 'Журнал действий', agent: 'Агент сайта', database:'Аккаунты и база', legal:'Документы и реквизиты', billing: 'Оплата и монеты' };
  async function switchView(view) {
    currentView = view; if(view!=='agent')clearTimeout(agentPoll);
    for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view + '-view';
    for (const button of document.querySelectorAll('[data-view]')) { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
    text($('page-title'), titles[view]);
    if (view !== 'security') { text($('totp-secret'), ''); $('totp-confirm').hidden = true; }
    if (view === 'overview') await loadOverview();
    if (view === 'api') await loadSettings();
    if (view === 'security') await loadSecurity();
    if (view === 'audit') await loadAudit();
    if (view === 'users') await loadUsers();
    if (view === 'oauth') await loadOAuth();
    if (view === 'agent') await loadSiteAgent();
    if (view === 'billing') await loadBilling();
    if (view === 'legal') await loadLegal();
    if (view === 'database') await loadDatabase();
  }
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => switchView(b.dataset.view).catch(e => notify(e.message)));
  $('period').addEventListener('change', () => loadOverview().catch(e => notify(e.message)));
  $('refresh').addEventListener('click', () => loadOverview().catch(e => notify(e.message)));
  $('audit-refresh').addEventListener('click', () => loadAudit().catch(e => notify(e.message)));
  $('show-table').addEventListener('click', () => { $('chart-table').hidden = !$('chart-table').hidden; text($('show-table'), $('chart-table').hidden ? 'Показать таблицу' : 'Скрыть таблицу'); });
  async function loadOverview() {
    const data = await request('/overview?days=' + $('period').value); if (!owner) return;
    const registration = document.querySelectorAll('.integration-row b')[1];
    text(registration, data.integrations.users ? 'Подключена' : 'Отключена');
    registration.classList.toggle('good', data.integrations.users);
    const payments=document.querySelectorAll('.integration-row b')[2];text(payments,data.integrations.payments?'Продажи включены':'Продажи выключены');payments.classList.toggle('good',data.integrations.payments);
    const m = data.metrics; text($('period-note'), `${data.from} — ${data.to} · UTC · сбор с ${new Date(data.startedAt).toLocaleDateString('ru-RU')}`);
const accountCards = data.users ? [['Зарегистрировано за период', data.users.registered, 'По базе аккаунтов'], ['Всего пользователей', data.users.total, 'Без учётной записи администратора']] : [];
    const cards = [
      ['Запросы главной страницы', m.pageRequests, 'Включая повторные открытия'],
      ['Уникальные браузеры', m.uniqueBrowsers, 'Приблизительно · с согласием'],
      ['Сохранённые проекты', m.projects, 'Уникальные проекты за период'],
      ['Сформировано видео', m.exports, 'Файл отправлен на скачивание']
    ];
    cards.push(...accountCards);
    $('metrics').replaceChildren(...cards.map(([label, value, note]) => { const card = element('article', 'metric'); card.append(element('span', 'metric-label', label), element('strong', 'metric-number', number(value)), element('span', 'metric-note', note)); return card; }));
    const flows = [['Открытия редактора', m.editorOpens], ['Сохранения проектов', m.projectSaves], ['Подготовленные экспорты', m.exports], ['Запуски ИИ-запроса', m.aiRequests]];
    const max = Math.max(1, ...flows.map(x => x[1]));
    $('pipeline').replaceChildren(...flows.map(([label, count]) => { const row = element('div', 'flow-row'), line = element('div'), bar = element('div', 'flow-track'), fill = element('i'); line.append(element('span', '', label), element('strong', '', number(count))); fill.style.width = (count / max * 100) + '%'; bar.append(fill); row.append(line, bar); return row; }));
    const names = { desktop: 'Компьютеры', mobile: 'Телефоны', tablet: 'Планшеты', unknown: 'Без категории', video: 'Обычное видео', reels: 'Reels / Shorts', webm: 'Экспорт WebM', mp4: 'Экспорт MP4' };
    const rows = [...data.breakdown.devices, ...data.breakdown.modes, ...data.breakdown.formats];
    $('breakdowns').replaceChildren(...(rows.length ? rows.map(r => { const row = element('div', 'breakdown-row'); row.append(element('span', '', names[r.label] || 'Другой'), element('strong', '', number(r.count))); return row; }) : [element('p', 'muted', 'Событий пока нет. Распределение появится после использования студии.') ]));
    $('metric-notes').replaceChildren(...data.notes.map(note => element('p', '', note)));
    drawChart(data.series); makeTable(data.series);
  }
  function drawChart(series) {
    const target = $('chart'); target.replaceChildren();
    const NS = 'http://www.w3.org/2000/svg';
    const svgNode = (name, attributes, value) => { const node = document.createElementNS(NS, name); for (const [key, v] of Object.entries(attributes || {})) node.setAttribute(key, String(v)); if (value !== undefined) node.textContent = String(value); return node; };
    const svg = svgNode('svg', { viewBox: '0 0 660 215', 'aria-hidden': 'true' });
    const max = Math.max(4, ...series.flatMap(d => [d.page_requests, d.editor_open]));
    const x = i => 34 + i / Math.max(1, series.length - 1) * 608, y = v => 178 - v / max * 153;
    for (let n = 0; n < 5; n++) { const v = max * n / 4; svg.append(svgNode('path', { d: `M34 ${y(v)}H645`, stroke: '#eaf0f8', 'stroke-width': 1 }), svgNode('text', { x: 21, y: y(v) + 3, 'text-anchor': 'end', fill: '#97a9c1', 'font-size': 9 }, Math.round(v))); }
    for (const [key, color] of [['page_requests', '#2868e8'], ['editor_open', '#44b4b0']]) {
      const points = series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(d[key]).toFixed(2)}`).join(' ');
      if (key === 'page_requests') svg.append(svgNode('path', { d: points + `L${x(series.length - 1)} 178L34 178Z`, fill: '#2868e8', opacity: '.045' }));
      svg.append(svgNode('path', { d: points, fill: 'none', stroke: color, 'stroke-width': 2.1, 'stroke-linejoin': 'round' }));
      for (let i = 0; i < series.length; i++) if (series[i][key]) { const dot = svgNode('circle', { cx: x(i), cy: y(series[i][key]), r: 3, fill: color }); dot.append(svgNode('title', {}, `${series[i].day}: ${series[i][key]}`)); svg.append(dot); }
    }
    const ticks = new Set([0, Math.round((series.length - 1) / 3), Math.round((series.length - 1) * 2 / 3), series.length - 1]);
    for (const i of ticks) svg.append(svgNode('text', { x: x(i), y: 205, 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle', fill: '#8a9eb9', 'font-size': 10 }, series[i].day.slice(5).split('-').reverse().join('.')));
    target.append(svg);
    if (!series.some(d => d.page_requests || d.editor_open)) svg.append(svgNode('text', { x: 336, y: 94, 'text-anchor': 'middle', fill: '#91a4bf', 'font-size': 12 }, 'Здесь появится первая активность'));
    target.setAttribute('aria-label', `График: ${series.reduce((n,d)=>n+d.page_requests,0)} запросов главной, ${series.reduce((n,d)=>n+d.editor_open,0)} открытий редактора.`);
  }
  function makeTable(series) {
    const table = element('table'), head = element('thead'), hr = element('tr');
    for (const label of ['Дата UTC', 'Главная', 'Редактор', 'Сохранения', 'Экспорты']) hr.append(element('th', '', label));
    head.append(hr); const body = element('tbody');
    for (const d of [...series].reverse()) { const row = element('tr'); for (const value of [d.day, d.page_requests, d.editor_open, d.project_saved, d.export_completed]) row.append(element('td', '', value)); body.append(row); }
    table.append(head, body); $('chart-table').replaceChildren(table);
  }
  async function loadDatabase(){
    const d=await request('/database');if(!owner)return;
    const r=d.registration; text($('database-registration'),!r.accountsEnabled?'Регистрация выключена настройкой сервера':r.legalReady?'Регистрация готова':'Ожидаются документы оператора');
    const missing={operatorName:'ФИО или наименование оператора',address:'Адрес для обращений',email:'Работающая почта',phone:'Контактный телефон',hosting:'Место базы и копий, правила хранения',processors:'Обработчики и страны передачи',rknNotice:'Уведомления и правовые основания',validEmail:'Корректный адрес почты',validPhone:'Корректный телефон',identityConfirmed:'Подтверждение публичных реквизитов',hostingConfirmed:'Проверка хостинга и локализации',processingReviewed:'Проверка целей и оснований обработки',crossBorderReviewed:'Проверка трансграничной передачи',documentsApproved:'Утверждение текстов документов'};
    const summary=element('p','',r.legalReady?'Документы опубликованы. Новая регистрация, вход и запись согласий доступны.':'До открытия регистрации заполните и проверьте документы. Существующий вход и гостевой монтаж доступны.');const list=element('ul');if(!r.legalReady&&!r.missing.length)list.append(element('li','','Опубликуйте проверенные документы в разделе реквизитов.'));for(const key of r.missing)list.append(element('li','',missing[key]||key));$('database-readiness').replaceChildren(summary,list);
    text($('database-health'),d.healthy?'Проверка пройдена':'Нужна проверка');const labels={integrity:'Целостность',writable:'Запись данных',foreignKeys:'Связи таблиц',wal:'Журнал WAL',schemaReady:'Таблицы аккаунтов'};
    $('database-checks').replaceChildren(...Object.entries(labels).map(([key,label])=>{const card=element('div','metric');card.append(element('span','',label),element('strong','',d[key]?'В порядке':'Проверить'));return card;}));
    text($('database-counts'),'Аккаунтов: '+number(d.users)+'. Проектов: '+number(d.projects)+'. Аккаунтов с резервным кодом: '+number(d.recovery.accountsWithCode)+'. Подтверждение почты письмом не подключено.');
    const b=d.backup;text($('database-backup-state'),b.error|| (b.running?'Создаётся копия…':b.lastSuccess?'Последняя успешная копия: '+date(b.lastSuccess):'Успешной копии пока нет. Автоматическая проверка выполняется после запуска сервера.'));
    const table=element('table'),head=element('thead'),hr=element('tr');for(const x of ['Создана','Размер базы и ключа'])hr.append(element('th','',x));head.append(hr);const tb=element('tbody');for(const item of b.copies){const tr=element('tr');tr.append(element('td','',date(item.created)),element('td','',number(Math.ceil(item.bytes/1024))+' КБ'));tb.append(tr);}table.append(head,tb);$('database-backups').replaceChildren(b.copies.length?table:element('p','','Копий пока нет.'));
  }
  $('database-refresh').addEventListener('click',()=>loadDatabase().catch(e=>notify(e.message)));
  bindForm('database-backup-form',async data=>{await request('/database/backup',{method:'POST',data});notify('Резервная копия создана и проверена');await loadDatabase();});
  const legalFields=['operatorType','operatorName','inn','ogrn','address','email','phone','hosting','processors','rknNotice'];
  const legalChecks=['published','identityConfirmed','hostingConfirmed','processingReviewed','crossBorderReviewed','documentsApproved'];
  async function loadLegal(){
    const data=await request('/legal');if(!owner)return;
    const f=$('legal-form');for(const k of legalFields)f.elements[k].value=data.config[k]||'';for(const k of legalChecks)f.elements[k].checked=data.config[k]===true;
    text($('legal-state'),data.ready?'Документы опубликованы':data.requiresReview?'Тексты обновлены · требуется повторное утверждение':'Проект · регистрация приостановлена');text($('legal-version'),'Редакция: '+data.version+'. Платные услуги: '+(data.salesReady?'реквизиты заполнены; нужны остальные проверки оплаты':'юридическая подготовка не завершена'));
    const table=element('table'),head=element('thead'),hr=element('tr');for(const t of ['Получено','Аккаунт / почта','Запрос','Номер'])hr.append(element('th','',t));head.append(hr);const tb=element('tbody');
    const kinds={access:'Сведения и доступ',erase:'Удаление аккаунта и данных',withdraw:'Отзыв согласия'};
    for(const r of data.requests){const tr=element('tr');for(const v of [date(r.created),r.email||r.account_id,kinds[r.kind]||r.kind,r.id])tr.append(element('td','',v));tb.append(tr);}table.append(head,tb);
    $('legal-requests').replaceChildren(data.requests.length?table:element('p','','Обращений пока нет.'));
  }
  bindForm('legal-form',async(data,form)=>{for(const k of legalChecks)data[k]=form.elements[k].checked;await request('/legal',{method:'PUT',data});notify('Редакция документов сохранена');await loadLegal();});
  $('legal-refresh').addEventListener('click',()=>loadLegal().catch(e=>notify(e.message)));
  async function loadBilling(){
    const [data,history,legal]=await Promise.all([request('/billing'),request('/billing/orders'),request('/legal')]);if(!owner)return;
    const f=$('billing-form');for(const k of ['merchantLogin','algorithm','tax','paymentMethod','paymentObject','offerUrl','termsVersion'])f.elements[k].value=data[k];
    if(!data.offerUrl)f.elements.offerUrl.value=location.origin+'/legal/payments';if(!data.termsVersion&&legal.ready)f.elements.termsVersion.value=legal.version;
    for(const k of ['enabled','approved','fiscalReady','legalReady'])f.elements[k].checked=data[k];
    for(const id of ['start','author','studio'])f.elements['price_'+id].value=data.prices[id]||'';
    for(const input of f.querySelectorAll('input[type=password]'))input.value='';
    for(const k of ['result','success','fail'])$('billing-'+k+'-url').value=data.urls[k];
    text($('billing-status'),data.available?'Продажи включены':'Продажи выключены');
    text($('billing-test-state'),data.testConfigured?'Тестовые пароли сохранены':'Не сохранены');text($('billing-live-state'),data.liveConfigured?'Боевые пароли сохранены':'Не сохранены');
    text($('billing-test-note'),data.testVerified?'Подтверждение ResultURL получено. Тест пройден.':data.testConfigured?'Можно проверить оплату. Настоящий баланс не изменится.':'Сначала сохраните тестовые пароли.');$('billing-test').disabled=!data.testConfigured;
    const states={pending:'Ожидает оплаты',paid:'Оплачен',partially_refunded:'Частичный возврат',refunded:'Возвращён'};
    $('billing-orders').replaceChildren(...history.items.map(o=>{const row=element('tr');for(const x of ['№'+o.id,number(o.coins),o.priceRub+' ₽',o.test?'Тест':'Боевой',states[o.status]||o.status,date(o.created)])row.append(element('td','',x));return row;}));
    if(!history.items.length){const row=element('tr'),cell=element('td','','Платежей пока нет');cell.colSpan=6;row.append(cell);$('billing-orders').append(row);}
  }
  bindForm('billing-form',async(data,form)=>{
    for(const k of ['enabled','approved','fiscalReady','legalReady'])data[k]=form.elements[k].checked;
    data.prices={};for(const id of ['start','author','studio']){data.prices[id]=data['price_'+id].trim().replace(',','.');delete data['price_'+id];}
    await request('/billing',{method:'PUT',data});notify('Настройки Robokassa сохранены');await loadBilling();
  });
  $('billing-refresh').addEventListener('click',()=>loadBilling().catch(e=>notify(e.message)));
  $('billing-test').addEventListener('click',async()=>{
    const button=$('billing-test');if(button.disabled)return;button.disabled=true;
    try{const order=await request('/billing/test-order',{method:'POST',data:{packageId:'start',requestId:crypto.randomUUID()}});if(!owner)return;if(!/^\/api\/billing\/pay\/[1-9]\d*$/.test(order.checkoutPath))throw Error('Некорректный адрес оплаты');window.location.assign(order.checkoutPath);}
    catch(e){notify(e.message);button.disabled=false;}
  });
  bindForm('billing-refund-form',async(data,form)=>{data.confirmed=form.elements.confirmed.checked;data.amountRub=data.amountRub.trim().replace(',','.');await request('/billing/refunds',{method:'POST',data});form.reset();notify('Возврат записан, баланс пересчитан');await loadBilling();});
  async function loadSettings() {
    settings = await request('/settings'); if (!owner) return;
    const form = $('settings-form'); form.elements.provider.value = settings.provider; form.elements.model.value = settings.model;
    form.elements.endpoint.value = settings.endpoint || ''; form.elements.aiEnabled.checked = settings.aiEnabled;
    form.elements.trialEnabled.checked = settings.trialEnabled;
    form.elements.apiKey.value = ''; form.elements.password.value = ''; form.elements.removeKey.checked = false; form.elements.analyticsEnabled.checked = settings.analyticsEnabled;
    text($('key-status'), settings.keyConfigured ? 'Ключ сохранён на сервере' : 'Ключ не указан');
    text($('ai-connection-status'), settings.connected ? 'Проверена запросом' : settings.configured && settings.aiEnabled ? 'Готова к пробе' : 'Не включена');
    text($('ai-connection-note'), settings.connected ? 'Qwen успешно ответил на запрос. Можно продолжать пробные анализы в редакторе.' : settings.configured && settings.aiEnabled ? 'Настройки сохранены. Доступ к модели проверяется запросом из редактора.' : 'Для запуска выберите Qwen Omni, укажите ключ и Base URL, затем включите пробный режим.');
    updateAiFields();
    await Promise.all([loadOpenRouter(), loadAiUsage(), loadYandex()]);
  }
  async function loadOpenRouter() {
    const data=await request('/ai/openrouter'); if(!owner)return; const form=$('openrouter-form');
    for(const key of ['endpoint','analysisModel','editModel','dailyLimit'])form.elements[key].value=data[key];
    form.elements.enabled.checked=data.enabled;form.elements.trialEnabled.checked=data.trialEnabled;
    form.elements.apiKey.value='';form.elements.password.value='';form.elements.removeKey.checked=false;
    text($('openrouter-key-status'),data.keyConfigured?'Общий ключ OpenRouter сохранён':'API-ключ OpenRouter не указан');
    text($('openrouter-status'),!data.enabled?'Не включён':data.analysisVerified&&data.editVerified?'Обе модели отвечали':data.analysisVerified?'Разбор проверен':data.editVerified?'План проверен':'Сохранён · ожидает проверки');
  }
  bindForm('openrouter-form',async(data,form)=>{
    data.removeKey=form.elements.removeKey.checked;data.enabled=!data.removeKey&&form.elements.enabled.checked;
    data.trialEnabled=data.enabled&&form.elements.trialEnabled.checked;data.dailyLimit=Number(data.dailyLimit);
    if(data.removeKey&&!confirm('Удалить только API-ключ OpenRouter?'))return;
    await request('/ai/openrouter',{method:'PUT',data});form.reset();await Promise.all([loadOpenRouter(),loadAiUsage()]);
    notify('OpenRouter сохранён. Генерация не запускалась. Проверьте каталог, затем выполните тест в редакторе.');
  });
  $('openrouter-form').elements.trialEnabled.addEventListener('change',()=>{const f=$('openrouter-form');if(f.elements.trialEnabled.checked)f.elements.enabled.checked=true;});
  $('openrouter-form').elements.enabled.addEventListener('change',()=>{const f=$('openrouter-form');if(!f.elements.enabled.checked)f.elements.trialEnabled.checked=false;});
  $('openrouter-catalog-refresh').addEventListener('click',async()=>{
    const button=$('openrouter-catalog-refresh');button.disabled=true;
    try{const data=await request('/ai/openrouter/catalog');if(!owner)return;
      $('openrouter-catalog').replaceChildren(...data.items.map(item=>element('p','field-note',`${item.model}: ${item.reason}`)));
    }catch(e){notify(e.message);}finally{button.disabled=false;}
  });
  function cost(value){return value===null||value===undefined?'Не сообщён':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6}).format(value);}
  async function loadAiUsage(){
    const [data,usage]=await Promise.all([request('/ai/analytics?days='+$('ai-period').value),request('/ai/usage')]);if(!owner)return;
    const t=data.totals;
    const cards=[['Попытки',t.attempts,'Включая ошибки после отправки'],['Успешно',t.succeeded,'Проверенный результат'],['Ошибки / прервано',t.failed,'Подарочные монеты возвращены'],['Пользователи',t.users,'Без администратора'],['Токены API',t.inputTokens+t.outputTokens,`Учтены у ${t.meteredRequests||0} запросов`],['Списано монет',t.coins,'Внутренний баланс Покадрово']];
    $('ai-metrics').replaceChildren(...cards.map(([label,value,note])=>{const card=element('article','metric');card.append(element('span','metric-label',label),element('strong','metric-number',number(value)),element('span','metric-note',note));return card;}));
    const q=data.quota;text($('ai-quota'),`OpenRouter сегодня: ${q.used} из ${q.limit} попыток сайта. Осталось ${q.remaining}. Бесплатная квота аккаунта — до ${q.providerFreeDailyLimit} в сутки; лимит сайта оставляет запас. Сброс: ${new Date(q.resetsAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК. Одновременно выполняется один ИИ-запрос.`);
    function row(values){const tr=element('tr');for(const v of values)tr.append(element('td','',v));return tr;}
    $('ai-model-usage').replaceChildren(...(data.models.length?data.models.map(m=>row([`${m.model} · ${m.task==='analysis'?'разбор':m.task==='ideas'?'идеи агента':'план'}`,m.attempts,`${m.succeeded} / ${m.failed}`,`${number(m.inputTokens)} / ${number(m.outputTokens)} (${m.meteredRequests||0} учтено)`,m.averageMs===null?'—':(m.averageMs/1000).toFixed(1)+' сек.',`${cost(m.reportedCostUsd)}${m.costReportedRequests?' · '+m.costReportedRequests+' учтено':''}`])):[row(['Запросов за период нет','—','—','—','—','—'])]));
    $('ai-days').replaceChildren(...data.series.map(d=>row([d.day,d.attempts,d.succeeded,d.failed,d.users])));
    $('ai-capacity').replaceChildren(...data.capacity.map(c=>row([c.label,c.requests,c.totalRequests,c.fitsSiteLimit?'Хватает без запаса на ошибки':'Превышен',c.fitsProviderFreeLimit?'Хватает без запаса на ошибки':'Превышен'])));
    $('ai-usage-notes').replaceChildren(...data.notes.map(note=>element('p','',note)));
    $('ai-usage').replaceChildren(...(usage.items.length?usage.items.map(r=>element('p','field-note',`${new Date(r.at).toLocaleString('ru-RU')} · ${r.model} · ${r.task==='analysis'?'Разбор':r.task==='ideas'?'Идеи агента':'План'} · ${r.access_kind==='free_trial'?'Проба':'Администратор'} · ${r.result==='ok'?'Готово':r.result==='started'?'Выполняется':'Не завершён'}${r.upstream_status===null?'':' · HTTP '+r.upstream_status}${r.duration_ms===null?'':' · '+(r.duration_ms/1000).toFixed(1)+' сек.'}${r.input_tokens===null?'':' · токены '+r.input_tokens+' / '+r.output_tokens}`)):[element('p','field-note','Запросов ещё нет.')]));
  }
  $('ai-refresh').addEventListener('click',()=>loadAiUsage().catch(e=>notify(e.message)));
  $('ai-period').addEventListener('change',()=>loadAiUsage().catch(e=>notify(e.message)));
  let yandexModels=[];
  function describeYandexModel() {
    const selected=yandexModels.find(model=>model.id===$('yandex-form').elements.model.value);
    text($('yandex-model-description'),selected?selected.role+' · контекст '+selected.contextTokens.toLocaleString('ru-RU')+' токенов. '+selected.description:'Выберите модель из списка AI Studio.');
  }
  $('yandex-form').elements.model.addEventListener('change',describeYandexModel);
  async function loadYandex() {
    const data=await request('/ai/yandex'); if(!owner)return; const form=$('yandex-form');
    yandexModels=data.models||[];
    form.elements.model.replaceChildren(...yandexModels.map(model=>new Option(model.name,model.id)));
    form.elements.model.value=data.model;form.elements.folderId.value=data.folderId;form.elements.apiKey.value='';form.elements.password.value='';form.elements.removeKey.checked=false;form.elements.enabled.checked=data.enabled;
    describeYandexModel();
    text($('yandex-key-status'),data.keyConfigured?'Отдельный ключ Яндекса сохранён':'Ключ Яндекса не указан');
    text($('yandex-connection-status'),data.connected?data.modelName+' · проверена':data.configured&&data.enabled?'Ожидает проверки: '+data.modelName:'Не включена');
  }
  bindForm('yandex-form',async(data,form)=>{
    data.removeKey=form.elements.removeKey.checked;data.enabled=!data.removeKey&&form.elements.enabled.checked;
    if(data.removeKey&&!confirm('Удалить только API-ключ Яндекса?'))return;
    await request('/ai/yandex',{method:'PUT',data});form.reset();await loadYandex();notify('Настройки Яндекса сохранены отдельно. Платный запрос не запускался, пользовательский тариф ещё закрыт.');
  });
  function updateAiFields() {
    const form = $('settings-form'), qwen = form.elements.provider.value === 'qwen';
    form.elements.endpoint.disabled = !qwen; form.elements.endpoint.required = qwen;
    form.elements.aiEnabled.disabled = !qwen; if (!qwen) form.elements.aiEnabled.checked = false;
    form.elements.trialEnabled.disabled = !qwen; if (!qwen) form.elements.trialEnabled.checked = false;
  }
  $('settings-form').elements.provider.addEventListener('change', () => {
    const form = $('settings-form'); if (form.elements.provider.value === 'qwen') form.elements.model.value = 'qwen3.8-omni-flash'; updateAiFields();
  });
  $('settings-form').elements.trialEnabled.addEventListener('change', () => {
    const form=$('settings-form'); if(form.elements.trialEnabled.checked)form.elements.aiEnabled.checked=true;
  });
  $('settings-form').elements.aiEnabled.addEventListener('change', () => {
    const form=$('settings-form'); if(!form.elements.aiEnabled.checked)form.elements.trialEnabled.checked=false;
  });
  bindForm('settings-form', async (data, form) => {
    data.analyticsEnabled = form.elements.analyticsEnabled.checked; data.removeKey = form.elements.removeKey.checked;
    data.aiEnabled = !data.removeKey && form.elements.provider.value === 'qwen' && form.elements.aiEnabled.checked;
    data.trialEnabled = data.aiEnabled && form.elements.trialEnabled.checked;
    if (data.removeKey && !confirm('Удалить API-ключ с сервера?')) return;
    await request('/settings', { method: 'PUT', data }); form.reset(); await loadSettings(); notify('Настройки сохранены. Платный запрос не запускался. Проверка — из ИИ-панели редактора.');
  });
  const agentAiNames={'ready':'ИИ подготовил новые идеи.','daily-limit':'Суточный запрос идей уже использован. Ранее подготовленные выдаются по очереди.','user-reserve':'ИИ-идеи отложены: оставлен запас запросов пользователям.','busy':'ИИ занят пользовательским запросом. Проверки сайта продолжены.','disabled':'ИИ-идеи выключены.','not-configured':'Ключ OpenRouter не подключён или тесты модели выключены.','unavailable':'Бесплатная модель недоступна; используются встроенные рекомендации.','failed':'Модель не подготовила корректный список. Повторов в этот день не будет.','interrupted':'Подготовка идей прервана.'};
  async function loadSiteAgent(){
    clearTimeout(agentPoll);const [data,page]=await Promise.all([request('/site-agent/status'),request('/site-agent/reports')]);if(!owner)return;
    const form=$('site-agent-form');form.elements.enabled.checked=data.enabled;form.elements.useAi.checked=data.useAi;form.elements.password.value='';
    text($('site-agent-status'),data.running?'Проверка выполняется':data.enabled?'Каждый час':'На паузе');
    text($('site-agent-note'),`Последняя проверка: ${data.lastRun?new Date(data.lastRun).toLocaleString('ru-RU'):'пока нет'}. Следующая: ${data.nextRun?new Date(data.nextRun).toLocaleString('ru-RU'):'пауза'}. Непрочитанных: ${data.unread}.`);
    text($('site-agent-ai-note'),agentAiNames[data.aiStatus]||'Идеи будут подготовлены при следующей проверке.');
    $('site-agent-run').disabled=data.running;
    $('site-agent-reports').replaceChildren(...(page.items.length?page.items.map(r=>{
      const d=element('details','site-agent-report'),summary=element('summary','',new Date(r.at).toLocaleString('ru-RU')+' · '+r.summary);d.append(summary);
      for(const f of r.findings)d.append(element('p','field-note',f.title+': '+f.evidence));
      for(const i of r.ideas)d.append(element('p','field-note','Идея: '+i.title+'. '+i.details));
      if(r.notChecked?.length)d.append(element('p','field-note','Не проверялось: '+r.notChecked.join('; ')));
      return d;
    }):[element('p','field-note','Отчётов пока нет. Первая проверка начнётся после включения агента на сервере.')]));
    if(data.running&&currentView==='agent')agentPoll=setTimeout(()=>loadSiteAgent().catch(e=>notify(e.message)),3000);
  }
  bindForm('site-agent-form',async(data,form)=>{
    data.enabled=form.elements.enabled.checked;data.useAi=form.elements.useAi.checked;
    await request('/site-agent/settings',{method:'PUT',data});await loadSiteAgent();notify('Настройки агента сохранены. Отчёты доступны только вашему аккаунту.');
  });
  $('site-agent-refresh').addEventListener('click',()=>loadSiteAgent().catch(e=>notify(e.message)));
  $('site-agent-run').addEventListener('click',async()=>{
    const button=$('site-agent-run');button.disabled=true;
    try{await request('/site-agent/run',{method:'POST',data:{}});notify('Проверка запущена. Результат появится в сообщениях агента.');await loadSiteAgent();}catch(e){notify(e.message);button.disabled=false;}
  });
  async function loadSecurity() {
    const session = await request('/session'); if (!owner) return; owner.totpEnabled = session.totpEnabled; $('password-form').elements.newLogin.value = session.login;
    text($('totp-status'), session.totpEnabled ? 'Включён' : 'Выключен'); $('totp-begin').hidden = session.totpEnabled; $('totp-disable').hidden = !session.totpEnabled;
    text($('totp-secret'), ''); $('totp-confirm').hidden = true;
  }
  bindForm('password-form', async data => { await request('/password', { method: 'POST', data }); locked('Данные доступа изменены. Войдите с актуальными логином и паролем.'); });
  bindForm('totp-begin', async data => { const r = await request('/totp/begin', { method: 'POST', data }); text($('totp-secret'), r.secret); $('totp-confirm').hidden = false; $('totp-begin').hidden = true; });
  bindForm('totp-confirm', async (data, form) => { await request('/totp/confirm', { method: 'POST', data }); form.reset(); await loadSecurity(); notify('Вход по паролю и коду с телефона включён.'); });
  bindForm('totp-disable', async data => { if (!confirm('Отключить второй фактор?')) return; await request('/totp/disable', { method: 'POST', data }); await loadSecurity(); notify('Второй фактор отключён.'); });
  const auditNames = { owner_created: 'Администратор создан', owner_reset: 'Восстановление через терминал', login: 'Успешный вход', login_failed: 'Неудачная попытка входа', logout: 'Выход', reauth_failed: 'Неудачное подтверждение пароля', settings_updated: 'Настройки обновлены', api_key_removed: 'API-ключ удалён', password_changed: 'Пароль изменён', totp_enabled: 'Второй фактор включён', totp_disabled: 'Второй фактор отключён' };
  async function loadAudit() {
    const data = await request('/audit'); if (!owner) return;
    $('audit-body').replaceChildren(...data.items.map(r => { const tr = element('tr'); tr.append(element('td', '', date(r.at)), element('td', '', auditNames[r.action] || 'Действие сервера'), element('td', '', r.result === 'ok' ? 'Выполнено' : 'Отклонено')); return tr; }));
  }
let usersPage = 1, usersPages = 1, oauthSettings = [];
  async function loadUsers() {
    const data = await request('/users?page=' + usersPage + '&q=' + encodeURIComponent($('users-query').value));
    if (!owner) return; usersPages = data.pages; text($('users-count'), data.count + ' аккаунтов'); text($('users-page'), data.page + ' / ' + data.pages);
    $('users-prev').disabled = usersPage <= 1; $('users-next').disabled = usersPage >= usersPages;
    $('users-body').replaceChildren(...data.items.map(u => { const row = element('tr'); row.append(element('td', '', u.name), element('td', '', u.email || 'Не передана'), element('td', '', u.providers.length ? u.providers.join(', ') : 'Почта и пароль'), element('td', '', u.projectCount), element('td', '', date(u.created)), element('td', '', date(u.last_login))); return row; }));
    if (!data.items.length) { const row = element('tr'), cell = element('td', 'muted', 'Пользователи пока не найдены'); cell.colSpan = 6; row.append(cell); $('users-body').append(row); }
  }
  $('users-search').addEventListener('submit', e => { e.preventDefault(); usersPage = 1; loadUsers().catch(e => notify(e.message)); });
  $('users-prev').addEventListener('click', () => { usersPage = Math.max(1, usersPage - 1); loadUsers().catch(e => notify(e.message)); });
  $('users-next').addEventListener('click', () => { usersPage = Math.min(usersPages, usersPage + 1); loadUsers().catch(e => notify(e.message)); });
  function showProvider() {
    const form = $('oauth-form'), selected = oauthSettings.find(p => p.provider === form.elements.provider.value); if (!selected) return;
    form.elements.clientId.value = selected.clientId; form.elements.clientSecret.value = ''; form.elements.password.value = ''; form.elements.graphVersion.value = selected.graphVersion; form.elements.graphVersion.disabled = selected.provider === 'google';
    form.elements.enabled.checked = !!selected.enabled; form.elements.removeSecret.checked = false; $('oauth-redirect').value = selected.redirectUri;
    text($('oauth-status'), selected.ready ? 'Настроен · проверьте реальный вход' : selected.secretConfigured ? 'Секрет сохранён, вход не активен' : 'Не подключён');
  }
  async function loadOAuth() { const data = await request('/oauth'); if (!owner) return; oauthSettings = data.providers; showProvider(); }
  $('oauth-provider').addEventListener('change', showProvider);
  bindForm('oauth-form', async (data, form) => {
    data.enabled = form.elements.enabled.checked; data.removeSecret = form.elements.removeSecret.checked;
    await request('/oauth', { method: 'PUT', data }); await loadOAuth(); notify('Настройки сохранены. Реальный вход нужно проверить после настройки приложения у провайдера.');
  });
  request('/session').then(unlocked).catch(() => locked());
})();
