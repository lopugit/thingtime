'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPasswordProvider } = require(path.resolve(__dirname, '../../../../electron/lib/password-provider.cjs'));

test('isolated missing native helper refuses retirement without simulating credential cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pr1000-missing-native-helper-'));
  try {
    const provider = createPasswordProvider({ app: { isPackaged: false }, root,
      origin: () => 'http://127.0.0.1:27654', endpoint: () => 'http://127.0.0.1:12345', platform: 'darwin' });
    await assert.rejects(provider.disconnect(), /Install the Thingtime native helper to enable AutoFill\./);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
