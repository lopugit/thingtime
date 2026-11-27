import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const origin = new URL(process.env.THINGTIME_WEB_URL ?? 'http://127.0.0.1:17991').origin;
assert.match(origin, /^http:\/\/127\.0\.0\.1:/, 'Use a task-owned local Vite shell');
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
assert.ok(playwrightModule, 'Set PLAYWRIGHT_MODULE to the installed Playwright entry file');
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const browser = await chromium.launch({ channel: 'chrome' });

try {
  for (const [width, ios] of [[1280, false], [390, true], [375, true], [320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 840 }, hasTouch: ios });
    try {
      // Let NativeBridgeHost apply its real WebView class as it does on iOS.
      if (ios) {
        await context.addInitScript(() => {
          window.thingtimeNativeBridge = { isNativeWebView: true, postMessage() {} };
        });
      }
      await context.route(`${origin}/api/**`, route => {
        const { pathname } = new URL(route.request().url());
        if (pathname === '/api/root-data') {
          return route.fulfill({ json: { user: null, dataPlane: 'home', envFromCookie: {}, devKitEnv: {} } });
        }
        if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { user: null } });
        return route.fulfill({ status: 503, json: {} });
      });

      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const nav = page.locator('.thingtimeTopNav nav');
      const back = nav.getByRole('button', { name: 'Back', exact: true });
      const forward = nav.getByRole('button', { name: 'Forward', exact: true });
      const refresh = nav.getByRole('button', { name: 'Refresh', exact: true });
      const menu = page.getByRole('button', { name: 'Open menu', exact: true });
      const search = nav.getByRole('button', { name: 'Open Commander search', exact: true }).filter({ visible: true });
      const login = nav.getByRole('link', { name: /login/i }).filter({ visible: true });
      if (ios) await page.locator('html.thingtime-native-webview').waitFor();

      const boxes = await Promise.all([menu, back, forward, refresh, search, login].map(async control => {
        await control.waitFor();
        return control.boundingBox();
      }));
      assert.ok(boxes.every(box => box.x >= 0 && box.x + box.width <= width));
      for (let i = 1; i < boxes.length; i++) {
        assert.ok(boxes[i - 1].x + boxes[i - 1].width <= boxes[i].x + 1, 'Navbar controls must not overlap');
      }

      const press = control => ios ? control.tap() : control.click();
      await press(login);
      await page.waitForURL(`${origin}/login`);
      if (ios) await back.tap();
      else {
        await back.focus();
        await back.press('Enter');
      }
      await page.waitForURL(`${origin}/`);
      await press(forward);
      await page.waitForURL(`${origin}/login`);
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      await Promise.all([page.waitForEvent('load'), press(refresh)]);
      assert.equal(page.url(), `${origin}/login`);
      assert.ok(await page.evaluate(previous => performance.timeOrigin > previous, timeOrigin));
      assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload');

      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await press(menu);
      const close = page.getByRole('button', { name: 'Close menu', exact: true });
      await press(close);
      await press(search);
      const dialog = page.getByRole('dialog').filter({ visible: true }).first();
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.NAVBAR_EVIDENCE_DIR) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${process.env.NAVBAR_EVIDENCE_DIR}/navbar-${width}.png` });
      }
      console.log(`${width}px ${ios ? 'iOS bridge' : 'desktop web'}: navigation, reload, drawer and search passed`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
