import assert from 'node:assert/strict';
import test from 'node:test';

import { RELATED_CHILD_PROJECTION } from './things.ts';

test('related child projection preserves rich comment media layouts', () => {
  assert.equal(RELATED_CHILD_PROJECTION['crystal.mediaLayout'], 1);
});
