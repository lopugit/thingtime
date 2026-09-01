import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { THINGTIME_CAPABILITY_MANIFEST_PATH } from './app/api/utils/capabilities/capabilityContract';
import { installPreviewBuildFreshness } from './app/utils/previewBuildFreshness';
import { designBundlesCsp, devCsp } from './scripts/csp.mjs';

const designDocsBase = '/docs/design-bundles';
const designDocsDir = fileURLToPath(new URL('../docs/design', import.meta.url));
const embedBundlePath = fileURLToPath(new URL('./dist/embed/thingtime.min.js', import.meta.url));
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
const previewFreshnessPath = '/tt-preview-freshness.js';
const previewFreshnessScript = '(' + installPreviewBuildFreshness.toString() + ')();\n';

const previewFreshnessHtmlPlugin = (): Plugin => ({
  name: 'thingtime-preview-freshness-bootstrap',
  enforce: 'pre' as const,
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== previewFreshnessPath) {
        next();
        return;
      }

      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(previewFreshnessScript);
    });
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: previewFreshnessPath.slice(1),
      source: previewFreshnessScript
    });
  },
  transformIndexHtml() {
    return [
      {
        tag: 'script',
        attrs: {
          src: previewFreshnessPath,
          'data-thingtime-preview-freshness': ''
        },
        injectTo: 'head-prepend' as const
      }
    ];
  }
});

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
      // Repo-controlled generated prototypes compile their Design Components
      // at runtime. Keep that compatibility exception on this path only; the
      // application shell continues to use devCsp without unsafe-eval.
      res.setHeader('Content-Security-Policy', designBundlesCsp);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader('Content-Type', mimeTypes[extname(filePath)] || 'application/octet-stream');
      createReadStream(filePath).pipe(res);
    });
  }
});

const embedBundleDevPlugin = () => ({
  name: 'thingtime-embed-bundle-dev',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/embed/thingtime.min.js' || !existsSync(embedBundlePath)) {
        next();
        return;
      }

      const stats = statSync(embedBundlePath);
      res.statusCode = 200;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      createReadStream(embedBundlePath).pipe(res);
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
    port: devPorts.web,
    strictPort: true,
    // Same CSP as production (scripts/csp.mjs) with dev-only allowances
    // (react-refresh inline preamble, HMR websocket) — and still no
    // 'unsafe-eval', so eval regressions surface in dev too.
    headers: {
      'Content-Security-Policy': devCsp
    },
    allowedHosts: ['lopus-macbook-pro-2.tail9606f9.ts.net'],
    hmr: {
      port: devPorts.hmr
    },
    proxy: {
      [THINGTIME_CAPABILITY_MANIFEST_PATH]: {
        target: localApiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            const host = req.headers.host;
            if (!host || proxyReq.getHeader('x-forwarded-host')) return;
            proxyReq.setHeader('x-forwarded-host', host);
            const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
            proxyReq.setHeader('x-forwarded-proto', proto || 'http');
          });
        }
      },
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        configure(proxy) {
          if (!shouldUseProductionApiProxy) {
            // changeOrigin rewrites Host to the nitro API port, hiding the
            // origin the browser is actually on. Forward the real host the way
            // Vercel's edge does (x-forwarded-*): statusTarget's
            // getRequestOrigin() honours these, which keeps "Current Tab"
            // health checks classified LOCAL — answered in the request's own
            // cookie/session context (the footer's "MongoDB (custom)"
            // indicator depends on this) instead of re-fetched cookielessly.
            // An upstream proxy's x-forwarded-* (e.g. Tailscale funnel) wins.
            proxy.on('proxyReq', (proxyReq, req) => {
              const host = req.headers.host;
              if (!host || proxyReq.getHeader('x-forwarded-host')) return;
              proxyReq.setHeader('x-forwarded-host', host);
              const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
              proxyReq.setHeader('x-forwarded-proto', proto || 'http');
            });
            return;
          }

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
  plugins: [previewFreshnessHtmlPlugin(), react(), designDocsStaticPlugin(), embedBundleDevPlugin()]
});
