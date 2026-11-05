import {initializePasswordWorkspace} from './vault-popup.js';
import {DEFAULT_ORIGIN, providerOrigin, DIAGNOSTIC_REASONS} from './protocol.js';
import {WORKSPACE_DEFAULTS, workspacePreferences, fitWorkspaceBounds, createLatestInspection} from './workspace.js';
const $ = selector => document.querySelector(selector);
const enabled = $('#enabled'), origin = $('#origin'), feedback = $('#feedback'), requests = $('#requests'), form = $('#settings');
const diagnostics = $('#diagnostics'), refreshDiagnostics = $('#refresh-diagnostics');
let preferences = {...WORKSPACE_DEFAULTS};
const tabs = [...document.querySelectorAll('[role=tab]')];
function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault(); selectTab(tabs[index], true);
  });
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => selectTab(document.getElementById(button.dataset.tab), true));
function appearance(value) {
  preferences = workspacePreferences(value); $('#width').value = preferences.width; $('#height').value = preferences.height; $('#font-size').value = preferences.fontSize;
  document.documentElement.style.fontSize = `${preferences.fontSize}px`;
}
async function applySize() {
  const win = await chrome.windows.getCurrent();
  if (win.type !== 'popup') return false;
  await chrome.windows.update(win.id, {state: 'normal', ...fitWorkspaceBounds(preferences, window.screen, win)}); return true;
}
const inspectConnection = createLatestInspection(async () => {
  refreshDiagnostics.disabled = true;
  return chrome.runtime.sendMessage({action: 'diagnostics'});
}, (error, status) => {
  if (error) { diagnostics.textContent = 'Connection status could not be checked. Use Refresh status to retry.'; return; }
  $('#target').textContent = status.target?.origin || 'No current website selected. Open Thingtime from the toolbar on a website; a navigation or closed tab requires selecting it again.';
  if (!status.target) { diagnostics.textContent = 'Choose a website using the toolbar to inspect its connection. This window never guesses a target from the current foreground tab.'; return; }
  if (!status.available) { diagnostics.textContent = 'This website’s content bridge is unavailable. Reload the website, then open Thingtime from its toolbar and check extension site access.'; return; }
  if (!status.hook) { diagnostics.textContent = 'Content bridge connected; the page hook was not detected. Reload this website and check extension site access.'; return; }
  const h = status.hook;
  const method = (name, label) => !h.installed[name] ? `${label} hook: not installed.` : !h.current[name] ? `${label} hook: replaced by the page or another extension.` : `${label} hook: installed and current.`;
  const state = h.enabledSeen === null ? 'Extension state not received by the page.' : h.enabledSeen ? 'Page observed Thingtime enabled.' : 'Page observed Thingtime disabled.';
  diagnostics.textContent = `${method('get', 'Sign-in')} ${method('create', 'Save')} ${state} ${DIAGNOSTIC_REASONS[h.fallbackReason] || DIAGNOSTIC_REASONS[0]}`;
}, () => { refreshDiagnostics.disabled = false; });
refreshDiagnostics.addEventListener('click', inspectConnection);
let requestGeneration = 0;
async function refresh() {
  const generation = ++requestGeneration;
  const status = await chrome.runtime.sendMessage({action: 'status'});
  if (generation !== requestGeneration) return;
  requests.replaceChildren(); $('#request-count').textContent = String(status.requests?.length || 0);
  if (!status.requests?.length) { const p = document.createElement('p'); p.className = 'card'; p.textContent = 'No active passkey requests. Start a passkey action on a website to see its pending approval here.'; requests.append(p); }
  for (const request of status.requests || []) {
    const card = document.createElement('article'); card.className = 'card';
    const title = document.createElement('h3'); title.textContent = request.type === 'create' ? 'Save a passkey' : 'Sign in with a passkey';
    const p = document.createElement('p'); p.textContent = request.origin;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Use another passkey provider';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await chrome.runtime.sendMessage({action: 'native-fallback', tabId: request.tabId, requestId: request.requestId}); await refresh(); }
      catch { button.disabled = false; p.textContent = 'Could not switch provider. Refresh requests and try again.'; }
    }); card.append(title, p, button); requests.append(card);
  }
}
window.addEventListener('focus', () => { void Promise.allSettled([refresh(), inspectConnection()]); });
$('#refresh-requests').addEventListener('click', () => refresh().catch(() => { requests.textContent = 'Requests could not be refreshed. Try again.'; }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.workspaceTarget) { void inspectConnection(); return; }
  if (area !== 'local') return;
  if (changes.workspacePreferences) appearance(changes.workspacePreferences.newValue);
  if (changes.enabled) $('#enabled-badge').textContent = changes.enabled.newValue ? 'Passkeys enabled' : 'Passkeys off';
});
try {
  const [config, workspace] = await Promise.all([chrome.runtime.sendMessage({action: 'state'}), chrome.runtime.sendMessage({action: 'workspace-state'})]);
  enabled.checked = config.enabled === true; $('#autofill-enabled').checked = config.autofillEnabled !== false; origin.value = config.origin || DEFAULT_ORIGIN; $('#enabled-badge').textContent = enabled.checked ? 'Passkeys enabled' : 'Passkeys off';
  appearance(workspace.preferences); $('#version').textContent = `v${chrome.runtime.getManifest().version}`;
  await Promise.all([refresh(), inspectConnection(), applySize()]);
} catch { feedback.textContent = 'The extension is unavailable. Reopen it to try again.'; }
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
  try {
    const selected = providerOrigin(origin.value.trim());
    const response = await chrome.runtime.sendMessage({action: 'settings', enabled: enabled.checked, autofillEnabled: $('#autofill-enabled').checked, origin: selected});
    if (!response.ok) throw new Error('Settings could not be saved.');
    origin.value = selected; $('#enabled-badge').textContent = enabled.checked ? 'Passkeys enabled' : 'Passkeys off';
    feedback.textContent = enabled.checked ? 'Thingtime is enabled. Reload existing website tabs to connect.' : 'Thingtime is off. Websites use the browser’s native provider.'; await refresh();
  } catch (error) { feedback.textContent = error.message || 'Settings could not be saved.'; }
  finally { button.disabled = false; }
});
$('#appearance').addEventListener('submit', async event => {
  event.preventDefault(); const status = $('#appearance-feedback');
  const value = {width: Number($('#width').value), height: Number($('#height').value), fontSize: Number($('#font-size').value)};
  if (Object.values(value).some(n => !Number.isSafeInteger(n) || n <= 0) || value.width > 2147483647 || value.height > 2147483647) { status.textContent = 'Enter positive whole numbers. Chrome window dimensions support up to 2,147,483,647 pixels.'; return; }
  try { const saved = await chrome.runtime.sendMessage({action: 'workspace-settings', preferences: value}); if (!saved.ok) throw new Error(); appearance(saved.preferences); status.textContent = 'Appearance saved. Text size is applied; new windows use your default dimensions.'; }
  catch { status.textContent = 'Appearance could not be saved. Your connection settings are unchanged.'; }
});
$('#apply-size').addEventListener('click', async () => { try { $('#appearance-feedback').textContent = await applySize() ? 'Saved dimensions applied to this window, fitted to the available screen.' : 'Open the workspace from the toolbar to resize its window.'; } catch { $('#appearance-feedback').textContent = 'The browser could not resize this window.'; } });
$('#reset-appearance').addEventListener('click', async () => { try { const saved = await chrome.runtime.sendMessage({action: 'workspace-settings', preferences: WORKSPACE_DEFAULTS}); if (!saved.ok) throw new Error(); appearance(saved.preferences); $('#appearance-feedback').textContent = 'Default appearance restored.'; } catch { $('#appearance-feedback').textContent = 'Defaults could not be saved.'; } });

initializePasswordWorkspace();
