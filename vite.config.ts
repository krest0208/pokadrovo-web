import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.pokadrovo-private/**', '**/*.sqlite*'] }, proxy: {
    '/auth': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/api': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/admin': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/krest0208': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    '/owner-assets': { target: 'http://127.0.0.1:5174', changeOrigin: false }
  } }
});
