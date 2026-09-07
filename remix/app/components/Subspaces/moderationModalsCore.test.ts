import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { buildRemoveChoice, CUSTOM_PICK, noteMaxFor, pickHead, reasonValue, ruleValue } from './moderationModalsCore.ts';

// The RemoveModal's pure half (round 2, S4 review): the note bound follows
// the pick so nothing typed is sliced off server-side, a rule pick travels
// as ruleIndex (the server composes + bounds), and the ban follow-up gets
// the SHORT reason.
const detail = {
	rules: [
		{ title: 'Be kind', text: null },
		{ title: 'No spam', text: 'Ads go elsewhere.' }
	],
	removalReasons: [
		{ id: 'no-spam', title: 'No spam', message: 'Posts that only advertise are removed.' },
		{ id: 'bare', title: 'Bare', message: '' }
	]
};
const extras = { lock: false, ban: false, banDays: '' };

test('pickHead mirrors the server composition: title — message / Rule N: title — text, with the short citation', () => {
	assert.deepEqual(pickHead(reasonValue('no-spam'), detail), { head: 'No spam — Posts that only advertise are removed.', citation: 'No spam' });
	assert.deepEqual(pickHead(reasonValue('bare'), detail), { head: 'Bare', citation: 'Bare' });
	assert.deepEqual(pickHead(ruleValue(1), detail), { head: 'Rule 2: No spam — Ads go elsewhere.', citation: 'Rule 2: No spam' });
	assert.deepEqual(pickHead(ruleValue(0), detail), { head: 'Rule 1: Be kind', citation: 'Rule 1: Be kind' });
	assert.equal(pickHead(CUSTOM_PICK, detail), null);
	assert.equal(pickHead(reasonValue('ghost'), detail), null);
	assert.equal(pickHead(ruleValue(7), detail), null);
	assert.equal(pickHead(ruleValue(0), null), null, 'nothing loaded yet');
});

test('noteMaxFor: 300 on its own, and beside a pick whatever the 900-char composed cap leaves', () => {
	assert.equal(noteMaxFor(CUSTOM_PICK, detail), 300);
	assert.equal(noteMaxFor(reasonValue('no-spam'), detail), 300, 'a short head leaves the full 300');
	// the longest canned head (80 + 3 + 500) still leaves ≥ 300
	const longReason = { rules: [], removalReasons: [{ id: 'long', title: 't'.repeat(80), message: 'm'.repeat(500) }] };
	assert.equal(noteMaxFor(reasonValue('long'), longReason), 300);
	// the longest rule head ("Rule 15: " + 100 + 3 + 500 = 612) does not
	const longRules = { removalReasons: [], rules: new Array(15).fill({ title: 't'.repeat(100), text: 'x'.repeat(500) }) };
	assert.equal(noteMaxFor(ruleValue(14), longRules), 900 - 612 - 3);
	assert.ok(noteMaxFor(ruleValue(14), longRules) < 300);
	// before the detail loads a rule pick can't exist, a reason pick reads as free text
	assert.equal(noteMaxFor(reasonValue('no-spam'), null), 300);
});

test('buildRemoveChoice: a canned reason travels as reasonId + note; preview is the composed text; the ban reason is the title', () => {
	assert.deepEqual(buildRemoveChoice(reasonValue('no-spam'), '  third   time ', detail, extras), {
		reason: 'third time',
		reasonId: 'no-spam',
		ruleIndex: null,
		previewReason: 'No spam — Posts that only advertise are removed. · third time',
		banReason: 'No spam',
		lock: false,
		ban: false,
		banDays: null
	});
	assert.deepEqual(buildRemoveChoice(reasonValue('bare'), '', detail, extras).previewReason, 'Bare');
	assert.equal(buildRemoveChoice(reasonValue('bare'), '', detail, extras).reason, null);
});

test('buildRemoveChoice: a rule travels as ruleIndex (never as composed free text); the ban reason is the citation', () => {
	const choice = buildRemoveChoice(ruleValue(1), 'duplicate thread', detail, { lock: true, ban: true, banDays: '3' });
	assert.deepEqual(choice, {
		reason: 'duplicate thread',
		reasonId: null,
		ruleIndex: 1,
		previewReason: 'Rule 2: No spam — Ads go elsewhere. · duplicate thread',
		banReason: 'Rule 2: No spam',
		lock: true,
		ban: true,
		banDays: 3
	});
	// a rule the loaded detail does not have (edited meanwhile) → the note alone, no ruleIndex
	assert.deepEqual(buildRemoveChoice(ruleValue(9), 'note', detail, extras), { reason: 'note', reasonId: null, ruleIndex: null, previewReason: 'note', banReason: 'note', lock: false, ban: false, banDays: null });
});

test('buildRemoveChoice: custom text is the reason, the preview and the ban reason; the note is bounded to the pick', () => {
	assert.deepEqual(buildRemoveChoice(CUSTOM_PICK, ' be  nicer ', detail, extras), { reason: 'be nicer', reasonId: null, ruleIndex: null, previewReason: 'be nicer', banReason: 'be nicer', lock: false, ban: false, banDays: null });
	assert.equal(buildRemoveChoice(CUSTOM_PICK, 'x'.repeat(400), detail, extras).reason?.length, 300);
	const longRules = { removalReasons: [], rules: new Array(15).fill({ title: 't'.repeat(100), text: 'x'.repeat(500) }) };
	const bounded = buildRemoveChoice(ruleValue(14), 'n'.repeat(300), longRules, extras);
	assert.equal(bounded.reason?.length, 285);
	assert.equal(bounded.previewReason?.length, 900, 'the preview never exceeds what the server stores');
	// ban days: only with the ban checked, whole positive days
	assert.equal(buildRemoveChoice(CUSTOM_PICK, '', detail, { lock: false, ban: false, banDays: '7' }).banDays, null);
	assert.equal(buildRemoveChoice(CUSTOM_PICK, '', detail, { lock: false, ban: true, banDays: '7.9' }).banDays, 7);
	assert.equal(buildRemoveChoice(CUSTOM_PICK, '', detail, { lock: false, ban: true, banDays: '' }).banDays, null, 'blank = permanent');
});
