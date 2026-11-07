import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

import { THINGTIME_CAPABILITY_MANIFEST_PATH } from './app/api/utils/capabilities/capabilityContract';
import { APPLE_APP_ASSOCIATION_PATH } from './app/api/utils/auth/appleAppAssociation';
import { ROBOTS_PATH, SITEMAP_PATH } from './app/api/utils/seo/sitemapCore';
import { installPreviewBuildFreshness } from './app/utils/previewBuildFreshness';
import { mediaWorkerCsp, draftPreviewCsp, platformRuntimeCsp, designBundlesCsp, librarySandboxCsp, librarySdkCsp, devCsp, prodCsp } from './scripts/csp.mjs';
import { platformRuntimePlugin } from './scripts/platform-runtime-plugin.mjs';

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
  preview: { headers: { 'Content-Security-Policy': prodCsp } },
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
      // Public cards and their generated -docs twin are Nitro responses too;
      // letting Vite handle these paths returns the SPA shell (or POST 404).
      '/social-card': forwardHostProxy(localApiTarget),
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
  plugins: [react(), designDocsStaticPlugin(), cspMetaPlugin()]
});
