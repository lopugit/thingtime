import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const designDocsBase = '/docs/design-bundles';
const designDocsDir = fileURLToPath(new URL('../docs/design', import.meta.url));
const thingtimeProductionOrigin = 'https://thingtime.com';
const mongoPasswordPlaceholder = '<db_password>';

const require = createRequire(import.meta.url);
const { resolveDevContext } = require('./scripts/worktree-ports.cjs');
const { ports: devPorts } = resolveDevContext(fileURLToPath(new URL('.', import.meta.url)));
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

const hasUsableLocalApiEnv = () => {
  const connectionString = process.env.MONGODB_CONNECTION_STRING?.trim();

  if (!connectionString) return false;
  if (connectionString.includes(mongoPasswordPlaceholder) && !process.env.MONGO_PASS?.trim()) {
    return false;
  }

  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.JWT_PRIVATE_KEY?.trim() &&
    !process.env.JWT_SECRET?.trim()
  ) {
    return false;
  }

  return true;
};

const rewriteProxyCookieForLocalDev = (cookie: string) => {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part, index) => {
      if (index === 0) return true;

      const lower = part.toLowerCase();
      return !lower.startsWith('domain=') && lower !== 'secure';
    })
    .join('; ');
};

const localApiTarget = `http://127.0.0.1:${devPorts.api}`;
const shouldUseProductionApiProxy = !hasUsableLocalApiEnv();
const apiProxyTarget = shouldUseProductionApiProxy ? thingtimeProductionOrigin : localApiTarget;

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

// Build-only CSP, delivered as a meta tag so it applies wherever the static
// shell is hosted (Vercel serves index.html directly, bypassing Nitro headers).
// script-src carries sha256 hashes for the shell's own inline scripts instead
// of 'unsafe-inline', so injected inline/remote scripts are blocked.
// 'unsafe-eval' stays for now: smarts + the Commander evaluate user-typed JS by
// design — dropping it is blocked on migrating them off eval (TODO 10 notes).
// No frame-ancestors on purpose: embedding Thingtime is a feature (embed SDK,
// default-open SSO origins). Dev is untouched (apply: 'build').
const cspMetaPlugin = () => ({
  name: 'thingtime-csp-meta',
  apply: 'build' as const,
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string) {
      const inlineScriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`
      );
      const csp = [
        "default-src 'self'",
        ["script-src 'self' 'unsafe-eval'", ...inlineScriptHashes].join(' '),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "connect-src 'self' https: wss:",
        "worker-src 'self' blob:",
        "frame-src 'self' https:",
        "object-src 'none'",
        "base-uri 'self'"
      ].join('; ');

      return html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
    }
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
    port: devPorts.web,
    strictPort: true,
    allowedHosts: ['lopus-macbook-pro-2.tail9606f9.ts.net'],
    hmr: {
      port: devPorts.hmr
    },
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        configure(proxy) {
          if (!shouldUseProductionApiProxy) return;

          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('x-thingtime-api-fallback', 'vite-dev');
          });

          proxy.on('proxyRes', (proxyRes) => {
            const setCookie = proxyRes.headers['set-cookie'];
            if (!setCookie) return;

            proxyRes.headers['set-cookie'] = Array.isArray(setCookie)
              ? setCookie.map(rewriteProxyCookieForLocalDev)
              : [rewriteProxyCookieForLocalDev(setCookie)];
          });
        }
      }
    }
  },
  plugins: [react(), designDocsStaticPlugin(), cspMetaPlugin()]
});
