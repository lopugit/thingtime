import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { resolveTheme, THINGTIME_THEME } from '../../../theme/tokens';
let authenticated = true;
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => authenticated ? { id: 'synthetic-owner' } : null } });
mock.module(new URL('./themes.ts', import.meta.url).href, { namedExports: {
  listThemesForUser: async () => [],
  saveTheme: async (_ownerId, input) => ({ ok: true, theme: { id: 'synthetic-theme', theme: resolveTheme(THINGTIME_THEME, input.theme) } })
} });
const { action } = await import('../../../routes/api/v1/themes/_themes');

test('theme route accepts valid JSON larger than the former header cap and retains focus settings', async () => {
  const body = JSON.stringify({ name: 'Synthetic theme', theme: { colors: { focusBorder: '#26724d' }, general: { focusGlowBlur: 100, focusGlowOpacity: 0 } } }) + ' '.repeat(70000);
  const response = await action({ request: new Request('https://themes.test/api/v1/themes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) }, body }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.theme.theme.colors.focusBorder, '#26724d');
  assert.equal(result.theme.theme.general.focusGlowBlur, 100);
  assert.equal(result.theme.theme.general.focusGlowOpacity, 0);
});

test('theme route retains authentication before parsing or writing', async () => {
  authenticated = false;
  const response = await action({ request: new Request('https://themes.test/api/v1/themes', { method: 'POST', body: '{' }) });
  assert.equal(response.status, 401);
});
