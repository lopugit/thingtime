import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs';

const artifactDir = resolve(process.argv[2]);
const fileUrl = pathToFileURL(resolve(artifactDir, 'anonymous-local-first.html')).href;
const browser = await chromium.launch({ executablePath: "/ms-playwright/chromium-1248/chrome-linux-arm64/chrome", headless: true, chromiumSandbox: true });
const report = {
  ok: false, scope: 'Copied static progress plan in isolated namespace; external and artifact links are not followed',
  sourceSha256: createHash('sha256').update(await readFile(resolve(artifactDir, 'anonymous-local-first.html'))).digest('hex'),
  errors: [], requests: [], viewports: []
};
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url() === fileUrl ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => report.requests.push(request.url()));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(fileUrl);
    const counts = await page.evaluate(() => {
      const tasks = [...document.querySelectorAll('.task')];
      return {
        total: tasks.length,
        done: tasks.filter(task => task.dataset.status === 'done').length,
        local: tasks.filter(task => task.dataset.status === 'local').length,
        todo: tasks.filter(task => task.dataset.status === 'todo').length,
        displayed: [...document.querySelectorAll('.stat strong')].map(node => Number(node.textContent))
      };
    });
    assert.deepEqual(counts.displayed, [counts.done, counts.local, counts.todo], 'Header counts match the current checklist');
    const bounds = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.viewport + 1, `Document overflow at ${width}: ${JSON.stringify(bounds)}`);
    await page.screenshot({ path: resolve(artifactDir, `plan-${width}-top.png`) });
    const traversal = await page.evaluate(async () => { let steps=0; for(let y=0;y<document.documentElement.scrollHeight;y+=Math.max(1,innerHeight-120)){ if(++steps>100)throw Error('Unbounded page');scrollTo(0,y);await new Promise(r=>requestAnimationFrame(r));if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Scroll overflow');}scrollTo(0,0);return steps; });
    await page.locator('.controls').scrollIntoViewIfNeeded();
    const filters = [];
    for (const filter of ['all', 'todo', 'done', 'local', 'p0']) {
      await page.locator(`[data-filter="${filter}"]`).click();
      const result = await page.evaluate(active => {
        const tasks = [...document.querySelectorAll('.task')];
        const expected = tasks.filter(task => active === 'all' || (active === 'p0' ? task.dataset.priority === 'P0' : active === 'todo' ? task.dataset.status !== 'done' : task.dataset.status === active));
        const visible = tasks.filter(task => !task.hidden);
        const sectionsMatch = [...document.querySelectorAll('.work')].every(section => section.hidden === (Boolean(section.querySelector('.task')) && !section.querySelector('.task:not([hidden])')));
        return { expected: expected.length, visible: visible.length, matching: visible.every(task => expected.includes(task)), sectionsMatch, status: document.querySelector('#shown').textContent };
      }, filter);
      assert.equal(result.visible, result.expected);
      assert.equal(result.matching, true);
      assert.equal(result.sectionsMatch, true);
      assert.equal(result.status, `${result.expected} checklist items shown`);
      assert.equal(await page.locator(`[data-filter="${filter}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#current26').isVisible(), true, 'Current verification stays visible while filtering'); filters.push({ filter, count: result.visible });
    }
    await page.locator('[data-filter="all"]').click();
    await page.locator('#search').fill('mCp');
    const search = await page.evaluate(() => {
      const tasks = [...document.querySelectorAll('.task')];
      return { expected: tasks.filter(task => task.textContent.toLowerCase().includes('mcp')).length, visible: tasks.filter(task => !task.hidden).length };
    });
    assert.ok(search.expected > 0);
    assert.equal(search.visible, search.expected);
    await page.screenshot({ path: resolve(artifactDir, `plan-${width}-search.png`) });
    await page.locator('#search').fill('nonexistent-plan-term-68213');
    assert.equal(await page.locator('.task:not([hidden])').count(), 0);
    assert.equal(await page.locator('.work:not([hidden])').count(), 0);
    await page.locator('#search').fill('');
    assert.equal(await page.locator('.task:not([hidden])').count(), counts.total);
    for (const section of ['testing', 'artifacts']) {
      await page.locator(`#${section}`).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const sectionBounds = await page.locator(`#${section}`).evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom }));
      assert.ok(Math.abs(sectionBounds.top) <= 1, `Section ${section} reached the viewport at ${width}`);
      await page.screenshot({ path: resolve(artifactDir, `plan-${width}-${section}.png`) });
    }
    const table = await page.locator('.table-wrap').first().evaluate(node => {
      const before = node.scrollLeft;
      node.scrollLeft = node.scrollWidth;
      return { width: node.clientWidth, content: node.scrollWidth, scrollable: node.scrollWidth <= node.clientWidth + 1 || node.scrollLeft > before };
    });
    assert.equal(table.scrollable, true);
    await page.locator('footer').evaluate(node => node.scrollIntoView({ block: 'end', behavior: 'instant' }));
    const footerBounds = await page.locator('footer').evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, viewportHeight: innerHeight }));
    assert.ok(footerBounds.top >= 0 && footerBounds.bottom <= footerBounds.viewportHeight + 1, `Footer reached the viewport at ${width}`);
    await page.screenshot({ path: resolve(artifactDir, `plan-${width}-footer.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    report.viewports.push({ width, traversal, counts, filters, caseInsensitiveSearch: search, emptySearch: true, noDocumentOverflow: true, sectionScrollReached: ['testing', 'artifacts'], footerBounds, table });
  }
  assert.deepEqual(report.errors, []);
  assert.ok(report.requests.every(url => url === fileUrl));
  report.ok = true;
} finally {
  await writeFile(resolve(artifactDir, 'verification.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
