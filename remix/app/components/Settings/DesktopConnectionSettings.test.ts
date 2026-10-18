import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { DesktopConnectionSettings } from './DesktopConnectionSettings';
import { DesktopConnectionRecovery } from './DesktopConnectionRecovery';
import type { ThingtimeDesktopInfo } from '../../utils/electronBridge';

const endpoint = { id: 'unreachable', label: 'Unavailable API', url: 'https://unreachable.example.test/', source: 'custom' as const };
const info: ThingtimeDesktopInfo = {
  desktopSettings: { autoStartNodeOnLaunch: false, customMenuBarIconConfigured: false, endpointProfiles: [endpoint], menuBarIcons: [],
    selectedEndpoint: endpoint, selectedEndpointId: endpoint.id, selectedMenuBarIconId: '' },
  endpointCompatibility: { status: 'unreachable', message: 'This API is unavailable.' },
  localRuntime: { enabled: true, active: false, restartRequired: true, databaseMode: 'managed', apiPort: 28641, databasePort: 28642,
    mongodPath: '/test-only/mongod', externalDatabaseConfigured: false, encryptionAvailable: true,
    origin: 'http://127.0.0.1:28641', error: null, downloadUrl: 'https://www.mongodb.com/try/download/community' }
};
const render = (desktopInfo: ThingtimeDesktopInfo) => renderToStaticMarkup(React.createElement(ChakraProvider, { resetCSS: false },
  React.createElement(DesktopConnectionSettings, { desktopInfo, onInfo: () => undefined })));

test('unreachable account API leaves native connection controls usable without account or router providers', () => {
  const html = render(info);
  for (const text of ['Use a local API', 'Save runtime settings', 'Restart Thingtime', 'Choose mongod', 'API endpoint', 'Add endpoint'])
    assert.ok(html.includes(text), text);
  assert.match(html, /<button[^>]*data-tt-action-inputs="[^"]*runtime.save[^"]*"[^>]*>Save runtime settings/);
  const save = html.match(/<button[^>]*data-tt-action-inputs="[^"]*runtime.save[^"]*"[^>]*>/)?.[0];
  assert.ok(save && !save.includes('disabled='), 'false disabled bindings leave Save usable');
  assert.match(html, /value="28641"/);
  assert.match(html, /value="28642"/);
  assert.doesNotMatch(html, /name="password"|accountId|session token/);
});

test('older native bridge keeps endpoint repair available without local runtime support', () => {
  const html = render({ ...info, localRuntime: null });
  assert.ok(html.includes('Add endpoint'));
  assert.ok(html.includes('Unavailable API'));
  assert.ok(!html.includes('Save runtime settings'));
});

test('ordinary web recovery renders no native settings or account providers', () => {
  assert.equal(renderToStaticMarkup(React.createElement(DesktopConnectionRecovery)), '');
});
