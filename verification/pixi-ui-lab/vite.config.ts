import { defineConfig } from 'vite';
export default defineConfig({ publicDir: false, build: { copyPublicDir: false, rolldownOptions: { input: { index: new URL('./index.html', import.meta.url).pathname, paper: new URL('./paper.html', import.meta.url).pathname } } } });
