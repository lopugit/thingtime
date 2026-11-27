export const WORKSPACE_DEFAULTS = Object.freeze({width: 960, height: 760, fontSize: 16});
export function workspacePreferences(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(WORKSPACE_DEFAULTS)) {
    const n = value?.[key];
    result[key] = Number.isSafeInteger(n) && n > 0 && (key === 'fontSize' || n <= 2147483647) ? n : fallback;
  }
  return result;
}
export function fitWorkspaceBounds(preferences, screen, current) {
  const p = workspacePreferences(preferences);
  const fit = (n, available) => Number.isFinite(available) && available > 0 ? Math.min(n, Math.floor(available)) : n;
  const bounds = {width: fit(p.width, screen.availWidth), height: fit(p.height, screen.availHeight)};
  if (current && Number.isFinite(screen.availWidth) && Number.isFinite(screen.availHeight)) {
    const left = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
    const top = Number.isFinite(screen.availTop) ? screen.availTop : 0;
    bounds.left = Math.round(Math.max(left, Math.min(current.left ?? left, left + screen.availWidth - bounds.width)));
    bounds.top = Math.round(Math.max(top, Math.min(current.top ?? top, top + screen.availHeight - bounds.height)));
  }
  return bounds;
}
/** The toolbar captures a document before the workspace takes focus. Routing
 * handles live only in session storage; no page paths, options or credentials persist. */
export const sameWorkspaceTarget = (a, b) => !!a && !!b && ['tabId', 'windowId', 'documentId', 'origin'].every(key => a[key] === b[key]);
export function createWorkspaceController(chrome, safeOrigin) {
  const url = chrome.runtime.getURL('popup.html');
  let queue = Promise.resolve();
  let captureGeneration = 0;
  async function capture(tab) {
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab.windowId)) return null;
    const frame = await chrome.webNavigation.getFrame({tabId: tab.id, frameId: 0}).catch(() => null);
    const origin = safeOrigin(frame?.url);
    return origin && frame?.documentId ? {tabId: tab.id, windowId: tab.windowId, documentId: frame.documentId, origin} : null;
  }
  async function target() {
    const {workspaceTarget: t} = await chrome.storage.session.get('workspaceTarget');
    if (!t) return null;
    const [tab, frame] = await Promise.all([chrome.tabs.get(t.tabId).catch(() => null), chrome.webNavigation.getFrame({tabId: t.tabId, frameId: 0}).catch(() => null)]);
    const latest = (await chrome.storage.session.get('workspaceTarget')).workspaceTarget;
    return sameWorkspaceTarget(t, latest) && tab && !tab.pendingUrl && tab.windowId === t.windowId && frame?.documentId === t.documentId && safeOrigin(frame.url) === t.origin ? t : null;
  }
  function open(tab) {
    captureGeneration++;
    // Serialize rapid toolbar clicks, including a suspended worker's first open.
    const captured = capture(tab);
    const operation = queue.catch(() => {}).then(async () => {
      const selected = await captured;
      if (selected) await chrome.storage.session.set({workspaceTarget: selected});
      else await chrome.storage.session.remove('workspaceTarget');
      const {workspaceWindowId} = await chrome.storage.session.get('workspaceWindowId');
      const stored = Number.isInteger(workspaceWindowId)
        ? await chrome.windows.get(workspaceWindowId, {populate: true}).catch(() => null) : null;
      const initial = candidate => (!candidate.url || candidate.url === 'about:blank') && candidate.pendingUrl === url;
      const owned = candidate => candidate.url === url && !candidate.pendingUrl || initial(candidate);
      let win = stored?.type === 'popup' && stored.tabs?.some(owned) ? stored : null;
      let candidate = win?.tabs.find(owned);
      if (!win) {
        const tabs = await chrome.tabs.query({url});
        for (const tab of tabs) {
          if (!owned(tab)) continue;
          const found = await chrome.windows.get(tab.windowId).catch(() => null);
          if (found?.type === 'popup') { win = found; candidate = tab; break; }
        }
      }
      if (win) {
        await chrome.storage.session.set({workspaceWindowId: win.id});
        await chrome.tabs.update(candidate.id, {active: true});
        await chrome.windows.update(win.id, {focused: true, ...(win.state === 'minimized' ? {state: 'normal'} : {})});
        return win;
      }
      // The page fits saved preferences to its actual screen on load, without
      // requesting display permissions or treating monitor size as a product cap.
      const created = await chrome.windows.create({url, type: 'popup', width: 960, height: 760, focused: true});
      if (Number.isInteger(created?.id)) await chrome.storage.session.set({workspaceWindowId: created.id});
      return created;
    });
    queue = operation;
    return operation;
  }
  return {open, target, generation: () => captureGeneration};
}

/** UI reads can finish out of order; only the latest inspection may paint. */
export function createLatestInspection(load, commit, settled) {
  let generation = 0;
  return async () => {
    const current = ++generation;
    try {
      const value = await load();
      if (current === generation) commit(null, value);
    } catch (error) { if (current === generation) commit(error); }
    finally { if (current === generation) settled(); }
  };
}
