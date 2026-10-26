import {createMail} from './email.mjs';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccounts } from './accounts.mjs';
import {createDatabaseCare} from './database-care.mjs';
import { createLegal, legalMissing } from './legal.mjs';
import { createBilling } from './billing.mjs';
import { createAi } from './ai.mjs';
import { createSiteAgent } from './site-agent.mjs';
import { OWNER_PATH } from './owner-route.mjs';
import { HttpError, deny, cookie, json, body } from './http.mjs';
import { openStore, token, digest, equal, checkPassword, hashPassword, newTotpSecret, verifyTotp } from './security.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const DAY = 86400000;
const isLoopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);

export function createApp(options = {}) {
  const singleAi = options.singleAi ?? true;
  const accountsEnabled = options.accountsEnabled ?? process.env.POKADROVO_ACCOUNTS_ENABLED === '1';
  const guestEditingEnabled = !accountsEnabled || (options.guestEditingEnabled ?? process.env.POKADROVO_GUEST_EDITING === '1');
  const socialLoginEnabled = accountsEnabled && (options.socialLoginEnabled ?? process.env.POKADROVO_SOCIAL_LOGIN_ENABLED === '1');
  const trustLoopbackProxy = options.trustLoopbackProxy ?? process.env.POKADROVO_TRUST_LOOPBACK_PROXY === '1';
  const origin = new URL(options.origin || process.env.POKADROVO_PUBLIC_ORIGIN || 'http://localhost:5173');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol)) throw Error('PUBLIC_ORIGIN must be an origin, without path or credentials.');
  const secure = origin.protocol === 'https:';
  if (!secure && !isLoopback(origin.hostname)) throw Error('Public origins require HTTPS. HTTP is allowed only on localhost.');
  const allowed = new Set([origin.origin]);
  if (!secure) for (const name of ['localhost', '127.0.0.1']) allowed.add(`http://${name}${origin.port ? ':' + origin.port : ''}`);
  const hosts = new Set([...allowed].map(s => new URL(s).host));
  const dist = resolve(options.dist || join(here, '../dist'));
  const buildServerDir = join(dist, 'server');
  const isBuildServerFile = file => file === buildServerDir || file.startsWith(buildServerDir + sep);
  const stateDir = resolve(options.dataDir || process.env.POKADROVO_DATA_DIR || join(here, '../.pokadrovo-private'));
  if (stateDir === dist || stateDir.startsWith(dist + sep) || stateDir === resolve(here, '../public') || stateDir.startsWith(resolve(here, '../public') + sep)) throw Error('Private data must be outside public web directories.');
  const store = openStore(stateDir);
  const now = options.now || Date.now;
  const sessionName = secure ? '__Host-pk-owner' : 'pk-owner-local';
  const visitorName = secure ? '__Host-pk-visitor' : 'pk-visitor-local';
  const settings = () => store.get('SELECT * FROM settings WHERE id=1');
  const owner = () => store.get('SELECT * FROM owner WHERE id=1');
  const ip = req => store.hmac(req.socket.remoteAddress || 'local'); // never trust arbitrary X-Forwarded-For
  let passwordWork = 0;
  async function verify(password, hash) {
    if (passwordWork >= 2) deny(429, 'Слишком много попыток. Повторите позже.');
    passwordWork++; try { return await checkPassword(password, hash); } finally { passwordWork--; }
  }
  const setCookie = (res, name, value, seconds) => res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
  const sameOrigin = req => { if (!allowed.has(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site') deny(403, 'Запрос разрешён только с этого сайта.'); };
  function session(req) {
    const value = cookie(req, sessionName);
    if (!/^[\w-]{43}$/.test(value)) deny(401, 'Войдите как администратор.');
    const s = store.get('SELECT * FROM sessions WHERE id=?', digest(value));
    if (!s || s.expires <= now() || s.last_seen <= now() - 30 * 60000) {
      if (s) store.run('DELETE FROM sessions WHERE id=?', s.id);
      deny(401, 'Сеанс завершён. Войдите снова.');
    }
    store.run('UPDATE sessions SET last_seen=? WHERE id=?', now(), s.id);
    return s;
  }
  function csrf(req, s) {
    sameOrigin(req);
    if (!equal(req.headers['x-csrf-token'], s.csrf)) deny(403, 'Проверка запроса не пройдена. Обновите страницу.');
  }
  async function reauth(req, data) {
    if (!store.consume('reauth:' + ip(req), 10, 15 * 60000, now())) deny(429, 'Слишком много попыток подтверждения.');
    const o = owner();
    if (!o || !await verify(data.password, o.password)) { store.audit('reauth_failed', 'denied', now()); deny(403, 'Неверный текущий пароль.'); }
    session(req);
    const fresh = owner();
    if (!fresh || !equal(fresh.password, o.password)) deny(401, 'Credentials changed. Sign in again.');
    return fresh;
  }
  async function authenticateOwner(req, res, data, publicEntry = false) {
    sameOrigin(req);
    const o = owner(); if (!o) deny(503, 'Администратор ещё не настроен. Запустите npm run admin:setup в терминале сервера.');
    const limit = store.consume('login:' + ip(req), 8, 15 * 60000, now());
    const globalLimit = store.consume('login-global', 30, 15 * 60000, now());
    if (!limit || !globalLimit) { res.setHeader('Retry-After', '900'); deny(429, 'Слишком много попыток. Подождите 15 минут.'); }
    const valid = await verify(data.password, o.password);
    const latest = owner();
    const unchanged = latest && equal(latest.password, o.password) && equal(latest.totp, o.totp) && equal(latest.login, o.login);
    if (publicEntry && valid && unchanged && equal(data.login, o.login) && o.totp && !data.code) {
      const challenge = new HttpError(401, 'Введите код из приложения-аутентификатора.');
      challenge.totpRequired = true; throw challenge;
    }
    let step = null;
    if (o.totp && valid && unchanged) step = verifyTotp(store.unseal(o.totp), data.code, now(), latest.last_step);
    if (!valid || !unchanged || !equal(data.login, o.login) || (o.totp && step === null)) {
      store.audit('login_failed', 'denied', now()); deny(401, publicEntry ? 'Неверная почта, логин или пароль.' : 'Неверный логин, пароль или код подтверждения.');
    }
    const sid = token(), csrfToken = token();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      // One owner, one active browser session. A new login revokes all earlier sessions.
      store.run('DELETE FROM sessions');
      store.run('INSERT INTO sessions(id,csrf,created,last_seen,expires) VALUES(?,?,?,?,?)', digest(sid), csrfToken, now(), now(), now() + 12 * 3600000);
      if (step !== null) store.run('UPDATE owner SET last_step=? WHERE id=1', step);
      store.audit('login', 'ok', now()); store.db.exec('COMMIT');
    } catch (e) { store.db.exec('ROLLBACK'); throw e; }
    setCookie(res, sessionName, sid, 12 * 3600);
    return { singleAi, login: o.login, csrf: csrfToken, totpEnabled: !!o.totp, accountsEnabled, socialLoginEnabled };
  }
let accounts;
  const legal = createLegal({store,now,origin:origin.origin,session:(...args)=>accounts.session(...args),sameOrigin});
  const mail=createMail({store,now,origin:origin.origin,legalReady:()=>legal.ready(),transportFactory:options.mailTransport});
  accounts = createAccounts({ legal, mail, store, now, origin: origin.origin, secure, sameOrigin, ownerSession: session, owner, ownerPath: OWNER_PATH, ownerLogin: (req, res, data) => authenticateOwner(req, res, { login: data.email, password: data.password, code: data.code }, true), reauthOwner: reauth, oauthFetch: options.oauthFetch, accountsEnabled, guestEditingEnabled, socialLoginEnabled, trustLoopbackProxy,
    revokeOwner(req, res) { const s = session(req); store.run('DELETE FROM sessions WHERE id=?', s.id); setCookie(res, sessionName, '', 0); }
  });  function visitor(req) {
    const [id, signature] = cookie(req, visitorName).split('.');
    return /^[\w-]{43}$/.test(id || '') && equal(signature, store.hmac('visitor:' + id)) ? id : null;
  }
  const databaseCare=createDatabaseCare({store,now,autoStart:options.backupsAutoStart??(secure&&accountsEnabled)});
  const billing = createBilling({store,now,origin:origin.origin,session:accounts.session,sameOrigin,legal,purchasesEnabled:!singleAi});
  const ai = createAi({ store, now, billing, settings, session: accounts.session, sameOrigin, rateKey: accounts.rateKey, request: options.aiFetch, singleAi });
  const siteAgent = createSiteAgent({ store, now, origin: origin.origin, session: accounts.session, sameOrigin,
    request: options.siteAgentFetch, autoStart: options.siteAgentAutoStart !== false, suggestIdeas: ai.suggestSiteIdeas,
    facts: () => ({ aiConfigured: !singleAi && ai.openrouter.state().configured && ai.openrouter.state().enabled, quota: ai.openrouter.quota(),
      aiHour: store.get("SELECT count(*) AS attempts,coalesce(sum(result IN ('failed','interrupted')),0) AS failed FROM ai_runs WHERE at>=? AND at<=?", now()-3600000, now()) }) });
  function overview(days) {
    const to = new Date(now()).toISOString().slice(0, 10), from = new Date(now() - (days - 1) * DAY).toISOString().slice(0, 10);
    const start = Date.parse(from + 'T00:00:00Z');
    const rows = store.all("SELECT substr(datetime(at/1000,'unixepoch'),1,10) day, kind, count(*) count FROM events WHERE at>=? AND at<=? GROUP BY day,kind", start, now());
    const requests = store.all('SELECT * FROM page_days WHERE day>=? AND day<=?', from, to);
    const series = Array.from({ length: days }, (_, i) => ({ day: new Date(start + i * DAY).toISOString().slice(0, 10), page_requests: 0, site_view: 0, editor_open: 0, project_saved: 0, export_completed: 0, ai_request: 0 }));
    for (const r of rows) { const day = series.find(d => d.day === r.day); if (day && r.kind in day) day[r.kind] = r.count; }
    for (const r of requests) { const day = series.find(d => d.day === r.day); if (day) day.page_requests = r.requests; }
    const sum = key => series.reduce((n, d) => n + d[key], 0);
    const unique = store.get('SELECT count(DISTINCT visitor) count FROM events WHERE at>=? AND at<=?', start, now()).count;
    const projects = store.get("SELECT count(DISTINCT project) count FROM events WHERE kind='project_saved' AND at>=? AND at<=?", start, now()).count;
    return { from, to, timezone: 'UTC', startedAt: Number(store.get('SELECT value FROM meta WHERE key=?', 'started').value), series,
      metrics: { pageRequests: sum('page_requests'), uniqueBrowsers: unique, visits: sum('site_view'), editorOpens: sum('editor_open'), projects, projectSaves: sum('project_saved'), exports: sum('export_completed'), aiRequests: sum('ai_request') },
      breakdown: { devices: store.all("SELECT device label,count(DISTINCT visitor) count FROM events WHERE kind='site_view' AND at>=? AND at<=? GROUP BY device", start, now()), modes: store.all("SELECT mode label,count(*) count FROM events WHERE kind='editor_open' AND at>=? AND at<=? GROUP BY mode", start, now()), formats: store.all("SELECT format label,count(*) count FROM events WHERE kind='export_completed' AND at>=? AND at<=? GROUP BY format", start, now()) },
      users: accounts.userMetrics(days), integrations: { users: accountsEnabled, payments: billing.catalog().available, aiProvider: ai.adminState().connected || ai.openrouter.adminState().connected || ai.yandex.adminState().connected },
      notes: ['Счётчик запросов включает обновления страницы и ботов. Это не число людей.', 'События и приблизительные уникальные браузеры учитываются только с согласия пользователя. DNT/GPC отключают события.', 'Данные начинаются с запуска этого сервера. История старого хостинга не импортирована.', 'Клиентские события не являются биллингом: их можно блокировать или подделывать.', 'Экспорт означает подготовленный файл и отправку на скачивание, а не подтверждённую загрузку в соцсеть.'] };
  }
  async function route(req, res) {
    const url = new URL(req.url || '/', origin);
    if (!hosts.has(req.headers.host)) deny(421, 'Неверный адрес сервера.');
    const path = url.pathname;
    if (path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && path === '/api/health') {const databaseReady=databaseCare.health();return json(res,databaseReady?200:503,{ok:databaseReady,databaseReady,analyticsEnabled:!!settings().analytics&&legal.ready()});}
    if (await legal.route(req, res, url)) return;
    if (await billing.route(req, res, url)) return;
    if (await siteAgent.route(req, res, url)) return;
    if (await accounts.route(req, res, url)) return;
    if(req.method==='POST'&&path==='/api/ai/edit-plan'&&!accounts.session(req).owner&&!legal.ready()) deny(503,'ИИ для пользователей временно недоступен: уточняются условия обработки данных.');
    if (await ai.route(req, res, url)) return;
    if (req.method === 'POST' && path === '/api/admin/login') return json(res, 200, await authenticateOwner(req, res, await body(req)));
    if (path.startsWith('/api/admin/')) {
      const s = session(req);
      if (!['GET', 'HEAD'].includes(req.method)) csrf(req, s);
      if (await accounts.adminRoute(req, res, url)) return;
      if(req.method==='GET'&&path==='/api/admin/mail')return json(res,200,mail.state());
      if(req.method==='PUT'&&path==='/api/admin/mail'){const data=await body(req,8192);await reauth(req,data);return json(res,200,mail.save(data));}
      if(req.method==='POST'&&path==='/api/admin/mail/test'){const data=await body(req,4096);await reauth(req,data);if(!store.consume('mail-owner-test',3,3600000,now()))deny(429,'Не более трёх тестов в час.');const {emailAddress}=await import('./email.mjs');const to=emailAddress(data.to);if(!to)deny(400,'Введите ваш адрес для тестового письма.');if(data.confirmed!==true)deny(400,'Подтвердите отправку на собственный адрес.');if(!mail.enqueue({kind:'test',to},now()+600000,{test:true}))deny(429,'Проверьте настройки почты и остаток бесплатной квоты.');return json(res,202,{queued:true});}
      if(req.method==='GET'&&path==='/api/admin/billing')return json(res,200,billing.adminState());
      if(req.method==='PUT'&&path==='/api/admin/billing'){const data=await body(req,32768);await reauth(req,data);return json(res,200,billing.save(data));}
      if(req.method==='GET'&&path==='/api/admin/billing/orders')return json(res,200,{items:billing.orders()});
      if(req.method==='POST'&&path==='/api/admin/billing/test-order')return json(res,201,billing.testOrder({key:'owner',owner:true},await body(req,4096)));
      if(req.method==='POST'&&path==='/api/admin/billing/refunds'){const data=await body(req,4096);await reauth(req,data);return json(res,200,billing.reconcileRefund(data));}
      if (req.method === 'GET' && path === '/api/admin/session') return json(res, 200, { singleAi, login: owner().login, csrf: s.csrf, totpEnabled: !!owner().totp, expires: s.expires, idleMinutes: 30, accountsEnabled, socialLoginEnabled });
      if (req.method === 'POST' && path === '/api/admin/logout') {
        store.run('DELETE FROM sessions WHERE id=?', s.id); store.audit('logout', 'ok', now()); setCookie(res, sessionName, '', 0); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/admin/overview') {
        const days = Number(url.searchParams.get('days') || 30); if (![7, 30, 90].includes(days)) deny(400, 'Допустимые периоды: 7, 30, 90 дней.');
        return json(res, 200, overview(days));
      }
      if (req.method === 'GET' && path === '/api/admin/audit') return json(res, 200, { items: store.all('SELECT at,action,result FROM audit ORDER BY id DESC LIMIT 100') });
      if (req.method === 'GET' && path === '/api/admin/settings') {
        const c = settings(); return json(res, 200, { provider: c.provider, model: c.model, keyConfigured: !!c.secret, updated: c.updated, analyticsEnabled: !!c.analytics, ...ai.adminState() });
      }
      if (req.method === 'GET' && path === '/api/admin/site-agent/status') return json(res, 200, siteAgent.status());
      if (req.method === 'GET' && path === '/api/admin/site-agent/reports') return json(res, 200, siteAgent.reports(url.searchParams.get('before') ?? undefined));
      if (req.method === 'GET' && path === '/api/admin/site-agent/ideas') return json(res, 200, siteAgent.ideas());
      if (req.method === 'PUT' && path === '/api/admin/site-agent/settings') { const data = await body(req); await reauth(req, data); return json(res, 200, siteAgent.settings(data)); }
      if (req.method === 'POST' && path === '/api/admin/site-agent/run') {
        await body(req, 2048); if (siteAgent.status().running) deny(409, 'Проверка уже выполняется.');
        if (!store.consume('site-agent-manual', 2, 60000, now())) deny(429, 'Повторите ручную проверку через минуту.');
        void siteAgent.run(true).catch(() => {}); return json(res, 202, { ok: true, ...siteAgent.status() });
      }
      if(req.method==='GET'&&path==='/api/admin/database')return json(res,200,{...databaseCare.inspect(),registration:{accountsEnabled,guestEditingEnabled,legalReady:legal.ready(),missing:legalMissing(legal.config())}});
      if(req.method==='POST'&&path==='/api/admin/database/backup'){const data=await body(req,4096);await reauth(req,data);if(!store.consume('backup-manual',3,3600000,now()))deny(429,'Копия уже запрошена. Повторите позднее.');return json(res,200,await databaseCare.snapshot());}
      if (req.method === 'GET' && path === '/api/admin/legal') return json(res,200,{config:legal.config(),...legal.state(),requests:legal.requests()});
      if (req.method === 'PUT' && path === '/api/admin/legal') {const data=await body(req,65536);await reauth(req,data);return json(res,200,legal.save(data));}
      if (req.method === 'GET' && path === '/api/admin/ai/usage') return json(res, 200, { items: ai.usage() });
      if (req.method === 'GET' && path === '/api/admin/ai/analytics') return json(res, 200, ai.analytics(Number(url.searchParams.get('days') || 7)));
      if (req.method === 'GET' && path === '/api/admin/ai/openrouter') return json(res, 200, ai.openrouter.adminState());
      if (req.method === 'GET' && path === '/api/admin/ai/openrouter/catalog') {
        if (!store.consume('ai-catalog-owner', 2, 60000, now())) deny(429, 'Повторите проверку каталога через минуту.');
        return json(res, 200, await ai.openrouter.catalog());
      }
      if (req.method === 'PUT' && path === '/api/admin/ai/openrouter') { const data = await body(req); await reauth(req, data); return json(res, 200, { ok: true, ...ai.openrouter.save(data) }); }
      if (req.method === 'GET' && path === '/api/admin/ai/yandex') return json(res, 200, ai.yandex.adminState());
      if (req.method === 'PUT' && path === '/api/admin/ai/yandex') { const data = await body(req); await reauth(req, data); return json(res, 200, { ok: true, ...ai.yandex.save(data) }); }
      if (req.method === 'PUT' && path === '/api/admin/settings') {
        const data = await body(req); await reauth(req, data);
        const old = settings();
        if (!['openai', 'anthropic', 'google', 'custom', 'qwen'].includes(data.provider) || typeof data.model !== 'string' || !/^[\w./:-]{0,120}$/.test(data.model)) deny(400, 'Проверьте провайдера и имя модели.');
        if (typeof data.analyticsEnabled !== 'boolean') deny(400, 'Некорректная настройка аналитики.');
        let secret = old.secret;
        if (data.removeKey === true) secret = null;
        else if (data.apiKey !== undefined && data.apiKey !== '') {
          if (typeof data.apiKey !== 'string' || !/^[\x21-\x7e]{12,4096}$/.test(data.apiKey)) deny(400, 'Ключ должен содержать 12-4096 символов без пробелов и переносов строк.');
          secret = store.seal(data.apiKey);
        } else if (data.provider !== old.provider && old.secret) deny(400, 'Для другого провайдера укажите новый ключ или удалите прежний.');
        const saveAi = ai.saveConfig(data, { provider: data.provider, model: data.model, secret });
        store.db.exec('BEGIN IMMEDIATE');
        try { store.run('UPDATE settings SET provider=?,model=?,secret=?,updated=?,analytics=? WHERE id=1', data.provider, data.model, secret, now(), Number(data.analyticsEnabled)); saveAi(); store.db.exec('COMMIT'); }
        catch (error) { store.db.exec('ROLLBACK'); throw error; }
        store.audit(data.removeKey ? 'api_key_removed' : 'settings_updated', 'ok', now());
        return json(res, 200, { ok: true, keyConfigured: !!secret, ...ai.adminState() });
      }
      if (req.method === 'POST' && path === '/api/admin/password') {
        const data = await body(req); await reauth(req, data);
const newLogin = data.newLogin === undefined || data.newLogin === '' ? owner().login : data.newLogin;
        if (typeof newLogin !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(newLogin)) deny(400, 'Логин: 3-64 латинских символа, цифры, точка, дефис или подчёркивание.');
        const before = owner().password; let hash = before;
        if (data.newPassword) {
          if (!equal(data.newPassword, data.confirmPassword)) deny(400, 'Пароли не совпадают.');
          try { hash = await hashPassword(data.newPassword); } catch (e) { deny(400, e.message); }
        } else if (newLogin === owner().login) deny(400, 'Укажите новый логин или пароль.');
        session(req);
        if (!equal(owner().password, before)) deny(401, 'Данные доступа уже изменились. Войдите снова.');
        store.run('UPDATE owner SET password=?,login=? WHERE id=1', hash, newLogin); store.run('DELETE FROM sessions'); store.audit('password_changed', 'ok', now());
        setCookie(res, sessionName, '', 0); return json(res, 200, { ok: true, reauthenticate: true });
      }      if (req.method === 'POST' && path === '/api/admin/totp/begin') {
        const data = await body(req); const o = await reauth(req, data); if (o.totp) deny(409, 'Двухэтапный вход уже включён.');
        const secret = newTotpSecret(); store.run('UPDATE sessions SET pending_totp=?,pending_until=? WHERE id=?', store.seal(secret), now() + 10 * 60000, s.id);
        return json(res, 200, { secret, issuer: 'Pokadrovo', login: o.login, expiresIn: 600 });
      }
      if (req.method === 'POST' && path === '/api/admin/totp/confirm') {
        const data = await body(req);
        if (!store.consume('totp:' + s.id, 6, 10 * 60000, now())) deny(429, 'Слишком много кодов. Начните настройку позднее.');
        const pending = session(req); csrf(req, pending);
        if (owner().totp) deny(409, 'TOTP is already enabled.');
        if (!pending.pending_totp || pending.pending_until < now()) deny(400, 'Начните настройку заново.');
        const step = verifyTotp(store.unseal(pending.pending_totp), data.code, now());
        if (step === null) deny(400, 'Код не подошёл. Проверьте время на телефоне.');
        store.run('UPDATE owner SET totp=?,last_step=? WHERE id=1', pending.pending_totp, step);
        store.run('UPDATE sessions SET pending_totp=NULL,pending_until=NULL WHERE id=?', s.id);
        store.audit('totp_enabled', 'ok', now()); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/admin/totp/disable') {
        const data = await body(req); const o = await reauth(req, data);
        if (!o.totp || verifyTotp(store.unseal(o.totp), data.code, now(), o.last_step) === null) deny(403, 'Неверный код подтверждения.');
        store.run('UPDATE owner SET totp=NULL,last_step=-1 WHERE id=1'); store.audit('totp_disabled', 'ok', now()); return json(res, 200, { ok: true });
      }
      deny(404, 'Метод не найден.');
    }
    if (req.method === 'POST' && path.startsWith('/api/metrics/')) {
      sameOrigin(req); if (req.headers['x-pk-metrics'] !== '1') deny(403, 'Некорректный запрос.');
      if (!store.consume('metrics:' + ip(req), 120, 60000, now())) deny(429, 'Повторите позднее.');
      if (path === '/api/metrics/forget') {
        const v = visitor(req); if (v) store.run('DELETE FROM events WHERE visitor=?', store.hmac('metric:' + v));
        setCookie(res, visitorName, '', 0); return json(res, 200, { ok: true });
      }
      if (!settings().analytics || !legal.ready() || req.headers.dnt === '1' || req.headers['sec-gpc'] === '1') return json(res, 200, { disabled: true });
      const data = await body(req, 2048);
      if (path === '/api/metrics/start') {
        if (data.consent !== true) deny(400, 'Нужно согласие на анонимные события.');
        const v = visitor(req) || token(); setCookie(res, visitorName, v + '.' + store.hmac('visitor:' + v), 90 * 86400); return json(res, 200, { ok: true });
      }
      if (path === '/api/metrics/event') {
        const v = visitor(req); if (!v) deny(401, 'Сначала подтвердите настройку аналитики.');
        const kinds = ['site_view', 'editor_open', 'project_saved', 'export_completed', 'ai_request'];
        if (!kinds.includes(data.kind) || typeof data.id !== 'string' || !/^[\w-]{16,80}$/.test(data.id)) deny(400, 'Неверное событие.');
        const project = typeof data.project === 'string' && /^[\w.-]{1,120}$/.test(data.project) ? store.hmac(v + ':' + data.project) : null;
        if (data.kind === 'project_saved' && !project) deny(400, 'Нет идентификатора проекта.');
        const mode = ['video', 'reels'].includes(data.mode) ? data.mode : 'unknown';
        const format = ['webm', 'mp4'].includes(data.format) ? data.format : 'unknown';
        const source = ['direct', 'social', 'search', 'other'].includes(data.source) ? data.source : 'direct';
        const device = ['desktop', 'mobile', 'tablet'].includes(data.device) ? data.device : 'unknown';
        store.run('INSERT OR IGNORE INTO events(id,at,kind,visitor,project,mode,format,source,device) VALUES(?,?,?,?,?,?,?,?,?)', digest(v + ':' + data.id), now(), data.kind, store.hmac('metric:' + v), project, mode, format, source, device);
        return json(res, 200, { ok: true });
      }
      deny(404, 'Метод не найден.');
    }
    if (path.startsWith('/api/')) deny(404, 'Метод не найден.');
    if (!['GET', 'HEAD'].includes(req.method)) deny(405, 'Метод не поддерживается.');
    let pagePath; try { pagePath = decodeURIComponent(path); } catch { deny(400, 'Некорректный адрес.'); }
    if(pagePath==='/pricing'||pagePath==='/pricing/'){res.writeHead(308,{Location:'/ai','Cache-Control':'no-store'});res.end();return;}
    if (pagePath === '/admin' || pagePath.startsWith('/admin/')) deny(404, 'Не найдено.');
    if (pagePath === OWNER_PATH || pagePath === OWNER_PATH + '/') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return sendFile(res, join(here, 'public/admin.html'), 'text/html; charset=utf-8', req.method);
    }
    if(pagePath==='/account/email'){res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');return sendFile(res,join(here,'public/email.html'),'text/html; charset=utf-8',req.method);}
    const mailAssets={'/account-mail/email.js':['email.js','text/javascript; charset=utf-8'],'/account-mail/email.css':['email.css','text/css; charset=utf-8']};
    if(mailAssets[path])return sendFile(res,join(here,'public',mailAssets[path][0]),mailAssets[path][1],req.method);
    if(path === '/legal-assets/legal.css' && ['GET','HEAD'].includes(req.method)) return sendFile(res,join(here,'public/legal.css'),'text/css; charset=utf-8',req.method);
    const adminAssets = { '/owner-assets/admin.css': ['admin.css', 'text/css; charset=utf-8'], '/owner-assets/admin.js': ['admin.js', 'text/javascript; charset=utf-8'] };
    if (adminAssets[path]) return sendFile(res, join(here, 'public', adminAssets[path][0]), adminAssets[path][1], req.method);
    if (accountsEnabled && (pagePath === '/profile' || !guestEditingEnabled && ['/studio', '/projects'].includes(pagePath)) && !accounts.session(req, false)) { res.writeHead(303, { Location: '/?auth=login' }); res.end(); return; }
    let decoded; try { decoded = decodeURIComponent(path); if (['/studio','/profile','/projects','/ai','/ai/'].includes(decoded)) decoded = '/'; } catch { deny(400, 'Некорректный адрес.'); }
    if(decoded==='/server'||decoded.startsWith('/server/'))deny(404,'Не найдено.');
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(s => s.startsWith('.'))) deny(404, 'Не найдено.');
    const target = resolve(dist, '.' + (decoded === '/' ? '/index.html' : decoded));
    // Check the resolved filesystem destination as well as the URL spelling.
    // Encoded leading slashes and public symlink aliases must not expose build-only bundles.
    if (!target.startsWith(dist + sep) || isBuildServerFile(target)) deny(404, 'Не найдено.');
    let real; try { real = await realpath(target); } catch { deny(404, 'Файл не найден. Для сайта сначала выполните npm run build.'); }
    if (!real.startsWith(dist + sep) || isBuildServerFile(real)) deny(404, 'Не найдено.');
    if (req.method === 'GET' && decoded === '/' && settings().analytics) {
      const day = new Date(now()).toISOString().slice(0, 10);
      store.run('INSERT INTO page_days(day,requests) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET requests=requests+1', day);
    }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' }[extname(real)] || 'application/octet-stream';
    return sendFile(res, real, mime, req.method);
  }
  async function sendFile(res, file, type, method) {
    const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(method === 'HEAD' ? undefined : bytes);
  }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    void route(req, res).catch(error => { if (res.headersSent || res.destroyed) return; json(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Ошибка сервера. Подробности не публикуются.', ...(error instanceof HttpError && error.totpRequired === true ? { totpRequired: true } : {}) }); });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  store.cleanup(now()); const housekeeping = setInterval(() => { store.cleanup(now()); accounts.cleanup(); }, 300000); housekeeping.unref();
  server.on('listening', () => {siteAgent.start();databaseCare.start();if(options.mailAutoStart!==false)mail.start();});
  server.on('close', () => { clearInterval(housekeeping); siteAgent.stop(); ai.stop(); const pending=[databaseCare.stop(),mail.stop()].filter(Boolean);if(pending.length)void Promise.allSettled(pending).finally(()=>store.close());else store.close(); });
  return { server, store, siteAgent, databaseCare, mail, origin: origin.origin };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.POKADROVO_PORT || 5173), host = process.env.POKADROVO_HOST || '127.0.0.1';
  const app = createApp();
  if (!isLoopback(host) && !app.origin.startsWith('https://')) throw Error('Binding to a public interface requires a configured HTTPS origin.');
  app.server.listen(port, host, () => console.log(`Pokadrovo: ${app.origin}\nOwner login: ${app.origin}${OWNER_PATH}\nNo cloud deployment performed.`));
}
