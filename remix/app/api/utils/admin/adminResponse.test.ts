import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_PRIVATE_CACHE_CONTROL, withAdminPrivateResponse } from './adminResponse.ts';

const assertPrivate = (response: Response) => {
  assert.equal(response.headers.get('Cache-Control'), ADMIN_PRIVATE_CACHE_CONTROL);
  assert.equal(response.headers.get('Pragma'), 'no-cache');
};

test('admin response wrapper marks ordinary responses private and non-cacheable', async () => {
  const response = await withAdminPrivateResponse(() => new Response('{}', { status: 200 }));
  assertPrivate(response);
});

test('admin response wrapper also marks thrown route responses', async () => {
  const thrown = await withAdminPrivateResponse(() => {
    throw new Response('{"ok":false}', { status: 413 });
  }).then(
    () => null,
    (error) => error
  );

  assert.ok(thrown instanceof Response);
  assert.equal(thrown.status, 413);
  assertPrivate(thrown);
});
