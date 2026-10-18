import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { install, detectBrowserPlatform, getDownloadUrl } from '@puppeteer/browsers';

const [browser, buildId] = process.argv.slice(2);
let executable, provenance;
if (browser === 'chromium' && buildId === 'playwright-1.64.0') {
  executable = chromium.executablePath();
  await fs.access(executable);
  provenance = { source: 'mcr.microsoft.com/playwright:v1.64.0-noble' };
} else if (browser === 'chrome' && /^\d+\.\d+\.\d+\.\d+$/.test(buildId)) {
  const platform = detectBrowserPlatform();
  const url = getDownloadUrl(browser, platform, buildId);
  if (!url.href.startsWith('https://storage.googleapis.com/chrome-for-testing-public/')) throw new Error('Unexpected publisher.');
  const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30000) });
  const expected = response.headers.get('x-goog-hash')?.match(/(?:^|,)\s*md5=([^,]+)/)?.[1];
  if (!response.ok || !expected) throw new Error('Publisher integrity metadata unavailable.');
  const options = { browser, buildId, platform, cacheDir: '/opt/thingtime-browser/builds' };
  const archive = await install({ ...options, unpack: false });
  const md5 = createHash('md5'), sha256 = createHash('sha256');
  for await (const chunk of createReadStream(archive)) { md5.update(chunk); sha256.update(chunk); }
  if (md5.digest('base64') !== expected) throw new Error('Publisher checksum mismatch.');
  provenance = { source: url.href, archiveSha256: sha256.digest('hex') };
  executable = (await install(options)).executablePath;
} else throw new Error('Unsupported pinned browser build.');
await fs.writeFile('/opt/thingtime-browser/browser.json', JSON.stringify({ browser, buildId, executable, provenance }));
