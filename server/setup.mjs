import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, provisionOwner, token } from './security.mjs';

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
const generate = process.argv.includes('--generate');
const reset = process.argv.includes('--reset');
if (generate && reset) throw Error('--generate доступен только для первого создания владельца. Для восстановления используйте интерактивный --reset.');
if (!process.stdin.isTTY || (generate && !process.stdout.isTTY)) throw Error('Запустите настройку в своём интерактивном терминале. Пароль через аргументы, перенаправление вывода или публичный API не принимается.');
const base = fileURLToPath(new URL('../.pokadrovo-private', import.meta.url));
const store = openStore(resolve(process.env.POKADROVO_DATA_DIR || base));
try {
  const old = store.get('SELECT login FROM owner WHERE id=1');
  if (old && !reset) throw Error('Владелец уже существует. Для восстановления: npm run admin:setup -- --reset');
  console.log('ПОКАДРОВО · единственный владелец');
  let login;
  let password;
  if (generate) {
    login = 'pkadmin-' + token().slice(0, 20);
    password = token();
  } else {
    console.log('Вводимый пароль не будет отображаться или отправляться в сеть.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (reset && (await rl.question('Это сменит пароль и отключит 2FA. Введите RESET: ')) !== 'RESET') throw Error('Отменено');
      login = (await rl.question(`Логин [${old?.login || 'krest0208'}]: `)).trim() || old?.login || 'krest0208';
    } finally { rl.close(); }
    password = await secret('Новый пароль (не менее 14 символов): ');
    const confirm = await secret('Повторите пароль: ');
    if (password !== confirm) throw Error('Пароли не совпадают.');
  }
  await provisionOwner(store, login, password, reset);
  console.log(`\nВладелец ${login} настроен.`);
  if (generate) console.log(`Начальный пароль: ${password}\nОн показан только сейчас в этом терминале. Сохраните его в менеджере паролей.\nПосле входа нажмите «Сменить пароль» и задайте собственную парольную фразу.`);
  console.log('На сайте нажмите «Войти» и используйте этот логин и пароль. Кнопка «Админ-панель» появится только в аккаунте владельца.\nПрямой вход: /krest0208!!!.\nВ разделе «Защита доступа» можно сменить логин и пароль и включить код с телефона.\nХраните резервную копию всей папки приватных данных вне GitHub.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store.close(); }
