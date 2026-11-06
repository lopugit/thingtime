import { createHash } from 'node:crypto';
import type { TimelineSnapshot } from '../../../timeline/contract';
import type { BackupItem } from '../../../backups/manifest';
import type { AccountRestoreFamily } from '../../../backups/accountRestore';
import { themeContentSnapshot, themeContentValue } from '../../../timeline/themeContent';
import { accountContentSnapshot, accountContentValue } from '../../../timeline/accountContent';
import { BACKUP_RETAINED_PAYLOAD_BYTES, verifyBackupItemBytes } from './portableBackup';
import { backupThingJson, parseBackupThingSnapshot } from './thingSnapshots';
import { BACKUP_DRAFT_BYTES, backupDraftJson, parseBackupDraft } from './draftRecords';
import { BACKUP_THEME_BYTES } from './themeSnapshots';
import { BACKUP_ACCOUNT_BYTES } from './accountSnapshots';
import { BACKUP_TIMELINE_RECORD_BYTES, parseBackupTimelineRecord, timelineBackupJson, backupTimelineIdentity } from './timelineRecords';
import { backupAttachmentItemContent, parseBackupAttachment } from './attachmentRecords';
import { parseCloudFile } from '../../../fileSync/cloudFile';
import { backupJson } from '../../../backups/manifest';

type Range = { read(): Promise<Uint8Array> };
export type RestoreSourceRecord = {
	family: AccountRestoreFamily; value: any; kinds: string[]; crystal: Record<string, any>;
};
const wrappers: Record<string, number> = {
	'backup-thing-content': BACKUP_RETAINED_PAYLOAD_BYTES,
	'backup-draft': BACKUP_DRAFT_BYTES,
	'backup-theme-content': BACKUP_THEME_BYTES,
	'backup-account-content': BACKUP_ACCOUNT_BYTES,
	'backup-timeline-record': BACKUP_TIMELINE_RECORD_BYTES
};
/** One pass over this entry's already-open verified ranges. Never rescan the
 * inventory once per record, and never collect attachment bytes in memory. */
export async function readAccountRestoreRecord(item: BackupItem, ranges: AsyncIterable<Range>, ownerId: string): Promise<RestoreSourceRecord | null> {
	const adapter = item.snapshot.adapter;
	const maximum = item.snapshot.version === 1 && Object.prototype.hasOwnProperty.call(wrappers, adapter) ? wrappers[adapter] : undefined;
	const parts: Uint8Array[] = [];
	if (maximum && (!item.content || item.content.size > maximum)) throw Error('Invalid retained restore payload size');
	if (item.content) await verifyBackupItemBytes(item, (async function* () {
		for await (const range of ranges) {
			const bytes = await range.read();
			if (maximum) parts.push(bytes);
			yield bytes;
		}
	})());
	let payload: any = item.snapshot;
	let text: string | undefined;
	if (maximum) {
		const bytes = Buffer.concat(parts);
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		const descriptor = item.snapshot.value as any;
		const fields = adapter === 'backup-draft' ? ['deleted', 'mode', 'sha256'] : adapter === 'backup-timeline-record' ? ['kind', 'sha256'] : ['sha256'];
		if (!descriptor || Object.keys(descriptor).sort().join(',') !== fields.sort().join(',') ||
			createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw Error('Retained restore payload descriptor changed');
		payload = JSON.parse(text);
	}
	const content = (snapshot: TimelineSnapshot): RestoreSourceRecord => {
		const value = parseBackupThingSnapshot(snapshot).value as any;
		if (text !== undefined && backupThingJson(snapshot) !== text) throw Error('Noncanonical restore content');
		return { family: 'ordinary', kinds: value.thingtime, crystal: value.crystal, value };
	};
	if (adapter === 'thing-content' && item.snapshot.version === 1 && item.content === null) return content(payload);
	if (adapter === 'backup-thing-content' && maximum) return content(payload);
	if ((adapter === 'theme-content' && [1, 2].includes(item.snapshot.version) && item.content === null) || (adapter === 'backup-theme-content' && maximum)) {
		const value = themeContentValue(payload);
		if (text !== undefined && backupJson(themeContentSnapshot(value, payload.version), BACKUP_THEME_BYTES) !== text) throw Error('Noncanonical restore theme');
		return { family: 'themes', kinds: ['theme'], crystal: value.crystal, value };
	}
	if (adapter === 'file-content' && item.snapshot.version === 1) {
		if (item.content !== null) throw Error('Not an account backup file descriptor');
		const value = parseCloudFile(item.snapshot.value);
		if (value.id !== item.thingId || value.revision !== item.revision) throw Error('Restore file identity changed');
		return { family: 'files', kinds: ['file'], crystal: {}, value };
	}
	if (adapter === 'backup-attachment' && item.snapshot.version === 1) {
		backupAttachmentItemContent(item);
		const value = parseBackupAttachment(item.snapshot.value);
		if (value.ownerId !== ownerId || value.id !== item.thingId) throw Error('Restore attachment owner changed');
		return { family: 'attachments', kinds: ['attachment'], crystal: {}, value };
	}
	if (adapter === 'backup-draft' && maximum) {
		const value = parseBackupDraft(payload), descriptor = item.snapshot.value as any;
		if (backupDraftJson(value) !== text || value.ownerId !== ownerId || value.value.id !== item.thingId || item.revision !== 'draft-' + value.value.revision ||
			value.deleted !== descriptor.deleted || value.value.mode !== descriptor.mode) throw Error('Restore draft identity changed');
		return { family: 'drafts', kinds: ['draft'], crystal: {}, value };
	}
	if (adapter === 'backup-account-content' && maximum) {
		const value = accountContentValue(payload);
		if (backupJson(accountContentSnapshot(value), BACKUP_ACCOUNT_BYTES) !== text || value.ownerId !== ownerId || item.thingId !== ownerId ||
			item.revision !== 'snapshot-' + (item.snapshot.value as any).sha256) throw Error('Restore account identity changed');
		return { family: 'account-content', kinds: ['user'], crystal: {}, value };
	}
	if (adapter === 'backup-timeline-record' && maximum) {
		const value = parseBackupTimelineRecord(payload), identity = backupTimelineIdentity(value), descriptor = item.snapshot.value as any;
		if (timelineBackupJson(value) !== text || identity.ownerId !== ownerId || identity.thingId !== item.thingId || value.kind !== descriptor.kind ||
			item.revision !== 'snapshot-' + descriptor.sha256) throw Error('Restore Timeline identity changed');
		return { family: 'timeline', kinds: [value.kind], crystal: {}, value };
	}
	return null;
}
