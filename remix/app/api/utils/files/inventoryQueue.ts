import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type InventoryFolderWork = { id: string; path: string; depth: number };
export const INVENTORY_QUEUE_BYTES = 128 * 1024 * 1024;
const RECORD_BYTES = 8192;

/** Request-owned scratch space, not a saved capture or recovery journal. Keep
 * wide directory frontiers on disk; the consumer retains at most one batch.
 * An interrupted request must start a new snapshot, never reuse this queue. */
export async function openInventoryQueue(maxBytes = INVENTORY_QUEUE_BYTES) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > INVENTORY_QUEUE_BYTES) throw Error('Invalid inventory workspace bound');
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-inventory-'));
	let handle;
	try { handle = await open(join(directory, 'frontier'), constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); }
	catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
	let written = 0, consumed = 0, closed = false;
	const check = () => { if (closed) throw Error('Inventory workspace is closed'); };
	const readExact = async (size: number) => {
		const bytes = Buffer.alloc(size); let offset = 0;
		while (offset < size) {
			const result = await handle.read(bytes, offset, size - offset, consumed + offset);
			if (!result.bytesRead) throw Error('Inventory workspace is incomplete');
			offset += result.bytesRead;
		}
		consumed += size; return bytes;
	};
	return {
		async append(folder: InventoryFolderWork) {
			check();
			const body = Buffer.from(JSON.stringify(folder));
			if (body.length > RECORD_BYTES || written + body.length + 4 > maxBytes) throw Error('Inventory workspace exceeds its disk bound');
			const record = Buffer.alloc(body.length + 4); record.writeUInt32BE(body.length); body.copy(record, 4);
			let offset = 0;
			while (offset < record.length) {
				const result = await handle.write(record, offset, record.length - offset, written + offset);
				if (!result.bytesWritten) throw Error('Inventory workspace write was interrupted');
				offset += result.bytesWritten;
			}
			written += record.length;
		},
		async read(limit = 128): Promise<InventoryFolderWork[]> {
			check();
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw Error('Invalid inventory workspace batch');
			const rows: InventoryFolderWork[] = [];
			while (consumed < written && rows.length < limit) {
				const length = (await readExact(4)).readUInt32BE();
				if (length > RECORD_BYTES || consumed + length > written) throw Error('Inventory workspace is incomplete');
				rows.push(JSON.parse((await readExact(length)).toString('utf8')));
			}
			return rows;
		},
		async close() {
			if (closed) return;
			closed = true;
			try { await handle.close(); } finally { await rm(directory, { recursive: true, force: true }); }
		}
	};
}
