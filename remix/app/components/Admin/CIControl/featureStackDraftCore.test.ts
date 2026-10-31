import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFeatureStackSources, sameNumberOrder } from './featureStackDraftCore';

test('saved Feature Stack PR numbers survive an unavailable dashboard snapshot', () => {
	assert.deepEqual(resolveFeatureStackSources([122, 115, 109], []), {
		selectedFeatureIds: [],
		pendingSourcePrNumbers: [122, 115, 109]
	});
});

test('saved Feature Stack sources rehydrate in order while unresolved PRs remain visible', () => {
	assert.deepEqual(
		resolveFeatureStackSources(
			[122, 115, 109],
			[
				{ number: 109, parentId: 'feature-109' },
				{ number: 122, parentId: 'feature-122' }
			]
		),
		{
			selectedFeatureIds: ['feature-122', 'feature-109'],
			pendingSourcePrNumbers: [115]
		}
	);
	assert.equal(sameNumberOrder([115], [115]), true);
	assert.equal(sameNumberOrder([115], [122]), false);
});
