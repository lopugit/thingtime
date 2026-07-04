import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const designDocsBase = '/docs/design-bundles';
const designDocsDir = fileURLToPath(new URL('../docs/design', import.meta.url));
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

const isPathInside = (parent: string, child: string) => {
  const relativePath = relative(parent, child);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const designDocsStaticPlugin = () => ({
  name: 'thingtime-design-docs-static',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const rawPath = req.url?.split('?')[0] || '';
      const matchesBase = rawPath === designDocsBase || rawPath.startsWith(`${designDocsBase}/`);

      if (!matchesBase) {
        next();
        return;
      }

      let decodedPath = '';

      try {
        decodedPath = decodeURIComponent(rawPath === designDocsBase ? '' : rawPath.slice(designDocsBase.length + 1));
      } catch {
        res.statusCode = 400;
        res.end('Bad request');
        return;
      }

      const safePath = normalize(decodedPath || 'index.html');

      if (safePath.startsWith('..') || isAbsolute(safePath)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      let filePath = join(designDocsDir, safePath);

      if (!isPathInside(designDocsDir, filePath) || !existsSync(filePath)) {
        next();
        return;
      }

      let stats = statSync(filePath);

      if (stats.isDirectory()) {
        filePath = join(filePath, 'index.html');

        if (!isPathInside(designDocsDir, filePath) || !existsSync(filePath)) {
          next();
          return;
        }

        stats = statSync(filePath);
      }

      if (!stats.isFile()) {
        next();
        return;
      }

      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader('Content-Type', mimeTypes[extname(filePath)] || 'application/octet-stream');
      createReadStream(filePath).pipe(res);
    });
  }
});

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
  plugins: [react(), designDocsStaticPlugin()]
});
