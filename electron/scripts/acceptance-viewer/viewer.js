'use strict';
const api = window.acceptanceViewer;
const element = id => document.getElementById(id);
let frame, busy = false;
async function refresh() {
  const tabs = await api.tabs();
  element('current').textContent = 'Bound tab ' + tabs[0].id + ' · ' + tabs[0].url;
  frame = await api.frame();
  element('frame').src = 'data:image/jpeg;base64,' + frame.image;
  element('frame').hidden = false;
}
async function act(operation) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  element('status').textContent = 'Working…';
  try { await operation(); await refresh(); element('status').textContent = 'Ready'; }
  catch { element('frame').hidden = true; frame = null; element('status').textContent = 'Request refused or disconnected. Inspect the task and refresh before retrying.'; }
  finally { busy = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}
element('go').onclick = () => act(() => api.navigate(element('url').value));
element('refresh').onclick = () => act(async () => {});
element('type').onclick = () => {
  if (busy) return;
  const text = element('text').value;
  element('text').value = '';
  if (text) void act(() => api.type(text));
};
document.querySelectorAll('[data-key]').forEach(button => { button.onclick = () => act(() => api.key(button.dataset.key)); });
element('up').onclick = () => act(() => api.scroll(-500));
element('down').onclick = () => act(() => api.scroll(500));
element('mobile').onclick = () => act(() => api.viewport(375, 812));
element('desktop').onclick = () => act(() => api.viewport(1280, 800));
element('frame').onclick = event => {
  if (!frame || busy) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  void act(() => api.click((event.clientX - bounds.left) * frame.viewport.width / bounds.width, (event.clientY - bounds.top) * frame.viewport.height / bounds.height));
};
element('frame').onkeydown = event => {
  if (event.metaKey || event.ctrlKey || event.altKey || !['Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault(); void act(() => api.key(event.key));
};
window.addEventListener('blur', () => { element('text').value = ''; });
void act(async () => {});
