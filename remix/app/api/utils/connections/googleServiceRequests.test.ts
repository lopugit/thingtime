import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleServiceAccess } from '../../../connections/googleServiceActions';
import { namedOperationsFor, parseNamedConnectionInput } from '../../../connections/namedAccess';
import { googleServiceRequest, redactServiceResult } from './googleServiceRequests';
const requestId = '00000000-0000-4000-8000-000000000001';
test('operations require their exact provider and explicit permission', () => {
  for (const [operation, spec] of Object.entries(googleServiceAccess)) {
    const input = { requestId, name: 'Selected service', allowedOperations: [operation], requestedScopes: [spec.scope] };
    assert.ok(parseNamedConnectionInput(spec.provider, input));
    assert.equal(parseNamedConnectionInput('google', input), null);
    assert.equal(parseNamedConnectionInput(spec.provider, { ...input, requestedScopes: [] }), null);
    assert.ok(namedOperationsFor(spec.provider).includes(operation as keyof typeof googleServiceAccess));
  }
});
test('fixed endpoints reject paths, URLs, untyped inputs and resource pagination', () => {
  for (const id of ['https://example.test/', '../secrets', 'abc/def', 'abc?alt=media', '', '\n'])
    assert.equal(googleServiceRequest('docs.get-document', { resourceId: id }).ok, false);
  assert.equal(googleServiceRequest('sheets.get-spreadsheet', { resourceId: 5 }).ok, false);
  assert.equal(googleServiceRequest('docs.get-document', { resourceId: 'doc_123-ABC', pageToken: 'cursor' }).ok, false);
  assert.equal(googleServiceRequest('drive.list-files', { resourceId: 'doc' }).ok, false);
  assert.equal(googleServiceRequest('drive.list-files', { pageToken: {} }).ok, false);
  const doc = googleServiceRequest('docs.get-document', { resourceId: 'doc_123-ABC' });
  assert.ok(doc.ok); assert.equal(new URL(doc.url).origin, 'https://docs.googleapis.com');
});
test('opaque multi-page tokens retain exact query encoding without product length limits', () => {
  const token = '  +/&?#=opaque'.repeat(800);
  for (const operation of ['drive.list-files', 'gmail.list-messages', 'calendar.list-calendars', 'contacts.list-contacts'] as const) {
    const request = googleServiceRequest(operation, { pageToken: token });
    assert.ok(request.ok); assert.equal(new URL(request.url).searchParams.get('pageToken'), token);
  }
});
test('complete data retains long values, count, types and cursors while removing credentials', () => {
  const secret = 'synthetic.secret+$[value]';
  const data = { files: Array.from({ length: 550 }, (_, id) => ({ id, description: 'x'.repeat(9000), enabled: true })),
    nextPageToken: 'opaque/+'.repeat(1500), password: 'user-authored-field', token: 'ordinary-user-data', secret: 'ordinary-user-data', nested: { access_token: 'hidden', [secret]: `contains ${secret}`, unrelated: false }, nullable: null };
  const result = redactServiceResult(data, [secret]);
  assert.deepEqual(result.files, data.files); assert.equal(result.nextPageToken, data.nextPageToken);
  assert.equal(result.password, data.password); assert.equal(result.token, data.token); assert.equal(result.secret, data.secret); assert.equal(result.nested.access_token, '[redacted]');
  assert.equal(result.nested['[redacted]'], 'contains [redacted]'); assert.equal(result.nested.unrelated, false); assert.equal(result.nullable, null);
  assert.ok(!JSON.stringify(result).includes(secret));
});
