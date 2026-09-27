import assert from 'node:assert/strict';
import test from 'node:test';
import { componentUploadCommitId, componentUploadCommitInput } from './componentUploadCommit';
import { validateThingtimeCrystal } from '../../schemas/registry';

test('Use file submits a valid private post through the real crystal write gate', () => {
	for (const hasVisual of [true, false]) {
		const payload = componentUploadCommitInput(['ready-file'], 'stable-upload-target');
		const result = validateThingtimeCrystal(payload.thingtime, payload.crystal, { postAttachments: { hasAny: true, hasVisual } });
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.deepEqual(payload.acl, ['tt:user']);
		assert.deepEqual(payload.attachmentIds, ['ready-file']);
		assert.equal(payload.shareId, 'stable-upload-target');
	}
});

test('upload retry identities clear the actual Thing reserved-prefix gate', async () => {
  const { sanitizeShareId } = await import('../../api/utils/things/things');
  const id = componentUploadCommitId();
  assert.equal(sanitizeShareId(id), id);
  assert.notEqual(sanitizeShareId('component-upload-' + id), 'component-upload-' + id);
});
