import {DEFAULT_ORIGIN, providerOrigin} from './protocol.js';
const enabled = document.querySelector('#enabled');
const origin = document.querySelector('#origin');
const feedback = document.querySelector('#feedback');
const requests = document.querySelector('#requests');
const form = document.querySelector('#settings');
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
  enabled.checked = config.enabled === true; origin.value = config.origin || DEFAULT_ORIGIN; await refresh();
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
