import { eventFixture, entryFixture } from '../../timeline/testFixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMELINE_EXPORT_FILENAME_MAX_CHARS, timelineExportFilename, timelineExportRecord, timelineExportText } from './timelineExportDownload.ts';

const event = { id: 'version-1234', thingId: 'thing:abc/def@x', ownerId: 'owner-1' };
const content = { adapter: 'thing-content', version: 1, value: {crystal:{name:'Edited'},extended:null,tags:[],geo:null,acl:['tt:user'],folderId:null} };
const fullEvent = eventFixture(event.id,{...event,label:'Edited',mode:'revision',source:'api',clientId:null,after:content});
const record = { formatVersion: 1, exportedAt: '2026-10-13T00:00:00.000Z', ...entryFixture(fullEvent), content, notes: [], name: null };

test('export file names keep both ids, replace unsafe characters and stay within the cap', () => {
	assert.equal(timelineExportFilename('thing:abc/def@x', 'version-1234'), 'history-thing_abc_def_x-version-1234.json');
	const long = timelineExportFilename('t'.repeat(200), 'e'.repeat(200));
	assert.equal(long.length, TIMELINE_EXPORT_FILENAME_MAX_CHARS);
	assert.ok(long.endsWith('.json'));
	assert.ok(long.startsWith('history-'));
	assert.match(timelineExportFilename('a b', 'c\u0000d'), /^history-a_b-c_d\.json$/);
});

test('an export is accepted as the record or its ok envelope, and only for the selected version', () => {
	assert.deepEqual(timelineExportRecord(record, event), record);
	assert.deepEqual(timelineExportRecord({ ok: true, export: record }, event), record);
	assert.throws(() => timelineExportRecord({ ...record, event: { ...record.event, id: 'version-9' } }, event), /another version/);
	assert.throws(() => timelineExportRecord({ ...record, event: { ...record.event, ownerId: 'owner-2' } }, event), /another version/);
	assert.throws(() => timelineExportRecord({ ...record, formatVersion: 2 }, event), /not a version file|JSON values/);
	assert.throws(() => timelineExportRecord({ ...record, content: undefined }, event), /not a version file|JSON values/);
	assert.throws(() => timelineExportRecord(null, event), /not a version file|JSON values/);
	assert.equal(JSON.parse(timelineExportText(record)).event.id, 'version-1234');
	assert.ok(timelineExportText(record).includes('\n  "formatVersion": 1'));
});
