import { createCipheriv, createDecipheriv, createHash, randomBytes, type KeyObject } from 'node:crypto';
import { createSHA256 } from 'hash-wasm';
import { backupId, backupDigest, backupJson, BACKUP_CHUNK_BYTES } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';
import type { BackupAccess, BackupObjectStore } from './portableBackup';

// Save/load is a documented upstream API. Pin the implementation: opaque state
// may include plaintext tails and is not portable between arbitrary versions.
export const RESUMABLE_HASH_IMPLEMENTATION = 'hash-wasm:4.12.0:sha256';
const FORMAT = 'thingtime-encrypted-hash-checkpoint-v1';
const MAX_STATE_BYTES = 8192;
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fail = (): never => { throw Error('The protected hash checkpoint is unavailable, stale or incompatible'); };
const same = (a: unknown, b: unknown) => backupJson(a) === backupJson(b);
const decimal = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(v);

/** The coordinator owns this binding. An immutable provider version or pinned
 * object/stream descriptor is required; mutable URLs/paths are not identities. */
export type HashStreamBinding = {
	/** Unique to this hash stream, not the enclosing backup job. Reuse for a
 * different stream refuses through the immutable encrypted root object. */
	operationId: string; snapshotId: string; streamId: string;
	/** SHA-256 of the pinned immutable provider descriptor or source seal. */
	objectVersion: string; bytes: string; expectedSha256: string | null;
};
export type HashCheckpointRef = {
	algorithm: 'sha256'; implementation: typeof RESUMABLE_HASH_IMPLEMENTATION;
	bindingHash: string; operationId: string; stepId: string;
	sequence: number; offset: string; previousDigest: string | null;
	stateDigest: string; complete: boolean; finalDigest: string | null;
};
type CheckpointMetadata = Omit<HashCheckpointRef, 'stateDigest'>;
/** Only protected, currently authorized coordinator state may implement this
 * interface. No HTTP input, ordinary Thing field or archived receipt is a CAS.
 * accept must durably compare the entire previous reference and reject a stale
 * writer. Its acceptance transaction must fence the current full-account session
 * and job lease; an earlier authorization read is not sufficient. 'already-
 * accepted' is allowed only for the exact same next reference. */
export type HashCheckpointCoordinator = {
	current(bindingHash: string): Promise<HashCheckpointRef | null>;
	accept(bindingHash: string, previous: HashCheckpointRef | null, next: HashCheckpointRef): Promise<'accepted' | 'already-accepted' | 'conflict'>;
};
export type ImmutableHashSource = {
	assertIdentity(binding: HashStreamBinding): Promise<void>;
	read(offset: bigint, length: number): Promise<Uint8Array>;
};
type Keys = {
	current(): Promise<{ id: string; key: KeyObject }>;
	get(id: string): Promise<KeyObject | null>;
};
const keyIsValid = (key: KeyObject | null): key is KeyObject => key?.type === 'secret' && key.symmetricKeySize === 32;
const objectKey = (ref: Pick<HashCheckpointRef, 'operationId' | 'stepId'>) => `hash-checkpoints/${ref.operationId}/${ref.stepId}.json`;

/** One bounded hashing unit, with AES-GCM state in the same private object-store
 * boundary as backup content. Only opaque references leave this adapter. This
 * primitive neither seals a backup nor grants restore/write authority. */
export function createResumableHashWorker(input: {
	store: BackupObjectStore; keys: Keys; access: BackupAccess; coordinator: HashCheckpointCoordinator;
}) {
	const { store, keys, access, coordinator } = input, scope = timelineScopeKey(access.scope);
	const check = async () => {
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scope) return fail();
		await access.authorize();
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scope) return fail();
	};
	const bind = (binding: HashStreamBinding) => {
		if (!binding || Object.keys(binding).sort().join(',') !== 'bytes,expectedSha256,objectVersion,operationId,snapshotId,streamId' ||
			!backupId(binding.operationId) || !backupId(binding.snapshotId) || !decimal(binding.bytes) ||
			BigInt(binding.bytes) > BigInt('2305843009213693951') ||
			!backupDigest(binding.objectVersion) || typeof binding.streamId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(binding.streamId) ||
			!(binding.expectedSha256 === null || backupDigest(binding.expectedSha256))) return fail();
		return sha(backupJson({ scope, binding }));
	};
	const metadata = (ref: HashCheckpointRef): CheckpointMetadata => {
		const { stateDigest: _, ...value } = ref;
		if (Object.keys(ref).sort().join(',') !== 'algorithm,bindingHash,complete,finalDigest,implementation,offset,operationId,previousDigest,sequence,stateDigest,stepId' ||
			ref.algorithm !== 'sha256' || ref.implementation !== RESUMABLE_HASH_IMPLEMENTATION ||
			![ref.bindingHash, ref.stateDigest].every(backupDigest) || ![ref.operationId, ref.stepId].every(backupId) ||
			!Number.isSafeInteger(ref.sequence) || ref.sequence < 0 || !decimal(ref.offset) ||
			!(ref.previousDigest === null || backupDigest(ref.previousDigest)) || typeof ref.complete !== 'boolean' ||
			!(ref.complete ? backupDigest(ref.finalDigest) : ref.finalDigest === null)) return fail();
		return value;
	};
	const read = async (ref: HashCheckpointRef, bindingHash: string) => {
		await check();
		const meta = metadata(ref);
		if (meta.bindingHash !== bindingHash) return fail();
		const bytes = await store.read(objectKey(ref), MAX_STATE_BYTES);
		await check();
		if (!bytes || bytes.length > MAX_STATE_BYTES || sha(bytes) !== ref.stateDigest) return fail();
		try {
			const envelope = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
			if (backupJson(envelope) !== new TextDecoder().decode(bytes) ||
				Object.keys(envelope).sort().join(',') !== 'cipherText,format,iv,keyId,tag' || envelope.format !== FORMAT ||
				typeof envelope.keyId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(envelope.keyId)) return fail();
			const key = await keys.get(envelope.keyId);
			await check();
			if (!keyIsValid(key)) return fail();
			const decode = (value: unknown) => {
				if (typeof value !== 'string') return fail();
				const bytes = Buffer.from(value, 'base64url');
				if (bytes.toString('base64url') !== value) return fail();
				return bytes;
			};
			const iv = decode(envelope.iv), tag = decode(envelope.tag);
			if (iv.length !== 12 || tag.length !== 16) return fail();
			const decipher = createDecipheriv('aes-256-gcm', key, iv);
			decipher.setAAD(Buffer.from(backupJson(meta))); decipher.setAuthTag(tag);
			const plain = Buffer.concat([decipher.update(decode(envelope.cipherText)), decipher.final()]);
			const body = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(plain));
			if (Object.keys(body).join(',') !== 'state') return fail();
			return decode(body.state);
		} catch { access.signal?.throwIfAborted(); return fail(); }
	};
	const publish = async (meta: CheckpointMetadata, state: Uint8Array, previous: HashCheckpointRef | null, source: ImmutableHashSource, binding: HashStreamBinding) => {
		await check();
		const key = objectKey(meta), existing = await store.read(key, MAX_STATE_BYTES);
		let bytes: Uint8Array;
		if (existing) {
			bytes = existing;
			const candidate = { ...meta, stateDigest: sha(bytes) };
			if (!Buffer.from(await read(candidate, meta.bindingHash)).equals(state)) return fail();
		} else {
			const currentKey = await keys.current();
			await check();
			if (!keyIsValid(currentKey.key) || !/^[A-Za-z0-9_-]{1,80}$/.test(currentKey.id)) return fail();
			const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', currentKey.key, iv);
			cipher.setAAD(Buffer.from(backupJson(meta)));
			const cipherText = Buffer.concat([cipher.update(Buffer.from(backupJson({ state: Buffer.from(state).toString('base64url') }))), cipher.final()]);
			bytes = Buffer.from(backupJson({ format: FORMAT, keyId: currentKey.id, iv: iv.toString('base64url'),
				tag: cipher.getAuthTag().toString('base64url'), cipherText: cipherText.toString('base64url') }));
			if (bytes.length > MAX_STATE_BYTES) return fail();
			await store.put(key, bytes);
		}
		const next = { ...meta, stateDigest: sha(bytes) };
		if (!Buffer.from(await read(next, meta.bindingHash)).equals(state)) return fail();
		await source.assertIdentity(binding); await check();
		if (await coordinator.accept(meta.bindingHash, previous, next) === 'conflict') return fail();
		await check();
		return next;
	};
	return {
		async start(binding: HashStreamBinding, source: ImmutableHashSource) {
			binding = Object.freeze({ ...binding });
			await check();
			const bindingHash = bind(binding);
			await source.assertIdentity(binding); await check();
			const existing = await coordinator.current(bindingHash);
			if (existing) { await read(existing, bindingHash); await source.assertIdentity(binding); await check(); return existing; }
			const hasher = await createSHA256();
			return publish({ algorithm: 'sha256', implementation: RESUMABLE_HASH_IMPLEMENTATION, bindingHash,
				operationId: binding.operationId, stepId: binding.operationId, sequence: 0, offset: '0', previousDigest: null,
				complete: false, finalDigest: null }, hasher.save(), null, source, binding);
		},
		async advance(binding: HashStreamBinding, previous: HashCheckpointRef, stepId: string, source: ImmutableHashSource, maxBytes = BACKUP_CHUNK_BYTES) {
			binding = Object.freeze({ ...binding }); previous = Object.freeze({ ...previous });
			await check();
			const bindingHash = bind(binding);
			if (!backupId(stepId) || stepId === binding.operationId || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > BACKUP_CHUNK_BYTES) return fail();
			await source.assertIdentity(binding); await check();
			const state = await read(previous, bindingHash), offset = BigInt(previous.offset), size = BigInt(binding.bytes);
			if (offset > size || previous.operationId !== binding.operationId || !Number.isSafeInteger(previous.sequence + 1)) return fail();
			const length = Number(size - offset > BigInt(maxBytes) ? BigInt(maxBytes) : size - offset), nextOffset = offset + BigInt(length);
			const current = await coordinator.current(bindingHash);
			if (!same(current, previous)) {
				// Exact uncertain acceptance replays return the accepted checkpoint,
				// never execute a fresh range or accept an older sibling generation.
				if (!current || current.previousDigest !== previous.stateDigest || current.stepId !== stepId || current.sequence !== previous.sequence + 1 ||
					current.offset !== nextOffset.toString() || current.complete !== (nextOffset === size)) return fail();
				await read(current, bindingHash); await source.assertIdentity(binding); await check(); return current;
			}
			if (previous.complete) return fail();
			const hasher = await createSHA256();
			try { hasher.load(state); } catch { return fail(); }
			if (length) {
				const bytes = await source.read(offset, length);
				await check(); await source.assertIdentity(binding); await check();
				if (!(bytes instanceof Uint8Array) || bytes.length !== length) return fail();
				hasher.update(bytes);
			}
			const savedState = hasher.save(), complete = nextOffset === size;
			const finalDigest = complete ? hasher.digest('hex') : null;
			if (complete && binding.expectedSha256 !== null && finalDigest !== binding.expectedSha256) throw Error('The current immutable source bytes do not match the expected SHA-256');
			return publish({ algorithm: 'sha256', implementation: RESUMABLE_HASH_IMPLEMENTATION, bindingHash, operationId: binding.operationId,
				stepId, sequence: previous.sequence + 1, offset: nextOffset.toString(), previousDigest: previous.stateDigest, complete, finalDigest },
				savedState, previous, source, binding);
		}
	};
}
