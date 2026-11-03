import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rm, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const INVENTORY_UNIQUENESS_SLOTS = 4_194_304;
const SLOT_BYTES = 32, MAX_PROBES = 256;

/** Request-local uniqueness proof. A sparse, fixed-bound hash table retains no
 * growing JavaScript set and never stores names or IDs in scratch space. The
 * POSIX scratch file is unlinked before any keys are written, so even process
 * death releases its disk allocation. Hash
 * collisions fail closed as ambiguity. Nothing here survives a failed scan.
 * Callers serialize additions and must close the index before returning data. */
export async function openInventoryUniqueness(slots = INVENTORY_UNIQUENESS_SLOTS, parent = tmpdir()) {
	if (!Number.isSafeInteger(slots) || slots < 8 || slots > INVENTORY_UNIQUENESS_SLOTS || (slots & (slots - 1)))
		throw Error('Invalid inventory uniqueness bound');
	const directory = await mkdtemp(join(parent, 'thingtime-inventory-keys-'));
	let handle;
	try {
		handle = await open(join(directory, 'keys'), constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
		await unlink(join(directory, 'keys'));
		await rmdir(directory);
	} catch (error) {
		try { await handle?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
		throw error;
	}
	let count = 0, closed = false;
	return {
		async add(value: string, check: () => void = () => {}) {
			if (closed) throw Error('Inventory uniqueness workspace is closed');
			if (typeof value !== 'string' || Buffer.byteLength(value) > 32_784) throw Error('Invalid inventory uniqueness key');
			const key = createHash('sha256').update(value).digest(), current = Buffer.alloc(SLOT_BYTES);
			if (key.every(byte => byte === 0)) throw Error('Invalid inventory uniqueness digest');
			const start = key.readUInt32BE(0) & (slots - 1);
			for (let probe = 0; probe < Math.min(slots, MAX_PROBES); probe++) {
				check();
				const position = ((start + probe) & (slots - 1)) * SLOT_BYTES;
				current.fill(0);
				const { bytesRead } = await handle.read(current, 0, SLOT_BYTES, position);
				if (bytesRead !== 0 && bytesRead !== SLOT_BYTES) throw Error('Inventory uniqueness workspace is incomplete');
				if (current.equals(key)) return false;
				if (current.some(byte => byte !== 0)) continue;
				if (count >= slots / 2) throw Error('Inventory uniqueness workspace exceeds its disk bound');
				let offset = 0;
				while (offset < SLOT_BYTES) {
					check();
					const { bytesWritten } = await handle.write(key, offset, SLOT_BYTES - offset, position + offset);
					if (!bytesWritten) throw Error('Inventory uniqueness write was interrupted');
					offset += bytesWritten;
				}
				count++; check(); return true;
			}
			throw Error('Inventory uniqueness probe bound exceeded');
		},
		async close() {
			if (closed) return;
			closed = true;
			await handle.close();
		}
	};
}
