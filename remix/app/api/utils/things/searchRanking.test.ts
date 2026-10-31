import assert from 'node:assert/strict';
import test from 'node:test';

import { attachRankScores } from './searchRanking.ts';

test('ranked search projections carry their real Mongo text score by Thing id', () => {
  assert.deepEqual(
    attachRankScores(
      [{ id: 'thing-b', title: 'B' }, { id: 'thing-a', title: 'A' }],
      [{ shareId: 'thing-a', score: 4.25 }, { shareId: 'thing-b', score: 2 }]
    ),
    [
      { id: 'thing-b', title: 'B', rankScore: 2 },
      { id: 'thing-a', title: 'A', rankScore: 4.25 }
    ]
  );
});

test('unranked and invalid scores stay absent from the public result', () => {
  assert.deepEqual(
    attachRankScores(
      [{ id: 'unranked' }, { id: 'invalid' }],
      [{ shareId: 'invalid', score: Number.NaN }]
    ),
    [{ id: 'unranked' }, { id: 'invalid' }]
  );
});
