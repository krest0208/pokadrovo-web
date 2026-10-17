'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const app = $('app'); let csrf = '', currentView = 'overview', owner = null, settings = null, noticeTimer, idleTimer;
  const text = (node, value) => { node.textContent = String(value); };
  const number = value => new Intl.NumberFormat('ru-RU').format(value || 0);
  const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC';
  const element = (tag, className, value) => { const el = document.createElement(tag); if (className) el.className = className; if (value !== undefined) text(el, value); return el; };
  function notify(message) { clearTimeout(noticeTimer); text($('live'), message); $('live').hidden = false; noticeTimer = setTimeout(() => { $('live').hidden = true; }, 7000); }
  function locked(message = '') {
    csrf = ''; owner = null; settings = null; clearTimeout(idleTimer);
    app.hidden = true; $('login-screen').hidden = false; text($('login-error'), message);
    $('login-form').elements.password.value = ''; $('login-form').elements.code.value = '';
    for (const id of ['metrics', 'chart', 'chart-table', 'pipeline', 'audit-body', 'breakdowns', 'metric-notes']) $(id).replaceChildren();
    for (const form of app.querySelectorAll('form')) form.reset();
    text($('totp-secret'), ''); $('totp-confirm').hidden = true;
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
      finally { button.disabled = false; for (const input of form.querySelectorAll('input[type=password]')) input.value = ''; }
    });
  }
  bindForm('login-form', async data => { const response = await request('/login', { method: 'POST', data }); await unlocked(response); });
  $('logout').addEventListener('click', async () => { try { await request('/logout', { method: 'POST', data: {} }); locked(); } catch (e) { notify('Не удалось подтвердить выход на сервере. ' + e.message); } });
  const titles = { overview: 'Обзор и статистика', api: 'ИИ и API-ключ', security: 'Защита доступа', audit: 'Журнал действий' };
  async function switchView(view) {
    currentView = view;
    for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view + '-view';
    for (const button of document.querySelectorAll('[data-view]')) { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
    text($('page-title'), titles[view]);
    if (view !== 'security') { text($('totp-secret'), ''); $('totp-confirm').hidden = true; }
    if (view === 'overview') await loadOverview();
    if (view === 'api') await loadSettings();
    if (view === 'security') await loadSecurity();
    if (view === 'audit') await loadAudit();
  }
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => switchView(b.dataset.view).catch(e => notify(e.message)));
  $('period').addEventListener('change', () => loadOverview().catch(e => notify(e.message)));
  $('refresh').addEventListener('click', () => loadOverview().catch(e => notify(e.message)));
  $('audit-refresh').addEventListener('click', () => loadAudit().catch(e => notify(e.message)));
  $('show-table').addEventListener('click', () => { $('chart-table').hidden = !$('chart-table').hidden; text($('show-table'), $('chart-table').hidden ? 'Показать таблицу' : 'Скрыть таблицу'); });
  async function loadOverview() {
    const data = await request('/overview?days=' + $('period').value); if (!owner) return;
    const m = data.metrics; text($('period-note'), `${data.from} — ${data.to} · UTC · сбор с ${new Date(data.startedAt).toLocaleDateString('ru-RU')}`);
    const cards = [
      ['Запросы главной страницы', m.pageRequests, 'Включая повторные открытия'],
      ['Уникальные браузеры', m.uniqueBrowsers, 'Приблизительно · с согласием'],
      ['Сохранённые проекты', m.projects, 'Уникальные проекты за период'],
      ['Сформировано видео', m.exports, 'Файл отправлен на скачивание']
    ];
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
  async function loadSettings() {
    settings = await request('/settings'); if (!owner) return;
    const form = $('settings-form'); form.elements.provider.value = settings.provider; form.elements.model.value = settings.model;
    form.elements.apiKey.value = ''; form.elements.password.value = ''; form.elements.removeKey.checked = false; form.elements.analyticsEnabled.checked = settings.analyticsEnabled;
    text($('key-status'), settings.keyConfigured ? 'Ключ сохранён на сервере' : 'Ключ не указан');
  }
  bindForm('settings-form', async (data, form) => {
    data.analyticsEnabled = form.elements.analyticsEnabled.checked; data.removeKey = form.elements.removeKey.checked;
    if (data.removeKey && !confirm('Удалить API-ключ с сервера?')) return;
    await request('/settings', { method: 'PUT', data }); form.reset(); await loadSettings(); notify('Настройки сохранены. Ключ не проверялся у провайдера, ИИ не запускался.');
  });
  async function loadSecurity() {
    const session = await request('/session'); if (!owner) return; owner.totpEnabled = session.totpEnabled;
    text($('totp-status'), session.totpEnabled ? 'Включён' : 'Выключен'); $('totp-begin').hidden = session.totpEnabled; $('totp-disable').hidden = !session.totpEnabled;
    text($('totp-secret'), ''); $('totp-confirm').hidden = true;
  }
  bindForm('password-form', async data => { await request('/password', { method: 'POST', data }); locked('Пароль изменён. Войдите с новой парольной фразой.'); });
  bindForm('totp-begin', async data => { const r = await request('/totp/begin', { method: 'POST', data }); text($('totp-secret'), r.secret); $('totp-confirm').hidden = false; $('totp-begin').hidden = true; });
  bindForm('totp-confirm', async (data, form) => { await request('/totp/confirm', { method: 'POST', data }); form.reset(); await loadSecurity(); notify('Вход по паролю и коду с телефона включён.'); });
  bindForm('totp-disable', async data => { if (!confirm('Отключить второй фактор?')) return; await request('/totp/disable', { method: 'POST', data }); await loadSecurity(); notify('Второй фактор отключён.'); });
  const auditNames = { owner_created: 'Владелец создан', owner_reset: 'Восстановление через терминал', login: 'Успешный вход', login_failed: 'Неудачная попытка входа', logout: 'Выход', reauth_failed: 'Неудачное подтверждение пароля', settings_updated: 'Настройки обновлены', api_key_removed: 'API-ключ удалён', password_changed: 'Пароль изменён', totp_enabled: 'Второй фактор включён', totp_disabled: 'Второй фактор отключён' };
  async function loadAudit() {
    const data = await request('/audit'); if (!owner) return;
    $('audit-body').replaceChildren(...data.items.map(r => { const tr = element('tr'); tr.append(element('td', '', date(r.at)), element('td', '', auditNames[r.action] || 'Действие сервера'), element('td', '', r.result === 'ok' ? 'Выполнено' : 'Отклонено')); return tr; }));
  }
  request('/session').then(unlocked).catch(() => locked());
})();
