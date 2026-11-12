/** Real Thing permalink, real policy/API writes and isolated browser storage. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { runThingMetadataBrowser } from './thing-metadata.browser.mts';

type Fixture = Parameters<typeof runThingMetadataBrowser>[0];
const bytesDigest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

export async function runThingStorageBrowser(input: Fixture) {
  await runThingMetadataBrowser(input, {
    evidenceDir: process.env.THINGTIME_METADATA_BROWSER_EVIDENCE || '/tmp/thingtime-storage-evidence/browser',
    marker: 'THING_STORAGE_BROWSER_PASS',
    async run({ page, context, profile, base, evidence }) {
      const thingPath = (id: string) => `${base}/thing/${id}`;
      const apiPath = (id: string) => `${base}/api/v1/things?id=${id}`;
      const panel = page.locator('#thing-storage');
      const prefs = panel.locator('dd').first();
      const local = panel.locator('dd').nth(1);
      const saveButton = () => panel.getByRole('button', { name: /^(Save storage settings|Save location)$/ });
      const choose = async (label: string) => {
        await panel.getByRole('button', { name: new RegExp('^' + label) }).click();
        await saveButton().click();
        await prefs.getByText(label, { exact: true }).waitFor();
      };
      const localText = async (label: string) => { await local.getByText(label, { exact: true }).waitFor(); };

      if (profile === 'desktop') {
        await page.goto(thingPath(input.jsonId));
        await page.getByRole('button', { name: 'Thing actions' }).click();
        await page.getByRole('menuitem', { name: 'Storage settings' }).click();
        await page.waitForFunction(() => (document.querySelector('#thing-storage') as HTMLDetailsElement)?.open);
        await panel.getByRole('button', { name: /^Keep on this device/ }).waitFor();
        const cloudBefore = await (await context.request.get(apiPath(input.jsonId))).json();
        assert.ok(cloudBefore.ok);
        await choose('Keep on this device');
        await localText('Managed copy saved');

        // Isolate the cloud API while keeping the test app shell available.
        // The real rename action must queue into the device replica across reload.
        await page.route('**/api/v1/things?*', route => {
          const url = new URL(route.request().url());
          return url.searchParams.get('id') === input.jsonId ? route.abort() : route.continue();
        });
        await page.reload();
        await page.getByRole('heading', { name: cloudBefore.thing.crystal.name, exact: true }).waitFor();
        await page.getByRole('button', { name: 'Thing actions' }).click();
        await page.getByRole('menuitem', { name: 'Rename' }).click();
        await page.getByRole('textbox', { name: 'Thing title' }).fill('Offline edited fixture');
        await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
        await page.getByRole('heading', { name: 'Offline edited fixture', exact: true }).waitFor();
        await page.reload();
        await page.getByRole('heading', { name: 'Offline edited fixture', exact: true }).waitFor();
        const stillCloud = await (await context.request.get(apiPath(input.jsonId))).json();
        assert.equal(stillCloud.thing.crystal.name, cloudBefore.thing.crystal.name);
        await localText('Local edits waiting to sync');
        await page.unroute('**/api/v1/things?*');

        // Cloud-only must first sync the local edit, then remove the verified
        // managed copy without deleting the cloud Thing.
        await choose('Cloud only');
        await localText('Managed copy removed');
        const syncedCloud = await (await context.request.get(apiPath(input.jsonId))).json();
        assert.equal(syncedCloud.thing.crystal.name, 'Offline edited fixture');
        await page.screenshot({ path: join(evidence, 'desktop-cloud-only.png'), fullPage: true });

        // A cloud edit made while viewing another Thing refreshes an already
        // pinned copy through the global foreground reconciler.
        await choose('Sync with cloud');
        await localText('Managed copy saved');
        await page.goto(thingPath(input.sourceId) + '#thing-storage');
        const update = await context.request.patch(`${base}/api/v1/things`, {
          data: { id: input.jsonId, crystal: { name: 'Cloud refreshed fixture', title: 'Cloud refreshed fixture' } },
          headers: { Origin: base },
        });
        assert.equal(update.status(), 200);
        const cloudEdit = await (await context.request.get(apiPath(input.jsonId))).json();
        assert.equal(cloudEdit.thing.crystal.name, 'Cloud refreshed fixture');
        await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
        const readRefreshedCopy = () => page.evaluate(`(async () => {
          const { readStoredThing } = await import('/app/storage/thingReplicas.client.ts');
          const row = await readStoredThing({ apiOrigin: location.origin, ownerId: ${JSON.stringify(input.owner.id)}, dataPlane: 'home' },
            ${JSON.stringify(input.jsonId)}, function () {});
          return row?.response?.thing?.crystal?.name === 'Cloud refreshed fixture';
        })()`);
        const deadline = Date.now() + 20_000;
        let refreshed = false;
        while (!refreshed && Date.now() < deadline) {
          refreshed = await readRefreshedCopy();
          if (!refreshed) await delay(250);
        }
        assert.equal(refreshed, true, 'The foreground host must finish publishing the exact cloud edit');
        // The loopback fixture must still load the app shell. Mirror the
        // browser's offline state and refuse any cloud read for this Thing.
        await page.addInitScript(`if (sessionStorage.getItem('fixture-offline') === 'yes') {
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: function () { return false; } });
        }`);
        await page.evaluate("sessionStorage.setItem('fixture-offline', 'yes')");
        await page.route('**/api/v1/things?*', route => {
          const url = new URL(route.request().url());
          return url.searchParams.get('id') === input.jsonId
            ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' })
            : route.continue();
        });
        await page.goto(thingPath(input.jsonId));
        assert.equal(await page.evaluate(() => navigator.onLine), false);
        await page.getByRole('heading', { name: 'Cloud refreshed fixture', exact: true }).waitFor({ timeout: 8000 });
        await page.evaluate("sessionStorage.removeItem('fixture-offline')");
        await page.unroute('**/api/v1/things?*');

        // File data must survive the actual managed-store download/export path.
        await page.goto(thingPath(input.sourceId) + '#thing-storage');
        await choose('Cloud and this device');
        await localText('Managed copy saved');
        const file = (await (await context.request.get(apiPath(input.sourceId))).json()).thing;
        const attachment = file.crystal.content.attachmentId;
        const bytes = await (await context.request.get(`${base}/api/v1/attachments/content?id=${attachment}`)).body();
        assert.equal(bytes.byteLength, 5632);
        await page.addScriptTag({ content: `
          window.storageFixtureBytes = [];
          window.showSaveFilePicker = async function () {
            return { createWritable: async function () {
              return {
                write: async function (chunk) { window.storageFixtureBytes.push(...chunk); },
                close: async function () { window.storageFixtureSaved = true; },
                abort: async function () { window.storageFixtureSaved = false; }
              };
            } };
          };`
        });
        await panel.getByRole('button', { name: 'Export local copy' }).click();
        await page.waitForFunction('window.storageFixtureSaved === true');
        const exported = await page.evaluate(() => (window as unknown as { storageFixtureBytes: number[] }).storageFixtureBytes);
        assert.equal(bytesDigest(new Uint8Array(exported)), bytesDigest(bytes));

        // The layout can edit nested labels and actions independently and the
        // change survives a real account-layout save and reload.
        const host = page.locator('[data-settings-document="thing-storage"]');
        await host.getByRole('button', { name: 'Edit storage layout' }).click();
        await host.getByRole('button', { name: 'Open Builder inspector' }).click();
        const selector = page.getByRole('combobox', { name: 'Select block' });
        const text = page.getByRole('textbox', { name: 'Block text' });
        for (const [id, label] of [['storage-choice-cloud-label', 'Cloud only here'], ['storage-save', 'Save location']]) {
          await selector.selectOption(id);
          await text.fill(label);
          await text.blur();
        }
        await page.getByRole('button', { name: 'Close builder' }).click();
        await Promise.all([
          page.waitForResponse((response: any) => response.url().endsWith('/api/v1/things') && ['POST', 'PATCH'].includes(response.request().method())),
          host.getByRole('button', { name: 'Save layout', exact: true }).click(),
        ]);
        await page.reload();
        await panel.getByRole('button', { name: /^Cloud only here/ }).waitFor();
        await saveButton().waitFor();
        await page.screenshot({ path: join(evidence, 'desktop-saved-layout.png'), fullPage: true });
      } else {
        // A separate isolated profile for the same account has no managed
        // device copy just because desktop was pinned.
        await page.goto(thingPath(input.sourceId) + '#thing-storage');
        await prefs.getByText('On demand on this device', { exact: true }).waitFor();
        await localText('No managed copy registered here');
        assert.equal(await panel.getByRole('button', { name: 'Export local copy' }).count(), 0);
        let releaseRange!: () => void;
        const heldRange = new Promise<void>(resolve => { releaseRange = resolve; });
        const rangePath = '**/api/v1/attachments/content?*';
        await page.route(rangePath, async route => {
          if (new URL(route.request().url()).searchParams.get('range') === '1') await heldRange;
          await route.continue().catch(() => {});
        });
        try {
          const started = page.waitForRequest((request: any) =>
            request.url().includes('/api/v1/attachments/content?') && new URL(request.url()).searchParams.get('range') === '1');
          await choose('Sync with cloud');
          await started;
          await panel.getByRole('progressbar', { name: 'Updating storage settings' }).waitFor();
          await panel.getByRole('button', { name: 'Stop local copy operation' }).click();
          await panel.getByRole('alert').getByText(/operation stopped/).waitFor();
          await panel.getByRole('progressbar').waitFor({ state: 'hidden' });
        } finally {
          releaseRange();
          await page.unroute(rangePath);
        }
        await panel.getByRole('button', { name: 'Refresh storage status' }).click();
        await localText('Managed copy saved');
        await page.screenshot({ path: join(evidence, 'mobile-sync.png'), fullPage: true });
      }

      await page.getByText('End of Thing', { exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
      await panel.scrollIntoViewIfNeeded();
    },
  });
}
