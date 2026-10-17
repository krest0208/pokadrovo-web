'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pokadrovo-tests-'));
let status = 1;
try {
  const compiler = require.resolve('typescript/bin/tsc');
  const sources = fs.readdirSync(path.join(root, 'src/editor'))
    .filter(name => name.endsWith('.ts'))
    .map(name => path.join('src/editor', name));
  const compile = spawnSync(process.execPath, [compiler, '--strict', '--target', 'ES2022',
    '--module', 'commonjs', '--lib', 'ES2022,DOM,DOM.Iterable', '--skipLibCheck',
    '--outDir', output, ...sources], { cwd: root, stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error('Editor TypeScript compilation failed');
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"commonjs"}\n');
  const tests = spawnSync(process.execPath, [path.join(root, 'tests/editor-model.test.cjs')], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, POKADROVO_TEST_MODEL: path.join(output, 'model.js') }
  });
  if (tests.error) throw tests.error;
  status = tests.status === null ? 1 : tests.status;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
process.exitCode = status;
