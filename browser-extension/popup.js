import {DEFAULT_ORIGIN, providerOrigin, DIAGNOSTIC_REASONS} from './protocol.js';
const enabled = document.querySelector('#enabled');
const origin = document.querySelector('#origin');
const feedback = document.querySelector('#feedback');
const requests = document.querySelector('#requests');
const form = document.querySelector('#settings');
const diagnostics = document.querySelector('#diagnostics');
const refreshDiagnostics = document.querySelector('#refresh-diagnostics');
async function inspectConnection() {
  refreshDiagnostics.disabled = true;
  try {
    const status = await chrome.runtime.sendMessage({action: 'diagnostics'});
    if (!status.available) { diagnostics.textContent = 'This website’s content bridge is unavailable. Reload the website tab after enabling Thingtime and check the extension’s site access.'; return; }
    if (!status.hook) { diagnostics.textContent = 'Content bridge connected; the page hook was not detected. Reload this website tab and check the extension’s site access.'; return; }
    const h = status.hook;
    const method = (name, label) => !h.installed[name] ? `${label} hook: not installed.` : !h.current[name] ? `${label} hook: replaced by the page or another extension.` : `${label} hook: installed and current.`;
    const state = h.enabledSeen === null ? 'Extension state not received by the page.' : h.enabledSeen ? 'Page observed Thingtime enabled.' : 'Page observed Thingtime disabled.';
    diagnostics.textContent = `${method('get', 'Sign-in')} ${method('create', 'Save')} ${state} ${DIAGNOSTIC_REASONS[h.fallbackReason] || DIAGNOSTIC_REASONS[0]}`;
  } catch { diagnostics.textContent = 'Connection status could not be checked. Reopen the extension to retry.'; }
  finally { refreshDiagnostics.disabled = false; }
}
refreshDiagnostics.addEventListener('click', inspectConnection);

async function refresh() {
  const status = await chrome.runtime.sendMessage({action: 'status'});
  requests.replaceChildren();
  if (!status.requests?.length) {
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No active passkey requests.'; requests.append(p);
  }
  for (const request of status.requests || []) {
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = request.origin;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Use browser’s native provider';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await chrome.runtime.sendMessage({action: 'native-fallback', tabId: request.tabId}); await refresh(); }
      catch { feedback.textContent = 'Could not switch provider. Close the request tab and try again.'; button.disabled = false; }
    });
    requests.append(p, button);
  }
}
try {
  const config = await chrome.runtime.sendMessage({action: 'state'});
  enabled.checked = config.enabled === true; origin.value = config.origin || DEFAULT_ORIGIN; await Promise.all([refresh(), inspectConnection()]);
} catch { feedback.textContent = 'The extension is unavailable. Reopen it to try again.'; }
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const selected = providerOrigin(origin.value.trim());
    const response = await chrome.runtime.sendMessage({action: 'settings', enabled: enabled.checked, origin: selected});
    if (!response.ok) throw new Error('Settings could not be saved.');
    origin.value = selected;
    feedback.textContent = enabled.checked ? 'Thingtime is enabled. Reload existing website tabs to connect.' : 'Thingtime is off. Websites use the browser’s native provider.';
    await refresh();
  } catch (error) { feedback.textContent = error.message || 'Settings could not be saved.'; }
  finally { button.disabled = false; }
});
