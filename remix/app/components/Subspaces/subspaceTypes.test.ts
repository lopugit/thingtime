import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { modQueueCount, openReportCount, openReportCountWithout, reportsSettledByCard } from './subspaceTypes.ts';

// The Reports tab's badge arithmetic (round 2, S5 review): the open-report
// count is report ROWS, so a group leaving the queue takes its reportCount
// with it (never "one per group"), and only the server's re-projection after
// a moderator's remove / approve (reportCount 0 on a group that had rows)
// tells the panel a card's own action settled the group.
test('openReportCountWithout subtracts the group’s rows and never goes negative', () => {
	assert.equal(openReportCountWithout(3, { reportCount: 3 }), 0);
	assert.equal(openReportCountWithout(5, { reportCount: 2 }), 3);
	assert.equal(openReportCountWithout(1, { reportCount: 3 }), 0);
	assert.equal(openReportCountWithout(0, { reportCount: 1 }), 0);
	assert.equal(openReportCountWithout(4, { reportCount: -2 } as any), 4);
});

test('reportsSettledByCard fires only for an open group whose re-projected post reads reportCount 0', () => {
	const open = { status: 'open' as const, reportCount: 2 };
	assert.equal(reportsSettledByCard(open, { subspaceMod: { reportCount: 0 } }), true);
	// the card's optimistic removal paint carries no reportCount — not a verdict
	assert.equal(reportsSettledByCard(open, { subspaceMod: { removed: true } as any }), false);
	// a reaction spread keeps the previous count — still open
	assert.equal(reportsSettledByCard(open, { subspaceMod: { reportCount: 2 } }), false);
	assert.equal(reportsSettledByCard(open, { subspaceMod: null }), false);
	assert.equal(reportsSettledByCard(open, null), false);
	// resolved groups and groups with no rows are never "settled by a card"
	assert.equal(reportsSettledByCard({ status: 'resolved', reportCount: 2 }, { subspaceMod: { reportCount: 0 } }), false);
	assert.equal(reportsSettledByCard({ status: 'open', reportCount: 0 }, { subspaceMod: { reportCount: 0 } }), false);
});

test('openReportCount / modQueueCount read the mods-only counts, 0 without them', () => {
	assert.equal(openReportCount(null), 0);
	assert.equal(openReportCount({ openReportCount: 4 }), 4);
	assert.equal(modQueueCount({ pendingCount: 1, approvalRequestCount: 2, openReportCount: 3 }), 6);
	assert.equal(modQueueCount({}), 0);
});
