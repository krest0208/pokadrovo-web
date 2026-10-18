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
    for (const id of ['metrics', 'chart', 'chart-table', 'pipeline', 'audit-body', 'breakdowns', 'metric-notes', 'users-body']) $(id).replaceChildren();
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
    document.querySelector('[data-view="oauth"]').hidden = data.accountsEnabled === false;
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
  const titles = { users: '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438', oauth: 'Google / Facebook / Instagram', overview: 'Обзор и статистика', api: 'Подключение нейросети', security: 'Защита доступа', audit: 'Журнал действий' };
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
    if (view === 'users') await loadUsers();
    if (view === 'oauth') await loadOAuth();
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
    const m = data.metrics; text($('period-note'), `${data.from} — ${data.to} · UTC · сбор с ${new Date(data.startedAt).toLocaleDateString('ru-RU')}`);
const accountCards = data.users ? [['Зарегистрировано за период', data.users.registered, 'По базе аккаунтов'], ['Всего пользователей', data.users.total, 'Без учётной записи владельца']] : [];
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
  async function loadSettings() {
    settings = await request('/settings'); if (!owner) return;
    const form = $('settings-form'); form.elements.provider.value = settings.provider; form.elements.model.value = settings.model;
    form.elements.apiKey.value = ''; form.elements.password.value = ''; form.elements.removeKey.checked = false; form.elements.analyticsEnabled.checked = settings.analyticsEnabled;
    text($('key-status'), settings.keyConfigured ? 'Ключ сохранён на сервере' : 'Ключ не указан');
    text($('ai-connection-status'), 'Не подключена');
  }
  bindForm('settings-form', async (data, form) => {
    data.analyticsEnabled = form.elements.analyticsEnabled.checked; data.removeKey = form.elements.removeKey.checked;
    if (data.removeKey && !confirm('Удалить API-ключ с сервера?')) return;
    await request('/settings', { method: 'PUT', data }); form.reset(); await loadSettings(); notify('Настройки сохранены. Ключ не проверялся у провайдера, ИИ не запускался.');
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
  const auditNames = { owner_created: 'Владелец создан', owner_reset: 'Восстановление через терминал', login: 'Успешный вход', login_failed: 'Неудачная попытка входа', logout: 'Выход', reauth_failed: 'Неудачное подтверждение пароля', settings_updated: 'Настройки обновлены', api_key_removed: 'API-ключ удалён', password_changed: 'Пароль изменён', totp_enabled: 'Второй фактор включён', totp_disabled: 'Второй фактор отключён' };
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
