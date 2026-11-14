/** Real Vite output + production CSP + actual PDF worker. No account/API writes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfBytes } from './pdf-fixture.mjs';
import { pdfRuntimeAsset } from './verify-pdf-runtime-build.mjs';
import { prodCsp } from './csp.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), dist = resolve(root, 'dist');
const port = Number(process.env.TT_PDF_BUILT_FIXTURE_PORT || 23870);
const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', prodCsp);
  try {
    const pathname = new URL(req.url, 'http://fixture.test').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>[LC] Built PDF regression</title>'); return; }
    const path = resolve(dist, '.' + pathname);
    if (!path.startsWith(dist + sep)) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(path); res.setHeader('Content-Type', /\.m?js$/.test(path) ? 'text/javascript' : 'application/octet-stream'); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  server.listen({ host: '127.0.0.1', port, exclusive: true }); await once(server, 'listening');
  const { chromium } = process.env.TT_PLAYWRIGHT_MODULE ? await import(process.env.TT_PLAYWRIGHT_MODULE) : createRequire(resolve(root, '../MCP/package.json'))('playwright');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage(), errors = [], workers = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('worker', worker => workers.push(worker.url()));
  await page.goto(`http://127.0.0.1:${port}`);
  const result = await page.evaluate(async ({ asset, bytes }) => {
    const { getPdfRuntime } = await import(asset), pdfjs = getPdfRuntime();
    const data = Uint8Array.from(bytes), range = new pdfjs.PDFDataRangeTransport(data.length, data, true, 'synthetic.pdf');
    const loading = pdfjs.getDocument({ range, rangeChunkSize: 262144, disableAutoFetch: true, disableStream: true, useSystemFonts: true, useWorkerFetch: false, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
    try {
      const doc = await loading.promise, page = await doc.getPage(1), canvas = document.createElement('canvas'), viewport = page.getViewport({ scale: 1 });
      canvas.width = viewport.width; canvas.height = viewport.height; document.body.append(canvas);
      await page.render({ canvas, viewport }).promise;
      return { pages: doc.numPages, text: (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '), worker: pdfjs.GlobalWorkerOptions.workerSrc };
    } finally { await loading.destroy(); }
  }, { asset: `/assets/${await pdfRuntimeAsset()}`, bytes: [...pdfBytes()] });
  assert.equal(result.pages, 2); assert.equal(result.text, 'First page independent fixture'); assert.equal(result.worker, '/pdfjs/pdf.worker.min.mjs');
  assert.ok(workers.some(url => url.endsWith('/pdfjs/pdf.worker.min.mjs')), 'PDF must use its real self-hosted module worker'); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ builtPdfRuntime: 'passed', pages: result.pages, realWorker: true, productionCsp: true }));
} finally { await browser?.close(); server.close(); }
