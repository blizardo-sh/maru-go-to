import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: '../../public',
  // The preview serves the app's existing art; it never copies or changes it.
  build: { copyPublicDir: false },
});
