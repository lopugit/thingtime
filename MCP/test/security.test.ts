import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { redactSecrets, requireAllowedFile } from '../src/security.js';

test('recursively redacts credential-shaped fields', () => {
  assert.deepEqual(redactSecrets({ ok: 1, nested: { password: 'secret', cookieJar: 'secret' } }), {
    ok: 1, nested: { password: '[redacted]', cookieJar: '[redacted]' }
  });
});

test('allows only files beneath configured roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'thingtime-mcp-'));
  const allowed = join(root, 'allowed');
  await mkdir(allowed);
  const inside = join(allowed, 'export.json');
  const outside = join(root, 'outside.json');
  await writeFile(inside, '{}');
  await writeFile(outside, '{}');
  assert.equal(await requireAllowedFile(inside, [allowed]), await realpath(inside));
  await assert.rejects(requireAllowedFile(outside, [allowed]), /outside/);
});
