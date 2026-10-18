import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { HttpError, body, deny, json } from './http.mjs';
import { openStore, provisionOwner, equal } from './security.mjs';
import { hasOwner } from './standalone.mjs';
import { OWNER_PATH } from './owner-route.mjs';

/** One-time local bootstrap, never mounted on the application's HTTP server. */
export async function createLocalOwnerSetup({ dataDir, returnTo, timeoutMs = 10 * 60000 }) {
  if (hasOwner(dataDir)) throw Error('Владелец уже настроен. Используйте обычный вход.');
  const store = openStore(dataDir);
  if (store.get('SELECT id FROM owner WHERE id=1')) { store.close(); throw Error('Владелец уже настроен.'); }
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + timeoutMs;
  let origin, used = false, busy = false, attempts = 0, closing = false, timer;
  let resolveDone, rejectDone;
  const done = new Promise((ok, no) => { resolveDone = ok; rejectDone = no; });
  void done.catch(() => {});
  const assets = {
    [OWNER_PATH]: ['setup.html', 'text/html; charset=utf-8'],
    '/setup-assets/setup.js': ['setup.js', 'text/javascript; charset=utf-8'],
    '/setup-assets/setup.css': ['setup.css', 'text/css; charset=utf-8']
  };
  async function route(req, res) {
    if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(origin).host) deny(403, 'Недопустимый адрес настройки.');
    if (Date.now() >= expires || used) deny(410, 'Одноразовая настройка завершена. Запустите приложение снова.');
    const path = new URL(req.url, origin).pathname;
    if (req.method === 'GET' && assets[path]) {
      const [name, mime] = assets[path];
      const bytes = await readFile(new URL('./public/' + name, import.meta.url));
      res.writeHead(200, { 'Content-Type': mime }); res.end(bytes); return;
    }
    if (path !== '/setup-owner' || req.method !== 'POST') deny(404, 'Не найдено.');
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site' || !equal(req.headers['x-pokadrovo-setup-token'], token)) deny(403, 'Откройте одноразовую ссылку из окна запуска.');
    if (busy) deny(409, 'Настройка уже выполняется.');
    if (++attempts > 10) deny(429, 'Слишком много попыток. Перезапустите приложение.');
    busy = true;
    try {
      const value = await body(req, 8192);
      if (typeof value.password !== 'string' || value.password !== value.confirmPassword) deny(400, 'Пароли не совпадают.');
      try { await provisionOwner(store, value.login, value.password, false); }
      catch (error) { deny(400, error.message); }
      used = true;
      json(res, 201, { ok: true, nextUrl: returnTo });
      close();
    } finally { busy = false; }
  }
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    void route(req, res).catch(error => {
      if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Ошибка настройки. Проверьте окно запуска.' });
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  function close(error) {
    if (closing) return;
    closing = true; clearTimeout(timer);
    server.close(() => { store.close(); error ? rejectDone(error) : resolveDone(); });
    server.closeIdleConnections();
  }
  try {
    await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => { server.off('error', no); ok(); }); });
  } catch (error) { store.close(); throw error; }
  origin = 'http://127.0.0.1:' + server.address().port;
  timer = setTimeout(() => close(Error('Время настройки истекло. Запустите приложение снова.')), timeoutMs);
  return { url: origin + OWNER_PATH + '#token=' + token, done, close: () => close(Error('Настройка отменена.')) };
}
