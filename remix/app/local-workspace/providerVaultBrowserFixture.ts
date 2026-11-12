import { setTimeout } from 'node:timers/promises';

/** Poll the awaited result: Playwright's async waitForFunction predicate can
 * resolve early because the returned Promise itself is truthy. */
export async function waitForProviderVaultOfflineShell(page: any) {
 const deadline = Date.now() + 45_000;
 do {
  const proof = await page.evaluate(async () => {
   const worker = navigator.serviceWorker.controller;
   if (worker?.state !== 'activated') return null;
   for (const key of await caches.keys()) {
    if (!key.startsWith('thingtime:offline-shell:')) continue;
    const cache = await caches.open(key);
    const marker = await cache.match('/__thingtime_offline_shell_complete__');
    const shell = await cache.match('/offline-shell.html');
    if (marker?.ok && shell?.ok) return { worker: new URL(worker.scriptURL).pathname, cache: key, marker: marker.status, shell: shell.status };
   }
   return null;
  });
  if (proof) return proof;
  await setTimeout(250);
 } while (Date.now() < deadline);
 throw new Error('No active service worker with a complete cached offline shell was observed.');
}

export async function measureProviderVaultScroll(page: any) {
 return page.locator('#secure-vault').evaluate(async (vault: HTMLElement) => {
  const regions = new Set<HTMLElement>([document.scrollingElement as HTMLElement]);
  for (let element = vault.parentElement; element && element !== document.body; element = element.parentElement) {
   if (/(auto|scroll)/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 2) regions.add(element);
  }
  const results = [];
  for (const region of regions) {
   const previous = region.scrollTop;
   const positions = [];
   for (const edge of ['top', 'bottom'] as const) {
    // A cold page can add rows or finish measuring its footer while scrolling.
    // Compare against the live bottom after layout, with a bounded settling loop.
    let current = 0, target = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
     region.scrollTo({ top: edge === 'top' ? 0 : region.scrollHeight, behavior: 'instant' });
     await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
     target = edge === 'top' ? 0 : region.scrollHeight - region.clientHeight;
     current = region.scrollTop;
     if (Math.abs(current - target) <= 2) break;
    }
    positions.push({ current, target });
   }
   const [top, bottom] = positions;
   results.push({ tag: region.tagName, top: top.current, bottom: bottom.current, max: bottom.target });
   region.scrollTo({ top: previous, behavior: 'instant' });
  }
  return results;
 }) as Promise<Array<{ tag: string; top: number; bottom: number; max: number }>>;
}
