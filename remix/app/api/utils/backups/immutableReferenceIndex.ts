import { createHash, randomUUID } from 'node:crypto';
import { BACKUP_METADATA_BYTES, backupDigest, backupJson } from '../../../backups/manifest';
import { canonicalJsonBytes, parseJsonBytes } from '../../../utils/canonicalJsonStream';
import { copyBoundedJson } from '../../../utils/boundedJson';
import type { BackupObjectStore } from './portableBackup';
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export type ReferenceBlob = { sha256: string; bytes: number; chunks: number; inline?: any };
type ReferenceKey = { hash: string; encoded: string };
type Node = { key: string; keyBlob: ReferenceBlob; value: any } | { prefix: string; children: Record<string, string> };
export const validReferenceNodeRef = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-f0-9]{64}:(0|[1-9][0-9]{0,15}):[a-f0-9]{64}$/.test(value);
const BUNDLE_PENDING_BYTES = 192 * 1024,
	BUNDLE_BYTES = 512 * 1024,
	CACHE_BYTES = 1024 * 1024;
/** Private compressed radix index. Per-unit immutable bundles amortize provider
 * and authorization effects; every referenced node still has its own SHA and
 * exact key. The deterministic unit identity comes from the accepted input
 * cursor. All caches/buffers are byte bounded and local to this one advance. */
export function immutableReferenceIndex(
	store: BackupObjectStore,
	prefix: string,
	check: () => Promise<void>,
	tick: () => void = () => {},
	unit = digest(randomUUID())
) {
	if (!backupDigest(unit)) throw Error('Invalid reference unit identity');
	const cache = new Map<string, { node: Node; bytes: number }>();
	let cacheBytes = 0,
		bundleOrdinal = 0,
		pendingBytes = 0;
	const pending = new Map<string, { value: Node; bytes: number }>();
	let checkedOrdinal = -1,
		adopted: Map<string, Node> | null = null;
	const remember = (ref: string, node: Node, bytes: number) => {
		if (cache.has(ref)) return;
		while (cache.size && cacheBytes + bytes > CACHE_BYTES) {
			const first = cache.keys().next().value!;
			cacheBytes -= cache.get(first)!.bytes;
			cache.delete(first);
		}
		if (bytes <= CACHE_BYTES) {
			cache.set(ref, { node, bytes });
			cacheBytes += bytes;
		}
	};
	const putValue = async (value: unknown) => {
		await check();
		const bytes = Buffer.from(backupJson(value, BACKUP_METADATA_BYTES)),
			hash = digest(bytes);
		await store.put(`${prefix}/nodes/${hash}`, bytes);
		await check();
		return hash;
	};
	const readValue = async (hash: string) => {
		if (!backupDigest(hash)) throw Error('Invalid reference index identity');
		await check();
		const bytes = await store.read(`${prefix}/nodes/${hash}`, BACKUP_METADATA_BYTES);
		await check();
		if (!bytes || digest(bytes) !== hash) throw Error('Reference state is missing or changed');
		const value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
		if (backupJson(value, BACKUP_METADATA_BYTES) !== Buffer.from(bytes).toString()) throw Error('Noncanonical reference state');
		return value;
	};
	const flush = async () => {
		if (!pending.size) return;
		const value = {
			format: 'thingtime-reference-bundle-v1',
			namespace: prefix,
			unit,
			ordinal: bundleOrdinal,
			nodes: [...pending.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([hash, entry]) => ({ hash, value: entry.value }))
		};
		const bytes = Buffer.from(backupJson(value, BUNDLE_BYTES));
		await check();
		await store.put(`${prefix}/bundles/${unit}/${bundleOrdinal}.json`, bytes);
		await check();
		pending.clear();
		pendingBytes = 0;
		bundleOrdinal++;
	};
	const putNode = async (value: Node) => {
		tick();
		const canonical = backupJson(value, BACKUP_METADATA_BYTES),
			bytes = Buffer.byteLength(canonical),
			hash = digest(canonical);
		if (pending.size && pendingBytes + bytes > BUNDLE_PENDING_BYTES) await flush();
		// An earlier attempt may have durably published a final partial bundle
		// before losing its reply. Its bytes are immutable even if this retry's
		// time cutoff changes. Adopt verified nodes; append only to unused keys.
		for (;;) {
			if (checkedOrdinal !== bundleOrdinal) {
				adopted = await loadBundle(unit, String(bundleOrdinal), true);
				checkedOrdinal = bundleOrdinal;
			}
			if (!adopted) break;
			const existing = adopted.get(hash);
			if (existing) {
				if (backupJson(existing, BACKUP_METADATA_BYTES) !== canonical) throw Error('Reference node identity changed');
				const ref = `${unit}:${bundleOrdinal}:${hash}`;
				remember(ref, existing, bytes);
				return ref;
			}
			bundleOrdinal++;
		}
		if (!pending.has(hash)) {
			pending.set(hash, { value, bytes });
			pendingBytes += bytes;
		}
		const ref = `${unit}:${bundleOrdinal}:${hash}`;
		remember(ref, value, bytes);
		return ref;
	};
	const validateNode = (value: any): Node => {
		const keys = Object.keys(value ?? {})
			.sort()
			.join(',');
		if (keys === 'key,keyBlob,value' && backupDigest(value.key) && value.keyBlob) return value;
		if (
			keys === 'children,prefix' &&
			typeof value.prefix === 'string' &&
			/^[a-f0-9]{0,63}$/.test(value.prefix) &&
			value.children &&
			typeof value.children === 'object' &&
			!Array.isArray(value.children) &&
			Object.keys(value.children).length >= 2 &&
			Object.keys(value.children).every((key) => /^[a-f0-9]$/.test(key) && validReferenceNodeRef(value.children[key]))
		)
			return value;
		throw Error('Invalid immutable reference node');
	};
	const loadBundle = async (requestedUnit: string, ordinal: string, optional = false): Promise<Map<string, Node> | null> => {
		await check();
		const bytes = await store.read(`${prefix}/bundles/${requestedUnit}/${ordinal}.json`, BUNDLE_BYTES);
		await check();
		if (!bytes) {
			if (optional) return null;
			throw Error('Reference bundle is missing');
		}
		const bundle = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
		if (
			backupJson(bundle, BUNDLE_BYTES) !== Buffer.from(bytes).toString() ||
			Object.keys(bundle).sort().join(',') !== 'format,namespace,nodes,ordinal,unit' ||
			bundle.format !== 'thingtime-reference-bundle-v1' ||
			bundle.namespace !== prefix ||
			bundle.unit !== requestedUnit ||
			String(bundle.ordinal) !== ordinal ||
			!Array.isArray(bundle.nodes)
		)
			throw Error('Reference bundle changed');
		const nodes = new Map<string, Node>();
		for (const entry of bundle.nodes) {
			tick();
			if (!entry || Object.keys(entry).sort().join(',') !== 'hash,value' || !backupDigest(entry.hash) || nodes.has(entry.hash))
				throw Error('Invalid reference bundle entry');
			const canonical = backupJson(entry.value, BACKUP_METADATA_BYTES);
			if (digest(canonical) !== entry.hash) throw Error('Reference bundle node changed');
			const node = validateNode(entry.value);
			nodes.set(entry.hash, node);
			remember(`${requestedUnit}:${ordinal}:${entry.hash}`, node, Buffer.byteLength(canonical));
		}
		return nodes;
	};
	const read = async (ref: string): Promise<Node> => {
		tick();
		if (!validReferenceNodeRef(ref)) throw Error('Invalid reference node identity');
		const cached = cache.get(ref);
		if (cached) {
			cache.delete(ref);
			cache.set(ref, cached);
			return cached.node;
		}
		const [requestedUnit, ordinal, expected] = ref.split(':');
		if (requestedUnit === unit && Number(ordinal) === bundleOrdinal && pending.has(expected)) return pending.get(expected)!.value;
		const nodes = await loadBundle(requestedUnit, ordinal);
		const found = nodes!.get(expected);
		if (!found) throw Error('Referenced immutable node is missing');
		return found;
	};
	const key = (parts: unknown[]): ReferenceKey => {
		const encoded = JSON.stringify(parts);
		return { hash: digest(encoded), encoded };
	};
	const exactKey = async (node: Extract<Node, { key: string }>, id: ReferenceKey) => {
		if (node.key !== id.hash) return false;
		if ((await openBlob(node.keyBlob)) !== id.encoded) throw Error('Reference index hash collision');
		return true;
	};
	const get = async (root: string | null, id: ReferenceKey): Promise<any | null> => {
		let ref = root,
			depth = 0;
		while (ref) {
			if (++depth > 65) throw Error('Invalid reference radix depth');
			const node = await read(ref);
			if ('key' in node) return (await exactKey(node, id)) ? node.value : null;
			if (!id.hash.startsWith(node.prefix)) return null;
			ref = node.children[id.hash[node.prefix.length]] ?? null;
		}
		return null;
	};
	const set = async (root: string | null, id: ReferenceKey, value: any): Promise<string> => {
		if (!root) return putNode({ key: id.hash, keyBlob: await blob(id.encoded), value });
		const node = await read(root),
			path = 'key' in node ? node.key : node.prefix;
		let common = 0;
		while (common < Math.min(path.length, id.hash.length) && path[common] === id.hash[common]) common++;
		if (common < path.length) {
			const leaf = await putNode({ key: id.hash, keyBlob: await blob(id.encoded), value });
			return putNode({ prefix: id.hash.slice(0, common), children: { [path[common]]: root, [id.hash[common]]: leaf } });
		}
		if ('key' in node) {
			if (!(await exactKey(node, id))) throw Error('Reference hash collision');
			return putNode({ key: id.hash, keyBlob: node.keyBlob, value });
		}
		const branch = id.hash[node.prefix.length];
		if (!branch) throw Error('Invalid reference index key');
		const child = await set(node.children[branch] ?? null, id, value);
		return putNode({ prefix: node.prefix, children: { ...node.children, [branch]: child } });
	};
	const blob = async (value: unknown): Promise<ReferenceBlob> => {
		const hash = createHash('sha256');
		let bytes = 0;
		for (const part of canonicalJsonBytes(value, tick)) {
			hash.update(part);
			bytes += part.length;
			tick();
		}
		const sha256 = hash.digest('hex');
		// Inline is an optimization only. Oversize/deep values use the same chunked
		// codec without a source-data limit or a metadata-shaped truncation.
		try {
			const inline = copyBoundedJson(value, { maxBytes: 8192, maxDepth: 24, maxNodes: 20000, sortKeys: true }, 'Inline backup reference');
			return { sha256, bytes, chunks: 0, inline };
		} catch {
			/* retain exact chunked value */
		}
		let buffer = new Uint8Array(65536),
			used = 0,
			chunks = 0;
		const flushBlob = async () => {
			if (!used) return;
			await check();
			await store.put(`${prefix}/blobs/${sha256}/${chunks++}`, buffer.slice(0, used));
			await check();
			used = 0;
		};
		for (const part of canonicalJsonBytes(value, tick)) {
			let offset = 0;
			while (offset < part.length) {
				const length = Math.min(part.length - offset, buffer.length - used);
				buffer.set(part.subarray(offset, offset + length), used);
				used += length;
				offset += length;
				if (used === buffer.length) await flushBlob();
			}
			tick();
		}
		await flushBlob();
		return { sha256, bytes, chunks };
	};
	const openBlob = async (ref: ReferenceBlob): Promise<any> => {
		if (!ref || !backupDigest(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || !Number.isSafeInteger(ref.chunks) || ref.chunks < 0)
			throw Error('Invalid reference blob');
		const hash = createHash('sha256');
		let bytes = 0;
		if (Object.prototype.hasOwnProperty.call(ref, 'inline')) {
			if (ref.chunks !== 0) throw Error('Invalid inline reference blob');
			for (const part of canonicalJsonBytes(ref.inline, tick)) {
				hash.update(part);
				bytes += part.length;
			}
			if (bytes !== ref.bytes || hash.digest('hex') !== ref.sha256) throw Error('Inline reference blob changed');
			return ref.inline;
		}
		if (!ref.chunks) throw Error('Reference blob has no chunks');
		const value = await parseJsonBytes(
			(async function* () {
				for (let page = 0; page < ref.chunks; page++) {
					await check();
					const part = await store.read(`${prefix}/blobs/${ref.sha256}/${page}`, 65536);
					await check();
					if (!part || !part.length) throw Error('Reference blob is missing');
					bytes += part.length;
					hash.update(part);
					yield part;
				}
			})(),
			tick
		);
		if (bytes !== ref.bytes || hash.digest('hex') !== ref.sha256) throw Error('Reference blob changed');
		return value;
	};
	return {
		key,
		get,
		set,
		blob,
		openBlob,
		putState: async (value: unknown) => {
			await flush();
			return putValue(value);
		},
		readState: readValue
	};
}
