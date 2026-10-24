import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error Node-only build helper has no browser declarations.
import {buildMailRuntime} from './tools/build-mail-runtime.mjs';
// @ts-expect-error Shared Node route keeps the private entry out of build configuration.
import {OWNER_PATH} from './server/owner-route.mjs';
export default defineConfig({
  plugins: [react(),{name:'private-mail-runtime',apply:'build',async closeBundle(){await buildMailRuntime();}}],
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.pokadrovo-private/**', '**/*.sqlite*'] }, proxy: {
    '/account/email': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/account-mail': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/auth': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/api': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/admin': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    [OWNER_PATH]: { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/owner-assets': { target: 'http://127.0.0.1:5174', changeOrigin: false }
  } }
});
