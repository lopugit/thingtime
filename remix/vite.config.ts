import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { THINGTIME_CAPABILITY_MANIFEST_PATH } from './app/api/utils/capabilities/capabilityContract';
import { APPLE_APP_ASSOCIATION_PATH } from './app/api/utils/auth/appleAppAssociation';
import { ROBOTS_PATH, SITEMAP_PATH } from './app/api/utils/seo/sitemapCore';
import { installPreviewBuildFreshness } from './app/utils/previewBuildFreshness';
import { draftPreviewCsp, platformRuntimeCsp, designBundlesCsp, librarySandboxCsp, librarySdkCsp, devCsp } from './scripts/csp.mjs';

const designDocsBase = '/docs/design-bundles';
const designDocsDir = fileURLToPath(new URL('../docs/design', import.meta.url));
const embedBundlePath = fileURLToPath(new URL('./dist/embed/thingtime.min.js', import.meta.url));

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

// Development requests always stay on this checkout's Nitro server. Missing
// database/auth configuration is a local 503, never a remote API selection.
const localApiTarget = `http://127.0.0.1:${devPorts.api}`;
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

// Proxy to the local Nitro while preserving the browser-facing host/proto (an
// upstream proxy's x-forwarded-* wins), so origin-derived output stays correct.
const forwardHostProxy = (target: string) => ({
  target,
  changeOrigin: true,
  configure(proxy: any) {
    proxy.on('proxyReq', (proxyReq: any, req: any) => {
      const host = req.headers.host;
      if (!host || proxyReq.getHeader('x-forwarded-host')) return;
      proxyReq.setHeader('x-forwarded-host', host);
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
      proxyReq.setHeader('x-forwarded-proto', proto || 'http');
    });
  }
});

const librarySandboxPlugin = (): Plugin => ({
  name: 'library-isolated-preview',
  configureServer(server) {
    server.middlewares.use((req,res,next) => {
      const path = req.url?.split('?')[0];
      if (path === '/draft-preview/index.html' || path === '/draft-preview/' ) {
        res.setHeader('Content-Security-Policy', draftPreviewCsp);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html');
        createReadStream(fileURLToPath(new URL('./public/draft-preview/index.html', import.meta.url))).pipe(res); return;
      }
      if (path === '/draft-preview/runner.js') {
        const file = fileURLToPath(new URL('./dist/draft-preview/runner.js', import.meta.url));
        if (!existsSync(file)) { res.statusCode = 503; res.end('Run npm run build:draft'); return; }
        res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res); return;
      }
      if (path === '/platform/runtime.html' || path === '/platform/runtime.js') {
        const file = fileURLToPath(new URL(`./dist${path}`, import.meta.url));
        if (!existsSync(file)) { res.statusCode=503;res.end('Run npm run build:platform');return; }
        res.setHeader('Content-Type',path.endsWith('.html')?'text/html':'text/javascript');
        res.setHeader('Content-Security-Policy',platformRuntimeCsp);
        res.setHeader('Cache-Control','no-store');
        createReadStream(file).pipe(res);return;
      }
      if (path !== '/library/sandbox.html' && path !== '/library/sdk.html' && path !== '/library/runner.js') return next();
      const file = fileURLToPath(new URL(path.endsWith('.html') ? `./public${path}` : './dist/library/runner.js', import.meta.url));
      if (!existsSync(file)) { res.statusCode=503;res.end('Run npm run build:library');return; }
      res.setHeader('Content-Type',path.endsWith('.html')?'text/html':'text/javascript');
      res.setHeader('Content-Security-Policy',path === '/library/sdk.html' ? librarySdkCsp : librarySandboxCsp);
      res.setHeader('Cache-Control','no-store');
      createReadStream(file).pipe(res);
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
      '/api/v1/passwords': forwardHostProxy(localApiTarget),
      '/api/v1/vault/reveal': {
        // Never send fresh verification material to the production fallback.
        target: localApiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (!proxyReq.getHeader('x-forwarded-host') && req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host);
            if (!proxyReq.getHeader('x-forwarded-proto')) proxyReq.setHeader('x-forwarded-proto', 'http');
          });
        }
      },
      [APPLE_APP_ASSOCIATION_PATH]: { target: localApiTarget, changeOrigin: true },
      // Crawler discovery files are Nitro routes (server/handlers/{robots,sitemap}.ts);
      // prefix matching also covers their -docs twins. Forward the browser host so
      // the robots Sitemap: line and every sitemap <loc> name this dev origin.
      [ROBOTS_PATH]: forwardHostProxy(localApiTarget),
      [SITEMAP_PATH]: forwardHostProxy(localApiTarget),
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
      '/api': forwardHostProxy(localApiTarget)
    }
  },
  plugins: [librarySandboxPlugin(),previewFreshnessHtmlPlugin(), react(), designDocsStaticPlugin(), embedBundleDevPlugin()]
});
