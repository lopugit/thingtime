import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url))
    },
    tsconfigPaths: true
  },
  server: {
    host: '127.0.0.1',
    port: 9999,
    strictPort: true,
    allowedHosts: ['lopus-macbook-pro-2.tail9606f9.ts.net'],
    hmr: {
      port: 9998
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:10000',
        changeOrigin: true
      }
    }
  },
  plugins: [react()]
});
