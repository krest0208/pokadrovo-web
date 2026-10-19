import { createHash } from 'node:crypto';
import { token, digest, equal, hashPassword, checkPassword, validatePassword } from './security.mjs';
import { cookie, json, deny, body, appendCookie } from './http.mjs';
import { PROVIDERS, authorizeUrl, createOAuthClient } from './oauth.mjs';

const DAY = 86400000;
const emailOf = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const nameOf = value => typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : '';
const sidOk = value => /^[\w-]{43}$/.test(value);
const projectIdOk = value => typeof value === 'string' && /^[\w.-]{1,120}$/.test(value);
const profile = row => ({ id: row.id, name: row.name, email: row.email, emailVerified: !!row.email_verified, role: 'user', created: row.created, passwordSet: !!row.password });

export function createAccounts({ store, now, origin, secure, sameOrigin, ownerSession, owner, revokeOwner, reauthOwner, oauthFetch, accountsEnabled = false, guestEditingEnabled = !accountsEnabled, socialLoginEnabled = false }) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password TEXT, email_verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(provider,subject));
    CREATE TABLE IF NOT EXISTS user_sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_config(provider TEXT PRIMARY KEY, client_id TEXT NOT NULL DEFAULT '', secret TEXT, version TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS oauth_states(id TEXT PRIMARY KEY, binding TEXT NOT NULL, provider TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_projects(account_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, modified INTEGER NOT NULL, PRIMARY KEY(account_id,id));
    CREATE INDEX IF NOT EXISTS users_created ON users(created);
    CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);
  `);
  for (const p of PROVIDERS) store.run('INSERT OR IGNORE INTO oauth_config(provider) VALUES(?)', p);
  const sessionName = secure ? '__Host-pk-user' : 'pk-user-local';
  const csrfName = secure ? '__Host-pk-auth-csrf' : 'pk-auth-csrf-local';
  const bindName = secure ? '__Host-pk-oauth-bind' : 'pk-oauth-bind-local';
  const oauth = createOAuthClient(oauthFetch);
  let passwordWork = 0;
  async function passwordJob(job) { if (passwordWork >= 2) deny(429, 'Сервер обрабатывает вход. Повторите через несколько секунд.'); passwordWork++; try { return await job(); } finally { passwordWork--; } }
  const ip = req => store.hmac('accounts-ip:' + (req.socket.remoteAddress || 'local'));
  function limit(req, type, count = 12, ms = 15 * 60000) { if (!store.consume(type + ':' + ip(req), count, ms, now())) deny(429, 'Слишком много попыток. Попробуйте позднее.'); }
  function cleanup() {
    store.run('DELETE FROM oauth_states WHERE expires<=?', now());
    store.run('DELETE FROM user_sessions WHERE expires<=? OR last_seen<?', now(), now() - DAY);
  }
  function session(req, required = true) {
    try { const s = ownerSession(req), o = owner(); if (o) return { csrf: s.csrf, key: 'owner', owner: true, session: s, user: { id: 'owner', name: o.login, email: null, emailVerified: false, role: 'owner', created: o.created, passwordSet: true } }; }
    catch (e) { if (e.status !== 401) throw e; }
    if (!accountsEnabled) { if (required) deny(401, 'Для серверных данных требуется вход владельца.'); return null; }
    const raw = cookie(req, sessionName);
    if (sidOk(raw)) {
      const s = store.get('SELECT s.*,u.name,u.email,u.email_verified,u.password,u.status,u.created AS user_created FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?', digest(raw));
      if (s && s.status === 'active' && s.expires > now() && s.last_seen > now() - DAY) {
        store.run('UPDATE user_sessions SET last_seen=? WHERE id=?', now(), s.id);
        return { key: s.user_id, csrf: s.csrf, owner: false, session: s, user: profile({ ...s, id: s.user_id, created: s.user_created }) };
      }
      if (s) store.run('DELETE FROM user_sessions WHERE id=?', s.id);
    }
    if (required) deny(401, 'Войдите в аккаунт, чтобы продолжить.');
    return null;
  }
  function anonymousCsrf(req, res) {
    const value = cookie(req, csrfName), [timestamp, id, signature] = value.split('.');
    if (sidOk(id || '') && /^\d{13}$/.test(timestamp || '') && +timestamp < now() + 30000 && +timestamp > now() - 3600000 && equal(signature, store.hmac('auth-csrf:' + timestamp + '.' + id))) return value;
    const stamp = String(now()), random = token(), result = stamp + '.' + random + '.' + store.hmac('auth-csrf:' + stamp + '.' + random);
    appendCookie(res, csrfName, result, 3600, secure); return result;
  }
  function mutation(req, auth) { sameOrigin(req); if (!equal(req.headers['x-csrf-token'], auth.csrf)) deny(403, 'Обновите страницу и повторите действие.'); }
  function publicMutation(req) {
    sameOrigin(req); const value = cookie(req, csrfName), [stamp, random, sign] = value.split('.');
    if (!sidOk(random || '') || !/^\d{13}$/.test(stamp || '') || +stamp <= now() - 3600000 || +stamp > now() + 30000 || !equal(sign, store.hmac('auth-csrf:' + stamp + '.' + random)) || !equal(value, req.headers['x-csrf-token'])) deny(403, 'Откройте форму входа заново.');
  }
  function providers() { if (!socialLoginEnabled) return []; return store.all('SELECT * FROM oauth_config').map(c => {
    const ready = !!(c.enabled && c.client_id && c.secret && (c.provider === 'google' || (secure && c.version)));
    return { id: c.provider, ready, professionalOnly: c.provider === 'instagram', note: !c.enabled || !c.client_id || !c.secret ? 'Владелец ещё не подключил этот способ входа.' : c.provider !== 'google' && !secure ? 'Для Meta требуется настроенный HTTPS-домен.' : c.provider !== 'google' && !c.version ? 'Укажите версию API Meta в админ-панели.' : c.provider === 'instagram' ? 'Только профессиональные аккаунты Instagram: Business / Creator.' : '' };
  }); }
  function startSession(res, user) {
    const sid = token(), csrf = token();
    store.run('INSERT INTO user_sessions(id,user_id,csrf,created,last_seen,expires) VALUES(?,?,?,?,?,?)', digest(sid), user.id, csrf, now(), now(), now() + 7 * DAY);
    store.run('UPDATE users SET last_login=? WHERE id=?', now(), user.id);
    // Bound active devices; invalidate oldest ones after five sessions.
    store.run('DELETE FROM user_sessions WHERE user_id=? AND id NOT IN (SELECT id FROM user_sessions WHERE user_id=? ORDER BY created DESC LIMIT 5)', user.id, user.id);
    appendCookie(res, sessionName, sid, 7 * 86400, secure);
    return { user: profile(user), csrf, providers: providers(), accountsEnabled, guestEditingEnabled, socialLoginEnabled };
  }
  function listProjects(auth) { return store.all('SELECT payload FROM account_projects WHERE account_id=? ORDER BY modified DESC LIMIT 200', auth.key).map(r => JSON.parse(r.payload)); }
  // Only document metadata is stored: never a Blob, object URL, credential or executable HTML.
  function projectDocument(p) {
    if (!p || typeof p !== 'object' || !projectIdOk(p.id)) deny(400, 'Некорректный проект.');
    for (const key of ['clips', 'audio', 'texts']) if (!Array.isArray(p[key]) || p[key].length > 1000) deny(400, 'Слишком много элементов проекта.');
    const clipKeys = 'id assetId name kind duration start end speed volume muted fadeIn fadeOut at fit zoom x y rotation flip brightness contrast saturation opacity visualIn visualOut scaleX scaleY shape corner cropLeft cropRight cropTop cropBottom'.split(' ');
    const textKeys = 'id text from to x y size color background fontId weight italic align'.split(' ');
    function pick(o, keys) { if (!o || typeof o !== 'object') deny(400, 'Некорректный элемент.'); const r = {}; for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v.length <= 10000 || typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean') r[k] = v; } return r; }
    return { ...pick(p, ['id','name','schema','mode','ratio','title','brief','created','modified','master']), clips: p.clips.map(c => pick(c, clipKeys)), audio: p.audio.map(c => pick(c, clipKeys)), texts: p.texts.map(c => pick(c, textKeys)) };
  }

  async function route(req, res, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/account/') && !path.startsWith('/auth/')) return false;
    cleanup();
    if (req.method === 'GET' && path === '/api/account/session') {
      const a = session(req, false); const csrf = a?.csrf || (accountsEnabled ? anonymousCsrf(req, res) : '');
      json(res, 200, { user: a?.user || null, csrf, providers: accountsEnabled ? providers() : [], accountsEnabled, guestEditingEnabled, socialLoginEnabled }); return true;
    }
    if (!socialLoginEnabled && (path.startsWith('/api/account/oauth/') || path.startsWith('/auth/'))) deny(404, 'Этот способ входа отключён. Используйте почту и пароль.');
    if (!accountsEnabled && (['/api/account/register', '/api/account/login'].includes(path) || path.startsWith('/api/account/oauth/') || path.startsWith('/auth/'))) deny(404, 'Регистрация и вход посетителей отключены. Монтажёр доступен без аккаунта.');
    if (req.method === 'POST' && (path === '/api/account/register' || path === '/api/account/login')) {
      publicMutation(req); limit(req, 'user-auth');
      if (!store.consume('user-auth-global', 100, 15 * 60000, now())) deny(429, 'Попробуйте войти позднее.');
      const data = await body(req), email = emailOf(data.email);
      if (!email) deny(400, 'Введите корректный адрес почты.');
      if (path.endsWith('/register')) {
        const name = data.name === undefined ? 'Автор' : nameOf(data.name); if (name.length < 2) deny(400, 'Имя должно содержать не менее двух символов.');
        try { validatePassword(data.password); } catch (e) { deny(400, e.message); }
        if (!equal(data.password, data.confirmPassword)) deny(400, 'Пароли не совпадают.');
        if (data.acceptPrivacy !== true) deny(400, 'Подтвердите ознакомление с условиями хранения данных.');
        const password = await passwordJob(() => hashPassword(data.password));
        // Check uniqueness again after the asynchronous password hash.
        if (store.get('SELECT id FROM users WHERE email=?', email)) deny(409, 'Этот адрес уже занят. Войдите или используйте другую почту.');
        const id = token(); store.run('INSERT INTO users(id,email,name,password,created,last_login) VALUES(?,?,?,?,?,?)', id, email, name, password, now(), now());
        store.audit('user_registered', 'ok', now());
        json(res, 201, startSession(res, store.get('SELECT * FROM users WHERE id=?', id))); return true;
      }
      const u = store.get('SELECT * FROM users WHERE email=?', email);
      // A dummy derived hash avoids a fast user-enumeration path.
      const dummy = 'scrypt$131072$8$1$' + '0'.repeat(32) + '$' + '0'.repeat(128);
      const valid = await passwordJob(() => checkPassword(data.password, u?.password || dummy));
      const fresh = u ? store.get('SELECT * FROM users WHERE id=?', u.id) : null;
      if (!valid || !fresh || fresh.status !== 'active' || !equal(fresh.password, u.password)) { store.audit('user_login_failed', 'denied', now()); deny(401, 'Неверная почта или пароль.'); }
      store.audit('user_login', 'ok', now()); json(res, 200, startSession(res, fresh)); return true;
    }
    if (req.method === 'POST' && path.startsWith('/api/account/oauth/')) {
      publicMutation(req); limit(req, 'oauth-start', 20, 600000);
      const provider = path.split('/').at(-1), c = store.get('SELECT * FROM oauth_config WHERE provider=?', provider);
      if (!PROVIDERS.includes(provider) || !providers().find(p => p.id === provider)?.ready) deny(503, 'Этот способ входа пока не настроен. Используйте почту и пароль.');
      let binding = cookie(req, bindName); if (!sidOk(binding)) binding = token();
      const state = token(), verifier = token(), nonce = token();
      const redirect = origin + '/auth/' + provider + '/callback';
      store.run('INSERT INTO oauth_states(id,binding,provider,payload,created,expires) VALUES(?,?,?,?,?,?)', digest(state), digest(binding), provider, store.seal(JSON.stringify({ verifier, nonce, redirect, updated: c.updated })), now(), now() + 600000);
      appendCookie(res, bindName, binding, 600, secure);
      json(res, 200, { url: authorizeUrl(provider, { clientId: c.client_id, graphVersion: c.version }, redirect, state, createHash('sha256').update(verifier).digest('base64url'), nonce) }); return true;
    }
    if (req.method === 'GET' && /^\/auth\/(google|facebook|instagram)\/callback$/.test(path)) {
      const provider = path.split('/')[2], state = url.searchParams.get('state') || '', bind = cookie(req, bindName);
      const pending = sidOk(state) ? store.get('SELECT * FROM oauth_states WHERE id=?', digest(state)) : null;
      const redirectError = () => { res.writeHead(303, { Location: '/?auth=login&authError=provider' }); res.end(); return true; };
      if (!pending || pending.provider !== provider || pending.expires <= now() || !sidOk(bind) || !equal(pending.binding, digest(bind))) return redirectError();
      store.run('DELETE FROM oauth_states WHERE id=?', pending.id); // exactly once
      if (url.searchParams.has('error')) return redirectError();
      const code = url.searchParams.get('code'); if (!code || code.length > 4096) return redirectError();
      try {
        const c = store.get('SELECT * FROM oauth_config WHERE provider=?', provider), payload = JSON.parse(store.unseal(pending.payload));
        if (!c?.enabled || !c.secret || c.updated !== payload.updated) return redirectError();
        const identity = await oauth.exchange(provider, { clientId: c.client_id, clientSecret: store.unseal(c.secret), graphVersion: c.version }, code, payload.redirect, payload.verifier, payload.nonce, now());
        const freshConfig = store.get('SELECT * FROM oauth_config WHERE provider=?', provider);
        if (!freshConfig?.enabled || freshConfig.updated !== c.updated) return redirectError();
        if (typeof identity.subject !== 'string' || !identity.subject || identity.subject.length > 255) throw Error('Invalid identity');
        let u = store.get('SELECT u.* FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?', provider, identity.subject);
        if (!u) {
          // Do not silently link by email: that can take over an existing account.
          let email = emailOf(identity.email); if (email && store.get('SELECT id FROM users WHERE email=?', email)) email = null;
          const id = token(); store.db.exec('BEGIN IMMEDIATE');
          try { store.run('INSERT INTO users(id,email,name,email_verified,created,last_login) VALUES(?,?,?,?,?,?)', id, email, nameOf(identity.name) || 'Автор', Number(!!email && identity.emailVerified), now(), now()); store.run('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)', provider, identity.subject, id); store.audit('user_registered_oauth', 'ok', now()); store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; }
          u = store.get('SELECT * FROM users WHERE id=?', id);
        }
        if (u.status !== 'active') return redirectError();
        startSession(res, u); res.writeHead(303, { Location: '/?signedIn=1' }); res.end(); return true;
      } catch { store.audit('oauth_failed', 'denied', now()); return redirectError(); }
    }
    const a = session(req);
    if (path.startsWith('/api/account/projects') && !equal(req.headers['x-pk-account'], a.key)) deny(409, 'Account changed. Reload the project list.');
    if (!['GET','HEAD'].includes(req.method)) mutation(req, a);
    if (req.method === 'POST' && path === '/api/account/logout') {
      if (a.owner) revokeOwner(req, res); else store.run('DELETE FROM user_sessions WHERE id=?', a.session.id);
      appendCookie(res, sessionName, '', 0, secure); json(res, 200, { ok: true }); return true;
    }
    if (req.method === 'PATCH' && path === '/api/account/profile') {
      if (a.owner) deny(400, 'Имя владельца меняется в админ-панели: Защита доступа.');
      const data = await body(req), name = nameOf(data.name); if (name.length < 2) deny(400, 'Имя должно содержать не менее двух символов.');
      store.run('UPDATE users SET name=? WHERE id=?', name, a.key); json(res, 200, { user: profile(store.get('SELECT * FROM users WHERE id=?', a.key)) }); return true;
    }
    if (req.method === 'POST' && path === '/api/account/password') {
      if (a.owner) deny(400, 'Пароль владельца меняется в админ-панели.'); limit(req, 'user-password', 8);
      const data = await body(req), u = store.get('SELECT * FROM users WHERE id=?', a.key);
      if (!u.password) deny(400, 'У этого аккаунта вход через соцсеть. Локальный пароль не настроен.');
      if (!await passwordJob(() => checkPassword(data.password, u.password))) deny(403, 'Текущий пароль не подошёл.');
      if (!equal(data.newPassword, data.confirmPassword)) deny(400, 'Пароли не совпадают.');
      try { validatePassword(data.newPassword); } catch (e) { deny(400, e.message); }
      const hash = await passwordJob(() => hashPassword(data.newPassword));
      const fresh = session(req); if (fresh.key !== a.key || !equal(store.get('SELECT password FROM users WHERE id=?', a.key).password, u.password)) deny(401, 'Сеанс изменился. Войдите снова.');
      store.run('UPDATE users SET password=? WHERE id=?', hash, a.key); store.run('DELETE FROM user_sessions WHERE user_id=?', a.key);
      appendCookie(res, sessionName, '', 0, secure); json(res, 200, { ok: true, reauthenticate: true }); return true;
    }
    if (req.method === 'GET' && path === '/api/account/projects') { json(res, 200, { projects: listProjects(a), mediaLocalOnly: true }); return true; }
    if (req.method === 'PUT' && path === '/api/account/projects') {
      limit(req, 'save-project', 120, 60000); const data = await body(req, 1048576), p = projectDocument(data.project);
      const count = store.get('SELECT count(*) n FROM account_projects WHERE account_id=?', a.key).n;
      if (count >= 200 && !store.get('SELECT id FROM account_projects WHERE account_id=? AND id=?', a.key, p.id)) deny(409, 'Достигнут лимит: 200 проектов.');
      store.run('INSERT INTO account_projects(account_id,id,payload,modified) VALUES(?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET payload=excluded.payload,modified=excluded.modified', a.key, p.id, JSON.stringify(p), now());
      json(res, 200, { ok: true, id: p.id }); return true;
    }
    if (req.method === 'DELETE' && path.startsWith('/api/account/projects/')) {
      const id = path.slice('/api/account/projects/'.length); if (!projectIdOk(id)) deny(400, 'Некорректный идентификатор.');
      const deleted = store.run('DELETE FROM account_projects WHERE account_id=? AND id=?', a.key, id).changes;
      if (!deleted) deny(404, 'Проект не найден.'); json(res, 200, { ok: true }); return true;
    }
    deny(404, 'Метод не найден.');
  }

  async function adminRoute(req, res, url) {
    if (!socialLoginEnabled && url.pathname === '/api/admin/oauth') deny(404, 'Вход через сторонние сервисы отключён.');
    if (url.pathname === '/api/admin/users' && req.method === 'GET') {
      const page = Math.max(1, Math.min(100000, Math.floor(Number(url.searchParams.get('page'))) || 1));
      const q = (url.searchParams.get('q') || '').slice(0, 120);
      const filter = '%' + q.replace(/[!%_]/g, c => '!' + c) + '%';
      const count = store.get("SELECT count(*) n FROM users WHERE name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!'", filter, filter).n;
      const items = store.all("SELECT id,name,email,email_verified,created,last_login,status FROM users WHERE name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' ORDER BY created DESC LIMIT 25 OFFSET ?", filter, filter, (page - 1) * 25).map(r => ({ ...r, providers: store.all('SELECT provider FROM identities WHERE user_id=?', r.id).map(i => i.provider), projectCount: store.get('SELECT count(*) n FROM account_projects WHERE account_id=?', r.id).n }));
      json(res, 200, { items, count, page, pages: Math.max(1, Math.ceil(count / 25)) }); return true;
    }
    if (url.pathname === '/api/admin/oauth' && req.method === 'GET') {
      json(res, 200, { providers: store.all('SELECT provider,client_id AS clientId,version AS graphVersion,enabled,updated,CASE WHEN secret IS NULL THEN 0 ELSE 1 END AS secretConfigured FROM oauth_config').map(c => ({ ...c, redirectUri: origin + '/auth/' + c.provider + '/callback', ready: providers().find(p => p.id === c.provider)?.ready })), publicOrigin: origin }); return true;
    }
    if (url.pathname === '/api/admin/oauth' && req.method === 'PUT') {
      const data = await body(req); await reauthOwner(req, data);
      if (!PROVIDERS.includes(data.provider) || typeof data.enabled !== 'boolean') deny(400, 'Некорректный провайдер.');
      const id = typeof data.clientId === 'string' ? data.clientId.trim() : '';
      if (!/^[a-zA-Z0-9._-]{0,255}$/.test(id) || (data.enabled && !id)) deny(400, 'Укажите Client ID приложения.');
      if (data.provider !== 'google' && data.enabled && !/^v\d{1,3}\.0$/.test(data.graphVersion || '')) deny(400, 'Укажите версию Graph API из настроек приложения Meta, например v23.0.');
      const old = store.get('SELECT * FROM oauth_config WHERE provider=?', data.provider); let secret = old.secret;
      if (data.removeSecret === true) secret = null;
      if (data.clientSecret) { if (typeof data.clientSecret !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(data.clientSecret)) deny(400, 'Некорректный Client Secret.'); secret = store.seal(data.clientSecret); }
      else if (id !== old.client_id && old.secret && !data.removeSecret) deny(400, 'При смене Client ID укажите новый секрет.');
      if (data.enabled && !secret) deny(400, 'Для включения входа нужен Client Secret.');
      store.run('UPDATE oauth_config SET client_id=?,secret=?,version=?,enabled=?,updated=? WHERE provider=?', id, secret, data.provider === 'google' ? '' : String(data.graphVersion || ''), Number(data.enabled), now(), data.provider);
      store.run('DELETE FROM oauth_states WHERE provider=?', data.provider); store.audit('oauth_config_changed', 'ok', now()); json(res, 200, { ok: true }); return true;
    }
    return false;
  }
  function userMetrics(days) {
    const from = now() - days * DAY;
    return { total: store.get('SELECT count(*) n FROM users').n, registered: store.get('SELECT count(*) n FROM users WHERE created>=?', from).n, active: store.get('SELECT count(*) n FROM users WHERE last_login>=?', from).n, accountProjects: store.get('SELECT count(*) n FROM account_projects').n,
      registrations: store.all("SELECT substr(datetime(created/1000,'unixepoch'),1,10) day,count(*) count FROM users WHERE created>=? GROUP BY day ORDER BY day", from) };
  }
  return { route, adminRoute, session, userMetrics, cleanup };
}
