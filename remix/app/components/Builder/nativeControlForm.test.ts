import assert from 'node:assert/strict';
import test from 'node:test';
import { formCompletionMatches } from './nativeControlForm';

test('only a successful receipt for this form operation completes its draft', () => {
	const receipt = { ok: true, result: { shareId: 'current-operation' } };
	assert.equal(formCompletionMatches(receipt, 'shareId', 'current-operation'), true);
	assert.equal(formCompletionMatches(receipt, 'shareId', 'next-operation'), false, 'an old receipt cannot complete the next draft');
	assert.equal(formCompletionMatches(receipt, 'shareId', 'sibling-operation'), false, 'another form retains its draft');
	assert.equal(formCompletionMatches({ ...receipt, ok: false }, 'shareId', 'current-operation'), false, 'failed writes retain retry identity');
	assert.equal(formCompletionMatches({ ...receipt, ok: 'true' }, 'shareId', 'current-operation'), false);
	for (const completion of [undefined, null, [], {}, { ok: true, result: [] }, { ok: true, result: Object.create(receipt.result) }]) {
		assert.equal(formCompletionMatches(completion, 'shareId', 'current-operation'), false);
	}
});
