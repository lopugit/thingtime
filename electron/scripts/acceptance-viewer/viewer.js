'use strict';
const api = window.acceptanceViewer;
const element = id => document.getElementById(id);
let frame, busy = false, blocked = false;
async function refresh() {
  const tabs = await api.tabs();
  element('current').textContent = 'Bound tab ' + tabs[0].id + ' · ' + tabs[0].url;
  frame = await api.frame();
  element('frame').src = 'data:image/jpeg;base64,' + frame.image;
  element('frame').hidden = false;
}
async function act(operation, recover = false) {
  if (busy || (blocked && !recover)) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  element('status').textContent = 'Working…';
  try { await operation(); await refresh(); blocked = false; element('status').textContent = 'Ready'; }
  catch (error) {
    element('frame').hidden = true; frame = null; blocked = true;
    element('text').value = '';
    // contextBridge retains Error.message, so display only our fixed operation/stage/code enums.
    const code = /\[((?:input|tabs|frame|navigate|type|key|click|scroll|viewport))\/((?:input|manifest|status|binding|tabs|tab|arguments|frame-result|command-(?:frame|navigate|type|key|click|scroll|viewport))):((?:refused|invalid|timeout|disconnected|transport|protocol|page-context|page-closed|runtime|lease))\]/.exec(error?.message || '');
    element('status').textContent = 'Request refused or disconnected' + (code ? ' [' + code[1] + '/' + code[2] + ':' + code[3] + ']' : '') + '. Input is stopped. Choose Refresh frame to inspect the current page before retrying.';
  }
  finally {
    busy = false;
    document.querySelectorAll('button').forEach(button => { button.disabled = blocked && button.id !== 'refresh'; });
    element('text').disabled = blocked;
  }
}
element('go').onclick = () => act(() => api.navigate(element('url').value));
element('refresh').onclick = () => act(async () => {}, true);
element('type').onclick = () => {
  if (busy || blocked) return;
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
