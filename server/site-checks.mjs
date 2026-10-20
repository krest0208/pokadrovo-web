const MAX_HTML = 512000;
const clean = value => String(value || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 400);

async function readText(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw Error('body limit'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
const attrs = tag => Object.fromEntries([...tag.matchAll(/([a-zA-Z][\w-]*)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));

/** Bounded public probes of the configured origin. Never use cookies, follow redirects or fetch arbitrary links. */
export async function checkSite({ origin, request, signal, facts }) {
  const checks = [];
  function add(key, label, status, detail, durationMs = null) { checks.push({ key, label, status, detail: clean(detail), durationMs }); }
  async function probe(path, method = 'GET', limit = 16000) {
    if (signal.aborted) throw Error('aborted');
    const url = new URL(path, origin); if (url.origin !== origin || !path.startsWith('/') || path.startsWith('//')) throw Error('origin');
    const started = Date.now();
    const response = await request(url.href, { method, redirect: 'manual', credentials: 'omit', headers: { Accept: method === 'HEAD' ? '*/*' : 'text/html,application/json', 'User-Agent': 'Pokadrovo-Site-Agent/1.0' }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    const text = method === 'GET' ? await readText(response, limit) : '';
    if (method === 'HEAD') await response.body?.cancel().catch(() => {});
    return { code: response.status, headers: response.headers, text, ms: Math.max(0, Date.now() - started) };
  }
  let home;
  try {
    home = await probe('/', 'GET', MAX_HTML);
    add('home-http', 'Главная страница', home.code === 200 ? 'ok' : home.code < 400 ? 'warning' : 'critical', `Проверка получила HTTP ${home.code}.`, home.ms);
  } catch { add('home-http', 'Главная страница', 'critical', 'Проверка не получила страницу за отведённое время. Доступность в браузере нужно подтвердить отдельно.'); }
  if (home?.code === 200) {
    if (!home.headers.get('content-type')?.includes('text/html')) add('home-type', 'Тип главной страницы', 'critical', 'Главная не возвращает Content-Type text/html.');
    if (home.ms > 3000) add('home-slow', 'Время ответа главной', 'warning', `Один замер: ${home.ms} мс. Это не оценка всех посещений.`, home.ms);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.text)?.[1]?.trim();
    add('page-title', 'Заголовок для поиска', title ? 'ok' : 'warning', title ? 'В HTML присутствует title.' : 'В HTML не найден title страницы.');
    const tags = [...home.text.matchAll(/<(?:meta|script|link)\b[^>]{0,3000}>/gi)].map(m => ({ tag: m[0], attrs: attrs(m[0]) }));
    const description = tags.find(t => t.attrs.name?.toLowerCase() === 'description')?.attrs.content;
    add('page-description', 'Описание для поиска', description?.trim() ? 'ok' : 'warning', description?.trim() ? 'В HTML есть описание страницы.' : 'В HTML не найдено непустое meta description.');
    add('mobile-viewport', 'Настройка мобильного экрана', tags.some(t => t.attrs.name?.toLowerCase() === 'viewport' && t.attrs.content?.includes('width=device-width')) ? 'ok' : 'warning', 'Проверено только наличие viewport. Вёрстка на реальном экране не оценивалась.');
    for (const [header, key] of [['content-security-policy', 'csp'], ['x-content-type-options', 'nosniff'], ['referrer-policy', 'referrer']])
      add('header-' + key, 'Заголовок ' + header, home.headers.has(header) ? 'ok' : 'warning', home.headers.has(header) ? 'Заголовок присутствует.' : 'Заголовок не найден в ответе главной.');
    if (origin.startsWith('https:')) add('header-hsts', 'Заголовок HSTS', home.headers.has('strict-transport-security') ? 'ok' : 'warning', home.headers.has('strict-transport-security') ? 'Заголовок присутствует.' : 'HSTS не найден в ответе HTTPS.');
    const assets = new Map();
    for (const item of tags) {
      const a = item.attrs, script = /^<script/i.test(item.tag), stylesheet = /\bstylesheet\b/i.test(a.rel || ''), icon = /\bicon\b/i.test(a.rel || '');
      if (!script && !stylesheet && !icon) continue;
      const raw = script ? a.src : a.href; if (!raw || raw.length > 512) continue;
      let url; try { url = new URL(raw.replaceAll('&amp;', '&'), origin); } catch { continue; }
      if (url.origin !== origin || !/^\/(?:assets\/[^?#]{1,400}|favicon\.svg|pokadrovo-logo\.svg)$/.test(url.pathname)) continue;
      const path = url.pathname + url.search; assets.set(path, script ? 'javascript' : stylesheet ? 'css' : 'image');
      if (assets.size >= 8) break;
    }
    add('build-entry', 'Подключение сборки', [...assets.values()].includes('javascript') ? 'ok' : 'warning', [...assets.values()].includes('javascript') ? 'Найден JavaScript-файл сборки.' : 'Не найден локальный JavaScript из /assets/. Возможно, используется сервер разработки или другая схема сборки.');
    for (const [path, kind] of assets) {
      try {
        const result = await probe(path, 'HEAD'), contentType = result.headers.get('content-type') || '';
        const ok = result.code === 200 && (kind === 'image' ? contentType.startsWith('image/') : contentType.includes(kind));
        add('asset:' + path.split('?')[0], 'Ресурс ' + path.split('?')[0], ok ? 'ok' : 'critical', `HTTP ${result.code}; ${ok ? 'тип соответствует ресурсу' : 'файл недоступен или имеет неожиданный тип'}.`, result.ms);
      } catch { add('asset:' + path.split('?')[0], 'Ресурс ' + path.split('?')[0], 'critical', 'Проверка ресурса не завершилась за отведённое время.'); }
    }
  }
  try {
    const health = await probe('/api/health'); let data; try { data = JSON.parse(health.text); } catch {}
    add('api-health', 'Серверное API', health.code === 200 && data?.ok === true ? 'ok' : 'critical', `HTTP ${health.code}; ${data?.ok === true ? 'health подтверждает работу API' : 'ожидаемый health-ответ не получен'}.`, health.ms);
  } catch { add('api-health', 'Серверное API', 'critical', 'Health-проверка не завершилась за отведённое время.'); }
  // HEAD is not used here: the private endpoint is intentionally tested with an anonymous GET.
  try {
    if (signal.aborted) throw Error('aborted');
    const result = await request(new URL('/api/account/projects', origin).href, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/json', 'User-Agent': 'Pokadrovo-Site-Agent/1.0' }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    await result.body?.cancel().catch(() => {});
    add('project-auth', 'Защита списка проектов', [401, 403].includes(result.status) ? 'ok' : result.status === 200 ? 'critical' : 'warning', `Анонимный запрос получил HTTP ${result.status}. Содержимое проектов не читалось.`);
  } catch { add('project-auth', 'Защита списка проектов', 'warning', 'Не удалось проверить ответ анонимному посетителю.'); }
  const failures = facts.aiHour?.failed || 0, attempts = facts.aiHour?.attempts || 0;
  add('ai-errors', 'ИИ-запросы за последний час', failures ? 'warning' : 'ok', `${attempts} попыток, ${failures} ошибок или прерываний. Отсутствие запросов не подтверждает доступность модели.`);
  const quota = facts.quota;
  if (quota && quota.used >= quota.limit * .8) add('ai-budget', 'Запас запросов OpenRouter', 'warning', `Сегодня использовано ${quota.used} из ${quota.limit} попыток сайта. Осталось ${quota.remaining}.`);
  return { checks, findings: checks.filter(c => ['warning', 'critical'].includes(c.status)).map(c => ({ key: c.key, severity: c.status, title: c.label, evidence: c.detail })),
    scope: ['Публичная главная и до восьми файлов сборки', 'Ответ API и анонимный доступ к списку проектов', 'Метаданные HTML и защитные заголовки', 'Агрегированные ошибки и квота ИИ'],
    notChecked: ['Визуальная вёрстка и действия в браузере', 'Фактический монтаж, экспорт и качество ИИ', 'Полный аудит безопасности и нагрузочное тестирование'] };
}
