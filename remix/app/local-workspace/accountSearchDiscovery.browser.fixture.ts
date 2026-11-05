/** Passive diagnostics for a disposable loopback browser; never registers or fills caches. */
export function observeSearchShell(browser: any) {
 const responses: any[] = [], failures: any[] = [], observerErrors: string[] = [];
 const staticPath = (raw: string) => { try { const url = new URL(raw); return url.hostname === '127.0.0.1' && (/^\/assets\//.test(url.pathname) || /^\/(media-cache|offline-shell)/.test(url.pathname) || url.pathname === '/.well-known/thingtime-capabilities.json') ? url.pathname : null; } catch { return null; } };
 const observe = async (target: any) => {
  if (target.type() !== 'service_worker') return;
  try {
   const cdp = await target.createCDPSession(), requests = new Map<string, string>();
   await cdp.send('Network.enable');
   cdp.on('Network.requestWillBeSent', (event: any) => { const path = staticPath(event.request.url); if (path) requests.set(event.requestId, path); });
   cdp.on('Network.responseReceived', (event: any) => { const path = staticPath(event.response.url); if (path) responses.push({ source: 'worker', path, status: event.response.status }); });
   cdp.on('Network.loadingFailed', (event: any) => { const path = requests.get(event.requestId); if (path) failures.push({ source: 'worker', path, error: event.errorText, canceled: event.canceled }); });
  } catch (error) { observerErrors.push(String(error)); }
 };
 browser.on('targetcreated', observe);
 return { attachPage(page: any) {
  page.on('response', (r: any) => { const path = staticPath(r.url()); if (path) responses.push({ source: 'page', path, status: r.status() }); });
  page.on('requestfailed', (r: any) => { const path = staticPath(r.url()); if (path) failures.push({ source: 'page', path, error: r.failure()?.errorText }); });
 }, async snapshot(page: any, label: string) {
  const state = await page.evaluate(async () => {
   const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
   const path = (url: string | undefined) => url ? new URL(url).pathname : null;
   const workers = registrations.map(r => ({ scope: path(r.scope), installing: r.installing?.state ?? null, waiting: r.waiting?.state ?? null, active: r.active?.state ?? null, script: path(r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL) }));
   let manifest: any = null, manifestStatus: number | null = null, manifestError: string | null = null;
   try { const r = await fetch('/offline-shell-manifest.mjs', { cache: 'no-store', credentials: 'omit', redirect: 'error' }); manifestStatus = r.status; const text = await r.text(); if (r.ok) manifest = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;$/, '')); } catch (error) { manifestError = String(error); }
   const shellCaches = [];
   for (const name of await caches.keys()) if (name.startsWith('thingtime:offline-shell:')) {
    const cache = await caches.open(name), keys = await cache.keys(), retained = new Set(keys.map(r => new URL(r.url).pathname));
    shellCaches.push({ name, entryCount: keys.length, complete: !!await cache.match('/__thingtime_offline_shell_complete__'), missingManifestPaths: manifest?.assets?.map((a: any) => a.path).filter((p: string) => !retained.has(p)) ?? null });
   }
   return { secureContext: isSecureContext, onLine: navigator.onLine, serviceWorkerSupported: 'serviceWorker' in navigator, controller: path(navigator.serviceWorker?.controller?.scriptURL), workers, manifestStatus, manifestError, manifestHash: manifest?.hash, manifestAssets: manifest?.assets?.length, shellCaches };
  });
  return { label, state, responses: [...responses], failures: [...failures], observerErrors: [...observerErrors], note: 'Passive registration/network/cache inspection. Manifest GET is diagnostic only; no worker registration or cache population performed.' };
 } };
}
