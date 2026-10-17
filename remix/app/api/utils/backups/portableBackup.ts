import { createHash } from 'node:crypto';
import { timelineScopeKey, type TimelineScope } from '../../../timeline/contract';
import {
	BACKUP_FORMAT,
	BACKUP_CHUNK_BYTES,
	BACKUP_PAGE_ITEMS,
	BACKUP_PAGE_BYTES,
	BACKUP_METADATA_BYTES,
	backupId,
	backupJson,
	parseBackupHeader,
	parseBackupItem,
	parseBackupPage,
	parseBackupPlan,
	parseBackupRangePage,
	parseBackupSeal,
	type BackupHeader,
	type BackupItem,
	type BackupPlan,
	type BackupRange,
	type BackupSeal
} from '../../../backups/manifest';

/** Internal provider boundary: writes are immutable create-if-absent, comparing
 * exact bytes on retry, and must be durable before resolving. No live-source
 * references, URLs or credentials are stored here. Providers own access/quota. */
export interface BackupObjectStore {
	read(key: string, maxBytes: number): Promise<Uint8Array | null>;
	put(key: string, bytes: Uint8Array): Promise<void>;
}
export type BackupAccess = { scope: TimelineScope; authorize(): Promise<void>; signal?: AbortSignal };
export type BackupSource = { read(item: BackupItem, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> };
const utf8 = new TextEncoder();
const digest = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const prefix = (id: string) => {
	if (!backupId(id)) throw Error('Invalid backup identity');
	return `snapshots/${id}`;
};
const check = async (access: BackupAccess, header?: BackupHeader) => {
	access.signal?.throwIfAborted();
	if (header && timelineScopeKey(header.scope) !== timelineScopeKey(access.scope)) throw Error('Backup account or origin changed');
	await access.authorize();
	access.signal?.throwIfAborted();
};
const readJson = async (store: BackupObjectStore, key: string, max = BACKUP_PAGE_BYTES) => {
	const bytes = await store.read(key, max);
	if (bytes === null) return null;
	if (bytes.byteLength > max) throw Error('Backup metadata exceeds its bound');
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
		value = JSON.parse(text);
	if (backupJson(value, max) !== text) throw Error('Backup metadata is not canonical');
	return value;
};
const putJson = async (store: BackupObjectStore, key: string, value: unknown, access: BackupAccess, header: BackupHeader) => {
	await check(access, header);
	await store.put(key, utf8.encode(backupJson(value)));
	await check(access, header);
};

/** Freeze the full metadata inventory before byte capture. Failed enumeration
 * leaves no plan seal; retry requires exactly the original header and pages.
 * Items are strictly ordered by Thing ID, avoiding an unbounded duplicate set. */
export async function prepareBackup(
	store: BackupObjectStore,
	input: BackupHeader,
	items: AsyncIterable<BackupItem>,
	access: BackupAccess
): Promise<BackupPlan> {
	const header = parseBackupHeader(input),
		root = prefix(header.snapshotId);
	await check(access, header);
	await putJson(store, `${root}/header.json`, header, access, header);
	let pending: BackupItem[] = [],
		pages = 0,
		count = 0,
		bytes = BigInt(0),
		previous: string | null = null,
		lastId = '';
	const flush = async () => {
		if (!pending.length) return;
		const page = parseBackupPage({ format: BACKUP_FORMAT, snapshotId: header.snapshotId, ordinal: pages, previous, items: pending });
		await putJson(store, `${root}/plan/${pages}.json`, page, access, header);
		previous = digest(backupJson(page));
		pages++;
		pending = [];
	};
	for await (const raw of items) {
		await check(access, header);
		const item = parseBackupItem(raw);
		if (item.ordinal !== count || item.thingId <= lastId) throw Error('Backup inventory is unordered or repeats an item');
		if (
			pending.length &&
			(pending.length === BACKUP_PAGE_ITEMS ||
				Buffer.byteLength(backupJson(pending)) + Buffer.byteLength(backupJson(item)) + 1024 > BACKUP_PAGE_BYTES)
		)
			await flush();
		pending.push(item);
		count++;
		lastId = item.thingId;
		bytes += BigInt(item.content?.size ?? 0);
		if (!Number.isSafeInteger(count)) throw Error('Backup item count exceeds the format');
	}
	await flush();
	const plan = parseBackupPlan({
		format: BACKUP_FORMAT,
		snapshotId: header.snapshotId,
		headerHash: digest(backupJson(header)),
		pages,
		headHash: previous,
		items: count,
		bytes: bytes.toString()
	});
	// The plan seal is written last. A partial enumeration can never be captured.
	await putJson(store, `${root}/plan.json`, plan, access, header);
	return plan;
}

async function openPlan(store: BackupObjectStore, id: string, access: BackupAccess) {
	await check(access);
	const root = prefix(id);
	const header = parseBackupHeader(await readJson(store, `${root}/header.json`, BACKUP_METADATA_BYTES));
	await check(access, header);
	const plan = parseBackupPlan(await readJson(store, `${root}/plan.json`, BACKUP_METADATA_BYTES));
	if (header.snapshotId !== id || plan.snapshotId !== id || plan.headerHash !== digest(backupJson(header)))
		throw Error('Backup plan identity changed');
	return { root, header, plan };
}
async function* planItems(store: BackupObjectStore, header: BackupHeader, plan: BackupPlan, access: BackupAccess) {
	let previous: string | null = null,
		count = 0,
		bytes = BigInt(0),
		lastId = '';
	for (let ordinal = 0; ordinal < plan.pages; ordinal++) {
		await check(access, header);
		const page = parseBackupPage(await readJson(store, `${prefix(header.snapshotId)}/plan/${ordinal}.json`));
		if (page.snapshotId !== header.snapshotId || page.ordinal !== ordinal || page.previous !== previous) throw Error('Backup page sequence changed');
		previous = digest(backupJson(page));
		for (const item of page.items) {
			if (item.ordinal !== count || item.thingId <= lastId) throw Error('Backup inventory is unordered or repeats an item');
			count++;
			lastId = item.thingId;
			bytes += BigInt(item.content?.size ?? 0);
			yield item;
		}
	}
	if (previous !== plan.headHash || count !== plan.items || bytes.toString() !== plan.bytes) throw Error('Backup inventory is incomplete');
}
function validateRanges(value: unknown, id: string, item: BackupItem, ordinal: number, offset: number) {
	const page = parseBackupRangePage(value);
	if (page.snapshotId !== id || page.item !== item.ordinal || page.ordinal !== ordinal || !item.content) throw Error('Backup range identity changed');
	for (const range of page.ranges) {
		if (range.offset !== offset || range.length !== Math.min(BACKUP_CHUNK_BYTES, item.content.size - offset))
			throw Error('Backup ranges have a gap, overlap or wrong length');
		offset += range.length;
	}
	return { page, offset };
}
async function retainedChunk(store: BackupObjectStore, range: BackupRange): Promise<Uint8Array> {
	const bytes = await store.read(`chunks/${range.sha256}`, BACKUP_CHUNK_BYTES);
	if (!bytes || bytes.byteLength !== range.length || digest(bytes) !== range.sha256) throw Error('Retained backup bytes are missing or corrupt');
	return bytes;
}

/** Long-running native/worker capture, with bounded memory and durable range
 * pages. Restart scans only receipt metadata for captured ranges; final sealing
 * independently verifies every retained byte. An unfinished page can reread at
 * most rangePageItems chunks after a crash. This must not run in one serverless
 * request. Worker scheduling/leases and cloud providers are separate adapters. */
export async function captureBackup(
	store: BackupObjectStore,
	id: string,
	source: BackupSource,
	access: BackupAccess,
	options: { rangePageItems?: number; progress?(value: { copiedBytes: string; reusedBytes: string }): void } = {}
): Promise<{ copiedBytes: string; reusedBytes: string }> {
	const rangePageItems = options.rangePageItems ?? 8;
	if (!Number.isSafeInteger(rangePageItems) || rangePageItems < 1 || rangePageItems > BACKUP_PAGE_ITEMS) throw Error('Invalid backup work budget');
	const { root, header, plan } = await openPlan(store, id, access);
	// Validate the entire frozen inventory before copying any source bytes.
	for await (const _item of planItems(store, header, plan, access)) {
		/* bounded verification */
	}
	let copiedBytes = BigInt(0),
		reusedBytes = BigInt(0);
	const progress = () => options.progress?.({ copiedBytes: copiedBytes.toString(), reusedBytes: reusedBytes.toString() });
	for await (const item of planItems(store, header, plan, access)) {
		if (!item.content) continue;
		let offset = 0,
			ordinal = 0;
		while (offset < item.content.size) {
			await check(access, header);
			const key = `${root}/ranges/${item.ordinal}/${ordinal}.json`,
				existing = await readJson(store, key, BACKUP_METADATA_BYTES);
			if (existing !== null) {
				const verified = validateRanges(existing, id, item, ordinal, offset);
				reusedBytes += BigInt(verified.offset - offset);
				offset = verified.offset;
				ordinal++;
				progress();
				continue;
			}
			const ranges: BackupRange[] = [];
			while (offset < item.content.size && ranges.length < rangePageItems) {
				const length = Math.min(BACKUP_CHUNK_BYTES, item.content.size - offset);
				await check(access, header);
				const bytes = await source.read(item, offset, length, access.signal);
				await check(access, header);
				if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) throw Error('Backup source returned an incomplete range');
				const sha256 = digest(bytes);
				await store.put(`chunks/${sha256}`, bytes);
				await check(access, header);
				const range = { offset, length, sha256 };
				await retainedChunk(store, range);
				ranges.push(range);
				offset += length;
				copiedBytes += BigInt(length);
			}
			await putJson(store, key, { format: BACKUP_FORMAT, snapshotId: id, item: item.ordinal, ordinal, ranges }, access, header);
			ordinal++;
			progress();
		}
	}
	return { copiedBytes: copiedBytes.toString(), reusedBytes: reusedBytes.toString() };
}

/** Reconstruct the canonical source fingerprint from retained chunks with
 * bounded memory, including multipart boundaries larger than a memory chunk. */
class FileFingerprint {
	private part = createHash('sha256');
	private composite = createHash('sha256');
	private offset = 0;
	private partBytes = 0;
	private item: BackupItem;
	constructor(item: BackupItem) {
		this.item = item;
	}
	update(bytes: Uint8Array) {
		const content = this.item.content!;
		for (let start = 0; start < bytes.length; ) {
			const count = Math.min(bytes.length - start, content.fingerprint!.partSizeBytes - this.partBytes);
			this.part.update(bytes.subarray(start, start + count));
			this.partBytes += count;
			this.offset += count;
			start += count;
			if (this.partBytes === content.fingerprint!.partSizeBytes || this.offset === content.size) {
				this.composite.update(this.part.digest());
				this.part = createHash('sha256');
				this.partBytes = 0;
			}
		}
	}
	verify() {
		if (this.item.content!.size === 0) return;
		if (this.offset !== this.item.content!.size || this.partBytes !== 0 || this.composite.digest('hex') !== this.item.content!.fingerprint!.sha256)
			throw Error('Backup bytes do not match the pinned source fingerprint');
	}
}

/** Stream verification from the independent destination only. The digest binds
 * the full plan and ordered range pages; no success is inferred from file count,
 * source availability, an existing seal, or a prior progress report. */
async function verifyManifest(store: BackupObjectStore, id: string, access: BackupAccess, verifyBytes: boolean): Promise<BackupSeal> {
	const { root, header, plan } = await openPlan(store, id, access),
		manifest = createHash('sha256');
	manifest.update(BACKUP_FORMAT + '\0' + backupJson(plan) + '\0');
	let chunks = BigInt(0);
	for await (const item of planItems(store, header, plan, access)) {
		if (!item.content) continue;
		const fingerprint = new FileFingerprint(item);
		let offset = 0,
			ordinal = 0;
		while (offset < item.content.size) {
			await check(access, header);
			const { page, offset: next } = validateRanges(
				await readJson(store, `${root}/ranges/${item.ordinal}/${ordinal}.json`, BACKUP_METADATA_BYTES),
				id,
				item,
				ordinal,
				offset
			);
			manifest.update(backupJson(page) + '\0');
			for (const range of page.ranges) {
				await check(access, header);
				if (verifyBytes) fingerprint.update(await retainedChunk(store, range));
				chunks++;
			}
			offset = next;
			ordinal++;
		}
		if (verifyBytes) fingerprint.verify();
	}
	await check(access, header);
	return parseBackupSeal({ ...plan, manifestHash: manifest.digest('hex'), chunks: chunks.toString() });
}
export const verifyBackup = (store: BackupObjectStore, id: string, access: BackupAccess) => verifyManifest(store, id, access, true);

export async function sealBackup(store: BackupObjectStore, id: string, access: BackupAccess): Promise<BackupSeal> {
	const seal = await verifyBackup(store, id, access),
		{ root, header } = await openPlan(store, id, access);
	await putJson(store, `${root}/complete.json`, seal, access, header);
	return seal;
}
/** A completion marker is checked against all retained bytes, even offline. */
export async function verifySealedBackup(store: BackupObjectStore, id: string, access: BackupAccess): Promise<BackupSeal> {
	await openPlan(store, id, access);
	const expected = parseBackupSeal(await readJson(store, `${prefix(id)}/complete.json`, BACKUP_METADATA_BYTES));
	const actual = await verifyBackup(store, id, access);
	if (backupJson(expected) !== backupJson(actual)) throw Error('Backup completion seal does not match its retained data');
	return actual;
}

async function verifySealedManifest(store: BackupObjectStore, id: string, access: BackupAccess) {
	await openPlan(store, id, access);
	const expected = parseBackupSeal(await readJson(store, `${prefix(id)}/complete.json`, BACKUP_METADATA_BYTES));
	const verified = await verifyManifest(store, id, access, false);
	if (backupJson(expected) !== backupJson(verified)) throw Error('Backup completion seal does not match its manifest');
	return verified;
}

/** Portable export to another independent provider. Interrupted copies retain
 * verified chunks/pages and resume under the same identity. The destination
 * receives a completion seal only after a full readback; no source path/URL is
 * needed. This primitive does not provision cloud buckets or ship physical media. */
export async function copySealedBackup(source: BackupObjectStore, destination: BackupObjectStore, id: string, access: BackupAccess) {
	// Validate source metadata once; fetch only chunks missing at the destination.
	// Re-reading the entire source before each resumed copy would retransmit
	// already captured terabytes. Final destination verification checks every byte.
	await verifySealedManifest(source, id, access);
	const { root, header, plan } = await openPlan(source, id, access);
	await putJson(destination, `${root}/header.json`, header, access, header);
	for (let i = 0; i < plan.pages; i++)
		await putJson(destination, `${root}/plan/${i}.json`, await readJson(source, `${root}/plan/${i}.json`), access, header);
	await putJson(destination, `${root}/plan.json`, plan, access, header);
	let copiedBytes = BigInt(0),
		reusedBytes = BigInt(0);
	for await (const item of planItems(source, header, plan, access)) {
		if (!item.content) continue;
		let offset = 0,
			ordinal = 0;
		while (offset < item.content.size) {
			await check(access, header);
			const key = `${root}/ranges/${item.ordinal}/${ordinal}.json`;
			const { page, offset: next } = validateRanges(await readJson(source, key, BACKUP_METADATA_BYTES), id, item, ordinal, offset);
			for (const range of page.ranges) {
				await check(access, header);
				const key = `chunks/${range.sha256}`,
					existing = await destination.read(key, BACKUP_CHUNK_BYTES);
				if (existing !== null) {
					if (existing.byteLength !== range.length || digest(existing) !== range.sha256) throw Error('Destination backup bytes are corrupt');
					reusedBytes += BigInt(range.length);
				} else {
					const bytes = await retainedChunk(source, range);
					await check(access, header);
					await destination.put(key, bytes);
					copiedBytes += BigInt(range.length);
				}
			}
			await putJson(destination, key, page, access, header);
			offset = next;
			ordinal++;
		}
	}
	const seal = await sealBackup(destination, id, access);
	return { seal, copiedBytes: copiedBytes.toString(), reusedBytes: reusedBytes.toString() };
}

/** Return verified ranges for a selected item. The consumer must write into
 * private staging and publish only after the iterator finishes successfully.
 * Metadata placement is not a filesystem path or permission grant. */
export async function openBackupItem(store: BackupObjectStore, id: string, thingId: string, access: BackupAccess) {
	await verifySealedManifest(store, id, access);
	const { root, header, plan } = await openPlan(store, id, access);
	let selected: BackupItem | undefined;
	for await (const item of planItems(store, header, plan, access)) if (item.thingId === thingId) selected = item;
	if (!selected) throw Error('Backup item not found');
	const item = selected;
	async function* ranges() {
		if (!item.content) return;
		let offset = 0,
			ordinal = 0;
		const fingerprint = new FileFingerprint(item);
		while (offset < item.content.size) {
			await check(access, header);
			const { page, offset: next } = validateRanges(
				await readJson(store, `${root}/ranges/${item.ordinal}/${ordinal}.json`, BACKUP_METADATA_BYTES),
				id,
				item,
				ordinal,
				offset
			);
			for (const range of page.ranges) {
				await check(access, header);
				const bytes = await retainedChunk(store, range);
				await check(access, header);
				fingerprint.update(bytes);
				yield bytes;
			}
			offset = next;
			ordinal++;
		}
		fingerprint.verify();
		await check(access, header);
	}
	return { item, ranges: ranges() };
}
