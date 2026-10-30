import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiFailure } from '../../hooks/apiFailure';
import { isUnknownReactionFailure, reactionFailureMessage, shouldReconcileReactionFailure } from './reactionFailure';

test('known reaction rejections preserve authored context and roll back safely', () => {
  const error = createApiFailure({
    payload: { error: 'That post is no longer visible' },
    status: 404,
    action: 'save your reaction',
    method: 'POST'
  });
  assert.equal(shouldReconcileReactionFailure(error), false);
  assert.deepEqual(reactionFailureMessage(error, false), {
    title: 'That post is no longer visible',
    description: undefined
  });
});

test('authored 503 reaction rejections are not treated as ambiguous commits', () => {
  const error = createApiFailure({
    payload: {
      error: 'Storage accounting is being initialized — try again shortly',
      outcome: 'rejected'
    },
    status: 503,
    action: 'save your reaction',
    method: 'POST'
  });
  assert.equal(shouldReconcileReactionFailure(error), false);
  assert.equal(reactionFailureMessage(error, false).title, 'Storage accounting is being initialized — try again shortly');
});

test('ambiguous reaction failures explain reconciliation and safe retry behavior', () => {
  const error = createApiFailure({
    payload: { error: true, unhandled: true },
    status: 500,
    action: 'save your reaction',
    method: 'POST'
  });
  assert.equal(shouldReconcileReactionFailure(error), true);
  assert.match(reactionFailureMessage(error, true).description || '', /refreshed to match the server/);
  assert.match(reactionFailureMessage(error, false).description || '', /don’t accidentally reverse it/);
});

test('transport failures keep optimistic state instead of trusting a GET that could overtake the write', () => {
  const error = createApiFailure({
    cause: new Error('socket closed'),
    action: 'save your reaction',
    method: 'POST'
  });

  assert.equal(isUnknownReactionFailure(error), true);
  assert.equal(shouldReconcileReactionFailure(error), false);
  assert.match(reactionFailureMessage(error, false).description || '', /Refresh this page before trying again/);
});
