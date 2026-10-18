import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
const run = (command, args, env = process.env) => new Promise((ok, no) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.once('error', no);
  child.once('exit', (code, signal) => code === 0 ? ok() : no(Error(`Запуск остановлен: ${signal || 'код ' + code}.`)));
});
async function npm(args) {
  // Windows .cmd files require cmd.exe. Arguments here are fixed, never user input.
  if (process.platform === 'win32') return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')]);
  return run('npm', args);
}
try {
  if (major < 22 || major === 22 && minor < 16) throw Error('Установите Node.js 22.16+ (рекомендуется 24 LTS): https://nodejs.org/');
  const { hasOwner, launchConfig, startServer } = await import('../server/standalone.mjs');
  const config = launchConfig();
  if (!existsSync(join(root, 'dist/index.html'))) {
    console.log('Подготавливаю сборку из исходников. Для первого запуска нужен интернет.');
    await npm(existsSync(join(root, 'package-lock.json')) ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund']);
    await npm(['run', 'build']);
  }
  if (!hasOwner(config.dataDir)) {
    if (!process.stdin.isTTY) throw Error('Первый запуск требует интерактивного терминала: запустите start-standalone в своём окне, затем создайте владельца в открывшемся браузере.');
    const { createLocalOwnerSetup } = await import('../server/setup-browser.mjs');
    const { OWNER_PATH } = await import('../server/owner-route.mjs');
    const setup = await createLocalOwnerSetup({ dataDir: config.dataDir, returnTo: config.origin + OWNER_PATH });
    console.log('\nПервый запуск: задайте пароль в открывшемся окне браузера.\nЕсли окно не открылось, скопируйте эту одноразовую ссылку в адресную строку:\n' + setup.url + '\nНе закрывайте терминал до завершения настройки.\n');
    const opener = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', 'start "" "' + setup.url + '"']] : process.platform === 'darwin' ? ['open', [setup.url]] : ['xdg-open', [setup.url]];
    const browser = spawn(opener[0], opener[1], { stdio: 'ignore' }); browser.on('error', () => {}); browser.unref();
    const cancel = () => setup.close();
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    try { await setup.done; } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
    if (!hasOwner(config.dataDir)) throw Error('Владелец не создан. Запуск остановлен.');
  }
  await startServer(config);
} catch (error) { console.error('\n' + error.message); process.exitCode = 1; }
