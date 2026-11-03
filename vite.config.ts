import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { relative } from 'node:path';
import { publicRuntimeFile } from './scripts/delivery';
const publicRoot = new URL('./public/', import.meta.url).pathname;
export default defineConfig({
  publicDir: 'public',
  plugins: [react(), { name: 'runtime-public-files', configureServer(server) { server.middlewares.use((req, res, next) => { let path: string; try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.statusCode = 400; res.end(); return; } if (!publicRuntimeFile(path)) { res.statusCode = 404; res.end(); return; } next(); }); }, closeBundle() { cpSync(publicRoot, new URL('./dist/', import.meta.url).pathname, { recursive: true, filter: path => publicRuntimeFile(relative(publicRoot, path)) }); } }],
  resolve: { alias: { '@app': new URL('./src', import.meta.url).pathname } },
  // Absolute public URLs are shared with the published course and both interfaces.
  base: '/',
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { copyPublicDir: false, rolldownOptions: { input: { index: new URL('./index.html', import.meta.url).pathname, legacy: new URL('./legacy.html', import.meta.url).pathname } } },
});
