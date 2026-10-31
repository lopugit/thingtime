'use strict';
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');

process.once('message', async ({ browser, buildId, cacheDir }) => {
  try {
    const { install, detectBrowserPlatform, getDownloadUrl } = await import('@puppeteer/browsers');
    const platform = detectBrowserPlatform();
    if (!['chrome', 'chromium'].includes(browser) || !['mac', 'mac_arm'].includes(platform)) throw new Error('Unsupported build.');
    const sourceUrl = getDownloadUrl(browser, platform, buildId).href;
    if (!sourceUrl.startsWith(`https://storage.googleapis.com/${browser === 'chrome' ? 'chrome-for-testing-public/' : 'chromium-browser-snapshots/'}`)) throw new Error('Unexpected publisher origin.');
    const metadata = await fetch(sourceUrl, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30000) });
    const expectedMd5 = metadata.headers.get('x-goog-hash')?.match(/(?:^|,)\s*md5=([^,]+)/)?.[1];
    if (!metadata.ok || !expectedMd5) throw new Error('Publisher integrity metadata is unavailable.');
    let lastUpdate = 0;
    const options = {
      browser, buildId, cacheDir, platform,
      downloadProgressCallback(downloaded, total) {
        if (Date.now() - lastUpdate > 150 || downloaded === total) {
          process.send?.({ type: 'progress', downloaded, total });
          lastUpdate = Date.now();
        }
      }
    };
    const archive = await install({ ...options, unpack: false });
    const md5 = createHash('md5'), sha256 = createHash('sha256');
    for await (const chunk of createReadStream(archive)) { md5.update(chunk); sha256.update(chunk); }
    if (md5.digest('base64') !== expectedMd5) throw new Error('The archive does not match publisher integrity metadata.');
    const archiveSha256 = sha256.digest('hex');
    await install(options);
    process.send?.({ type: 'installed', platform, sourceUrl, archiveSha256 }, () => process.exit(0));
  } catch { process.exit(1); }
});
