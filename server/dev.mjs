import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const children = [
  spawn(process.execPath, ['server/app.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, POKADROVO_PORT: '5174', POKADROVO_PUBLIC_ORIGIN: 'http://localhost:5173' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit' })
];
let closing = false;
const close = () => { if (closing) return; closing = true; for (const c of children) c.kill('SIGTERM'); };
process.on('SIGINT', close); process.on('SIGTERM', close);
for (const child of children) { child.on('error', error => { console.error(error.message); close(); process.exitCode = 1; }); child.on('exit', code => { if (!closing) { close(); process.exitCode = code || 0; } }); }
