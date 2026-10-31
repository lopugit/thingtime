'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// Shared browser operations for Linux containers and explicitly unrestricted
// native sessions. The allocator, never this driver, establishes the boundary.
class BrowserDriver {
  constructor() { this.pages = new Map(); this.nextPage = 0; }
  page(id) {
    const page = this.pages.get(id);
    if (!page || page.isClosed()) throw new Error('The task page is no longer available.');
    return page;
  }
  async launch({ executable, root, build, environment }) {
    if (this.browser) throw new Error('This task already has a browser.');
    const { default: puppeteer } = await import('puppeteer-core');
    const downloads = path.join(root, 'downloads');
    await fs.mkdir(downloads, { recursive: true, mode: 0o700 });
    this.browser = await puppeteer.launch({ executablePath: executable, headless: true, pipe: true,
      userDataDir: path.join(root, 'profile'), ...(environment ? { env: environment } : {}),
      args: ['--no-proxy-server', '--disable-background-networking'],
      handleSIGINT: false, handleSIGHUP: false, handleSIGTERM: false,
      defaultViewport: { width: 1280, height: 800 }, timeout: 30000 });
    const remember = page => { if (page && ![...this.pages.values()].includes(page)) this.pages.set(String(++this.nextPage), page); };
    this.browser.on('targetcreated', target => target.page().then(remember).catch(() => {}));
    for (const page of await this.browser.pages()) remember(page);
    const cdp = await this.browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }); await cdp.detach();
    return { version: await this.browser.version(), build, tabs: await this.call('tabs') };
  }
  async close() { await this.browser?.close(); this.browser = undefined; this.pages.clear(); }
  async call(method, params = {}, { navigationTimeoutMs = 30000 } = {}) {
    if (!this.browser) throw new Error('Launch the task browser first.');
    if (method === 'tabs') return Promise.all([...this.pages].filter(([, page]) => !page.isClosed()).map(async ([id, page]) => ({ id, url: page.url(), title: await page.title() })));
    if (method === 'newPage') {
      const page = await this.browser.newPage();
      const found = [...this.pages].find(([, value]) => value === page);
      if (found) return { id: found[0] };
      const id = String(++this.nextPage); this.pages.set(id, page); return { id };
    }
    const page = this.page(params.pageId);
    switch (method) {
      case 'navigate': {
        const url = new URL(params.url);
        if (!['http:', 'https:'].includes(url.protocol) && params.url !== 'about:blank') throw new Error('Use an HTTP page.');
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
        return { url: page.url(), title: await page.title() };
      }
      case 'frame': return { image: await page.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64' }), viewport: page.viewport() };
      case 'click': await page.mouse.click(Number(params.x), Number(params.y)); break;
      case 'type': await page.keyboard.type(String(params.text)); break;
      case 'key': await page.keyboard.press(String(params.key)); break;
      case 'scroll': await page.mouse.wheel({ deltaX: Number(params.x || 0), deltaY: Number(params.y || 0) }); break;
      case 'viewport': {
        if (![params.width, params.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192)) throw new Error('Viewport exceeds the renderer pixel budget.');
        await page.setViewport({ width: params.width, height: params.height }); break;
      }
      case 'evaluate': return { value: await page.evaluate(String(params.expression)) };
      case 'closePage': await page.close(); this.pages.delete(params.pageId); break;
      default: throw new Error('Unsupported browser operation.');
    }
    return { ok: true };
  }
}
module.exports = { BrowserDriver };
