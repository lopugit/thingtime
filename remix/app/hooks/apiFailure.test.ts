import assert from 'node:assert/strict';
import test from 'node:test';

import { apiErrorMessage, createApiFailure, hasUnknownMutationOutcome, readApiResponsePayload } from './apiFailure';

test('Nitro unhandled errors become contextual, nonblank API failures', () => {
  const error = createApiFailure({
    payload: { error: true, status: 500, unhandled: true },
    status: 500,
    action: 'save your reaction',
    method: 'POST'
  });

  assert.equal(error.error, 'Thingtime hit a server error while trying to save your reaction (500).');
  assert.equal(error.status, 500);
  assert.equal(hasUnknownMutationOutcome(error), true);
});

test('authored API errors survive while non-string payload errors never become UI copy', () => {
  const authored = createApiFailure({
    payload: { ok: false, error: 'Run the account storage migration first' },
    status: 409,
    action: 'run migration storage-v2',
    method: 'POST'
  });
  assert.equal(authored.error, 'Run the account storage migration first');
  assert.equal(hasUnknownMutationOutcome(authored), false);
  assert.equal(apiErrorMessage({ error: true }, 'Safe fallback'), 'Safe fallback');
});

test('structured auth and account-switcher failure fields survive normalization', () => {
  const accounts = [{ id: 'user-a', username: 'alpha' }];
  const error = createApiFailure({
    payload: { ok: false, error: 'That challenge expired', reason: 'challenge_invalid', accounts },
    status: 401,
    method: 'POST'
  });

  assert.equal(error.reason, 'challenge_invalid');
  assert.deepEqual(error.accounts, accounts);
});

test('an explicit reaction rejection overrides the generic 5xx ambiguity rule', () => {
  const error = createApiFailure({
    payload: { ok: false, error: 'Storage accounting is being initialized', outcome: 'rejected' },
    status: 503,
    action: 'save your reaction',
    method: 'POST'
  });

  assert.equal(error.outcome, 'rejected');
  assert.equal(hasUnknownMutationOutcome(error), false);
});

test('Nitro development details and network causes are not exposed', () => {
  const server = createApiFailure({
    payload: { error: 'mongodb://user:secret@example.invalid', unhandled: true, stack: 'private stack' },
    status: 500,
    action: 'run that migration',
    method: 'POST'
  });
  assert.doesNotMatch(server.error, /secret|private stack|example\.invalid/);

  const network = createApiFailure({
    cause: new Error('socket detail that should stay private'),
    action: 'save your reaction',
    method: 'POST'
  });
  assert.match(network.error, /couldn’t reach the server/);
  assert.doesNotMatch(network.error, /socket detail/);
});

test('unreadable successful mutation responses remain commit-unknown', async () => {
  for (const contentType of ['application/json', 'text/plain']) {
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': contentType }),
      json: async () => {
        throw new Error('private truncated body detail');
      },
      text: async () => {
        throw new Error('private stream detail');
      }
    } as unknown as Response;

    await assert.rejects(
      readApiResponsePayload(response, { action: 'save your reaction', method: 'POST' }),
      (error: unknown) => {
        assert.equal(hasUnknownMutationOutcome(error), true);
        assert.match(apiErrorMessage(error, ''), /unreadable response/);
        assert.doesNotMatch(apiErrorMessage(error, ''), /private|truncated|stream/);
        return true;
      }
    );
  }
});
