import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_RECORDING_SETTINGS,
	parseRecordingInsights,
	parseRecordingSettingsPatch,
	recordingReminderWindow,
	recordingRetryAt,
	recordingSettingsOf
} from './recordingsCore';

test('private audio processing requires opt-in; settings patches do not erase unrelated preferences', () => {
	assert.equal(recordingSettingsOf(null).enabled, false);
	assert.deepEqual(parseRecordingSettingsPatch({ enabled: true }), { enabled: true });
	assert.equal(recordingSettingsOf({ enabled: true, createTodos: false }).createTodos, false);
	assert.throws(() => parseRecordingSettingsPatch({ enabled: 'true' }));
	assert.throws(() => parseRecordingSettingsPatch({ ownerId: 'someone-else' }));
	assert.throws(() => parseRecordingSettingsPatch({ timeZone: 'invalid-zone' }));
	assert.throws(() => parseRecordingSettingsPatch({ reminderHour: 24 }));
});

test('daily reminders use local dates and wait for the preferred hour', () => {
	const settings = { ...DEFAULT_RECORDING_SETTINGS, timeZone: 'Australia/Melbourne', reminderHour: 9 };
	assert.deepEqual(recordingReminderWindow(new Date('2026-09-05T22:59:00Z'), settings), { day: '2026-09-06', due: false });
	assert.deepEqual(recordingReminderWindow(new Date('2026-09-05T23:00:00Z'), settings), { day: '2026-09-06', due: true });
	assert.equal(recordingReminderWindow(new Date('2026-10-03T22:00:00Z'), settings).due, true);
	const ny = { ...settings, timeZone: 'America/New_York', reminderHour: 1 };
	assert.deepEqual(recordingReminderWindow(new Date('2026-11-01T05:30:00Z'), ny), recordingReminderWindow(new Date('2026-11-01T06:30:00Z'), ny));
});

test('analysis accepts grounded todos for bike tubes and ART toothpaste', () => {
	const transcript = 'Remind me to buy bike tubes and ART toothpaste.';
	const items = [
		{ kind: 'todo', title: 'Buy bike tubes', description: '', evidence: 'buy bike tubes' },
		{ kind: 'todo', title: 'Buy ART toothpaste', description: '', evidence: 'ART toothpaste' }
	];
	assert.deepEqual(parseRecordingInsights(JSON.stringify({ items }), transcript), items);
	assert.equal(parseRecordingInsights(JSON.stringify({ items: [items[0], items[0]] }), transcript).length, 1);
	assert.deepEqual(parseRecordingInsights('{"items":[]}', 'Nothing to remember.'), []);
});

test('model output cannot invent evidence or introduce executable actions', () => {
	assert.throws(() => parseRecordingInsights('{"items":[{"kind":"shell","title":"run","evidence":"hello"}]}', 'hello'));
	assert.throws(() => parseRecordingInsights('{"items":[{"kind":"todo","title":"buy","evidence":"invented"}]}', 'hello'));
	assert.throws(() => parseRecordingInsights('not json', 'hello'));
	assert.throws(() => parseRecordingInsights('x'.repeat(70_000), 'hello'));
});

test('provider failures back off with a bounded delay', () => {
	const now = new Date('2026-09-06T00:00:00Z');
	assert.equal(recordingRetryAt(1, now).toISOString(), '2026-09-06T00:02:00.000Z');
	assert.equal(recordingRetryAt(100, now).toISOString(), '2026-09-06T01:00:00.000Z');
});
