import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, provisionOwner } from './security.mjs';

function secret(question) {
  return new Promise((ok, no) => {
    process.stdout.write(question); let value = '';
    emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    const finish = error => { process.stdin.off('keypress', key); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? no(error) : ok(value); };
    const key = (s, k = {}) => {
      if (k.ctrl && k.name === 'c') return finish(Error('Отменено'));
      if (k.name === 'return') return finish();
      if (k.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (s && !k.ctrl && !k.meta && !/[\u0000-\u001f\u007f]/.test(s)) value += s;
    };
    process.stdin.on('keypress', key);
  });
}
if (!process.stdin.isTTY) throw Error('Запустите настройку в своём интерактивном терминале. Пароль через аргументы или публичный API не принимается.');
const base = fileURLToPath(new URL('../.pokadrovo-private', import.meta.url));
const store = openStore(resolve(process.env.POKADROVO_DATA_DIR || base));
try {
  const reset = process.argv.includes('--reset');
  const old = store.get('SELECT login FROM owner WHERE id=1');
  if (old && !reset) throw Error('Владелец уже существует. Для восстановления: npm run admin:setup -- --reset');
  console.log('ПОКАДРОВО · единственный владелец\nПароль не будет отображаться или отправляться в сеть.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let login;
  try {
    if (reset && (await rl.question('Это сменит пароль и отключит 2FA. Введите RESET: ')) !== 'RESET') throw Error('Отменено');
    login = (await rl.question(`Логин [${old?.login || 'krest0208'}]: `)).trim() || old?.login || 'krest0208';
  } finally { rl.close(); }
  const password = await secret('Новый пароль (не менее 14 символов): ');
  const confirm = await secret('Повторите пароль: ');
  if (password !== confirm) throw Error('Пароли не совпадают.');
  await provisionOwner(store, login, password, reset);
  console.log(`\nВладелец ${login} настроен.\nЗапустите npm start и откройте http://localhost:5173/admin.\nВ разделе «Защита» включите код подтверждения с телефона.\nХраните резервную копию всей папки .pokadrovo-private вне GitHub.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store.close(); }
