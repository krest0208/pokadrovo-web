import { existsSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { OWNER_PATH } from './owner-route.mjs';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** Inspect only: never initialise or replace a user's private store. */
export function hasOwner(directory) {
  const database = join(directory, 'owner.sqlite');
  const key = join(directory, 'master.key');
  if (!existsSync(database)) return false;
  if (!existsSync(key) || statSync(key).size !== 32)
    throw Error('Не найден корректный master.key. Восстановите всю приватную папку из резервной копии; база не изменена.');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owner'").get()) return false;
    return !!db.prepare('SELECT id FROM owner WHERE id=1').get();
  } finally { db.close(); }
}

export function launchConfig(env = process.env, container = false) {
  const port = Number(env.POKADROVO_PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('POKADROVO_PORT должен быть от 1 до 65535.');
  const dataDir = resolve(env.POKADROVO_DATA_DIR || join(projectRoot, '.pokadrovo-private'));
  for (const publicDir of [join(projectRoot, 'dist'), join(projectRoot, 'public')]) {
    if (dataDir === publicDir || dataDir.startsWith(publicDir + sep))
      throw Error('Приватная папка должна находиться вне public и dist. Настройка владельца не запущена.');
  }
  const origin = new URL(env.POKADROVO_PUBLIC_ORIGIN || `http://localhost:${port}`);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol))
    throw Error('POKADROVO_PUBLIC_ORIGIN должен содержать только http(s) origin, без пути и данных доступа.');
  if (origin.protocol === 'http:' && (!local || Number(origin.port || 80) !== port))
    throw Error('HTTP разрешён только для localhost/127.0.0.1 с портом сервера. Внешнему адресу нужен HTTPS.');
  // Only the dedicated container entrypoint binds its internal interface.
  // compose.yaml publishes that port exclusively on the host loopback address.
  return { port, host: container ? '0.0.0.0' : '127.0.0.1', dataDir, origin: origin.origin };
}

export async function startServer(config) {
  const { createApp } = await import('./app.mjs');
  const app = createApp({ origin: config.origin, dataDir: config.dataDir });
  try {
    await new Promise((ok, no) => {
      app.server.once('error', no);
      app.server.listen(config.port, config.host, () => { app.server.off('error', no); ok(); });
    });
  } catch (error) {
    app.server.emit('close');
    if (error.code === 'EADDRINUSE') throw Error(`Порт ${config.port} уже занят. Остановите другую копию Покадрово или выберите POKADROVO_PORT.`);
    throw error;
  }
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => app.server.closeAllConnections(), 10000);
    deadline.unref();
    app.server.close(() => { clearTimeout(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop); });
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`\nПокадрово: ${config.origin}\nВход владельца: ${config.origin}${OWNER_PATH}\nПриватные данные: ${config.dataDir}\nДля остановки нажмите Ctrl+C. Публикация не выполнялась.\n`);
  return app;
}
