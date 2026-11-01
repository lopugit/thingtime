import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLopuMessage } from './lopuMessage';

test('an invalid API value can never leave an error toast decoration-only', () => {
  assert.deepEqual(normalizeLopuMessage({ title: true, status: 'error' }), {
    title: 'Something went wrong. Please try again.',
    description: undefined
  });
  assert.deepEqual(normalizeLopuMessage({ title: undefined, description: false, status: 'error' }), {
    title: 'Something went wrong. Please try again.',
    description: undefined
  });
});

test('authored toast text is trimmed and preserved', () => {
  assert.deepEqual(normalizeLopuMessage({ title: '  Migration failed  ', description: '  MongoServerError (224)  ', status: 'error' }), {
    title: 'Migration failed',
    description: 'MongoServerError (224)'
  });
});
