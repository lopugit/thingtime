import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        launcher: fileURLToPath(new URL('./launcher.html', import.meta.url)),
        settings: fileURLToPath(new URL('./settings.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4781,
    strictPort: true,
  },
});
