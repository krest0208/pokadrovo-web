import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPassword, openStore } from '../security.mjs';

const setup = fileURLToPath(new URL('../setup.mjs', import.meta.url));
const supportsTerminal = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function run(args, directory, terminal = false) {
  const command = [process.execPath, setup, ...args];
  return spawnSync(terminal ? 'script' : process.execPath,
    terminal ? ['-q', '-e', '-c', command.map(quote).join(' '), '/dev/null'] : command.slice(1),
    { env: { ...process.env, POKADROVO_DATA_DIR: directory }, encoding: 'utf8', timeout: 20000 });
}

test('random owner setup refuses redirected output before creating private data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pk-setup-'));
  try {
    const result = run(['--generate'], join(directory, 'private'));
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes('Начальный пароль:'), false);
    assert.equal(existsSync(join(directory, 'private')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('terminal setup generates a usable random password once and never replaces an existing owner', { skip: !supportsTerminal }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pk-setup-'));
  let store;
  try {
    const result = run(['--generate'], directory, true);
    assert.equal(result.status, 0);
    const password = result.stdout.match(/Начальный пароль: ([A-Za-z0-9_-]{43})/u)?.[1];
    assert.equal(typeof password, 'string');
    store = openStore(directory);
    const owner = store.get('SELECT * FROM owner WHERE id=1');
    assert.equal(owner.login, 'krest0208');
    assert.equal(await checkPassword(password, owner.password), true);
    assert.equal(owner.password.includes(password), false);
    store.run('UPDATE owner SET totp=? WHERE id=1', store.seal('existing-second-factor'));
    const before = store.get('SELECT password,totp FROM owner WHERE id=1');
    store.close(); store = undefined;
    for (const args of [['--generate'], ['--generate', '--reset']]) {
      const repeat = run(args, directory, true);
      assert.notEqual(repeat.status, 0);
      assert.equal(repeat.stdout.includes('Начальный пароль:'), false);
    }
    store = openStore(directory);
    const after = store.get('SELECT password,totp FROM owner WHERE id=1');
    assert.deepEqual(after, before);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
