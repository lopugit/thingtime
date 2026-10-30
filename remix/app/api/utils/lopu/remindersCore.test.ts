import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReminderInput, nextReminderTime } from './remindersCore';
import { LOPU_TOOL_NAMES, validateLopuToolInput } from './chatTools';
const now = new Date('2026-09-09T10:00:00Z');
const input = { title: 'A gentle reminder', at: '2026-09-09T20:05:00+10:00', timeZone: 'Australia/Melbourne', everyMinutes: 5 };
test('reminders preserve absolute timezone-aware times and safe defaults', () => {
  assert.deepEqual(parseReminderInput(input, now), { ...input, at: '2026-09-09T10:05:00.000Z', description: '', delivery: 'normal' });
  assert.equal(parseReminderInput({ ...input, everyMinutes: undefined }, now).everyMinutes, null);
});
test('invalid times, frequencies, zones and delivery levels are rejected', () => {
  for (const patch of [{ at: '2026-09-09T10:05:00' }, { at: '2026-09-08T10:00:00Z' }, { at: '2028-01-01T00:00:00Z' }, { timeZone: 'bad/zone' }, { everyMinutes: 0 }, { everyMinutes: 4 }, { everyMinutes: 5.5 }, { everyMinutes: '5' }, { title: '' }, { title: 'x'.repeat(141) }, { delivery: 'critical' }]) assert.throws(() => parseReminderInput({ ...input, ...patch }, now), TypeError);
});
test('downtime skips missed intervals without a notification backlog', () => {
  assert.equal(nextReminderTime(now, null, now), null);
  assert.equal(nextReminderTime(now, 5, new Date('2026-09-09T10:17:00Z'))?.toISOString(), '2026-09-09T10:20:00.000Z');
  assert.equal(nextReminderTime(now, 5, now)?.toISOString(), '2026-09-09T10:05:00.000Z');
});
test('calendar schedules preserve local time and skip missed runs', () => {
  const calendar = parseReminderInput({ title: 'Daily update', cron: '0 9 * * *', timeZone: 'Australia/Melbourne', mode: 'assistant', chatId: 'lopu-chat-example', relatedThingIds: ['todo', 'todo'] }, now);
  assert.equal(calendar.at, '2026-09-09T23:00:00.000Z');
  assert.deepEqual(calendar.relatedThingIds, ['todo']);
  assert.equal(nextReminderTime(new Date(calendar.at), null, new Date('2026-10-05T00:00:00Z'), calendar)?.toISOString(), '2026-10-05T22:00:00.000Z');
  for (const patch of [{ cron: 'bad' }, { everyMinutes: 5 }, { newChatEachRun: true }, { mode: 'shell' }, { relatedThingIds: ['bad/id'] }]) assert.throws(() => parseReminderInput({ ...calendar, ...patch }, now), TypeError);
});
test('Lopu advertises actual Thing and notification tools with closed owner-free inputs', () => {
  for (const name of ['create_thing', 'create_reminder', 'send_notification', 'list_reminders', 'set_reminder_enabled']) assert.ok(LOPU_TOOL_NAMES.includes(name as any));
  const note = validateLopuToolInput('create_thing', { title: 'Private note', ownerId: 'other', acl: ['tt:all'] });
  assert.deepEqual(note, { ok: true, input: { title: 'Private note', type: 'note', description: '' } });
  assert.equal(validateLopuToolInput('create_thing', { title: 'Bad', type: 'user' }).ok, false);
  assert.equal(validateLopuToolInput('set_reminder_enabled', { id: 'reminder', enabled: 'true' }).ok, false);
  assert.equal(validateLopuToolInput('send_notification', { title: 'Hi', delivery: 'critical' }).ok, false);
});
