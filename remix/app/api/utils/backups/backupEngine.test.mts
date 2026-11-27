import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { randomUUID, createSecretKey, randomBytes, createHash } from 'node:crypto';
import { BACKUP_FORMAT, BACKUP_CHUNK_BYTES, backupJson, type BackupHeader, type BackupItem } from '../../../backups/manifest';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';
import { prepareBackup, captureBackup, verifyBackup, type BackupObjectStore } from './portableBackup';
import { initialBackupJobCursor, type BackupJobCursor } from './backupJobCore';
import type { HashCheckpointRef } from './resumableHash';
const {awaitBackupAbort}=await import('./backupTransport.server');
const scope = { apiOrigin: 'https://engine.test', ownerId: 'owner', dataPlane: 'home' };
mock.module('./backupTransport.server', {
	namedExports: {
		awaitBackupAbort,
		createBackupEngineTransport: async () => ({
			scope,
			runtime: {
				scope,
				currentScope: () => scope,
				fetch: async () => {
					throw Error('Offline retained fixture must not read live account');
				},
				requireCapability: async () => {}
			}
		})
	}
});
const { createBackupEngine } = await import('./backupEngine.server');
const hash = (v: unknown) => createHash('sha256').update(backupJson(v)).digest('hex');
async function fixture() {
	const id = randomUUID(),
		objects = new Map<string, Uint8Array>(),
		key = createSecretKey(randomBytes(32));
	let allowed = true,
		loseReply = false;
	const store: BackupObjectStore = {
		read: async (k, max) => {
			const v = objects.get(k);
			if (!v) return null;
			assert.ok(v.length <= max);
			return Uint8Array.from(v);
		},
		put: async (k, v) => {
			const old = objects.get(k);
			if (old) assert.ok(Buffer.from(old).equals(v),'Immutable bytes changed');
			else objects.set(k, Uint8Array.from(v));
		}
	};
	const access = {
		scope,
		authorize: async () => {
			if (!allowed) throw Error('revoked');
		}
	};
	const data = Buffer.alloc(BACKUP_CHUNK_BYTES + 17, 37),
		fingerprint = await fingerprintSource({ size: data.length, check: () => {}, read: async (o, l) => data.subarray(o, o + l) });
	const items: BackupItem[] = [
		{ ordinal: 0, thingId: 'a', revision: '1', snapshot: { adapter: 'fixture', version: 1, value: {} }, content: { size: data.length, fingerprint } },
		{ ordinal: 1, thingId: 'b', revision: '1', snapshot: { adapter: 'fixture', version: 1, value: {} }, content: { size: 0, fingerprint: null } },
		{ ordinal: 2, thingId: 'c', revision: '1', snapshot: { adapter: 'fixture', version: 1, value: {} }, content: null }
	];
	for (let i = 0; i < 130; i++)
		items.push({
			ordinal: items.length,
			thingId: `d${String(i).padStart(3, '0')}`,
			revision: '1',
			snapshot: { adapter: 'fixture', version: 1, value: {} },
			content: null
		});
	const header: BackupHeader = {
		format: BACKUP_FORMAT,
		snapshotId: id,
		scope,
		boundary: { kind: 'point-in-time', token: 'pinned', startedAt: '2026-11-06T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z' },
		coverage: { selectionId: 'supported-content', description: 'Synthetic selected supported content' }
	};
	const plan = await prepareBackup(
		store,
		header,
		{
			async *[Symbol.asyncIterator]() {
				yield* items;
			}
		},
		access
	);
	await captureBackup(store, id, { read: async (_i, o, l) => data.subarray(o, o + l) }, access);
	const expected = await verifyBackup(store, id, access);
	let cursor: BackupJobCursor = {
		...initialBackupJobCursor('snapshot'),
		phase: 'capture',
		planHash: hash(plan),
		planPage: plan.pages - 1,
		headHash: plan.headHash
	};
	const refs = new Map<string, HashCheckpointRef>(),
		ctx: any = {
			jobId: randomUUID(),
			operation: { kind: 'snapshot', snapshotId: id, destinationId: 'fixture' },
			destinationBinding: 'a'.repeat(64),
			request: new Request(scope.apiOrigin + '/api/v1/backups'),
			get cursor() {
				return cursor;
			},
			guard: access.authorize,
			hashKeys: { current: async () => ({ id: 'key', key }), get: async () => key },
			checkpoint: async (next: BackupJobCursor, options: any = {}) => {
				await access.authorize();
				cursor = structuredClone(next);
				for (const slot of options.clearHashSlots ?? []) refs.delete(slot);
				if (loseReply) {
					loseReply = false;
					throw Error('fixture accepted reply lost');
				}
			},
			hashCoordinator: (slot: string, next: BackupJobCursor | ((ref: HashCheckpointRef) => BackupJobCursor)) => ({
				current: async (binding: string) => {
					const ref = refs.get(slot);
					if (ref && ref.bindingHash !== binding) throw Error('slot reused');
					return ref ?? null;
				},
				accept: async (binding: string, previous: HashCheckpointRef | null, value: HashCheckpointRef) => {
					await access.authorize();
					if (backupJson(refs.get(slot) ?? null) !== backupJson(previous)) return 'conflict';
					assert.equal(value.bindingHash, binding);
					refs.set(slot, structuredClone(value));
					cursor = structuredClone(typeof next === 'function' ? next(value) : next);
					if (loseReply) {
						loseReply = false;
						throw Error('fixture accepted reply lost');
					}
					return 'accepted';
				}
			})
		};
	return {
		ctx,
		loseReply() {
			loseReply = true;
		},
		store,
		id,
		expected,
		objects,
		revoke() {
			allowed = false;
		}
	};
}
test('fresh bounded snapshot engine units produce the exact canonical v1 seal from independent retained bytes', async () => {
	const f = await fixture();
	let steps = 0,
		lost = 0,
		injectedHash = false,
		injectedSeal = false,
		result;
	do {
		assert.ok(++steps < 1200, 'bounded continuation must converge');
		if (!injectedHash && f.ctx.cursor.stage === 'part') {
			injectedHash = true;
			f.loseReply();
		}
		if (!injectedSeal && f.ctx.cursor.stage === 'seal') {
			injectedSeal = true;
			f.loseReply();
		}
		try {
			result = await createBackupEngine({ openDestination: async () => ({ store: f.store, binding: f.ctx.destinationBinding }) })(f.ctx);
		} catch (error: any) {
			assert.match(error.message, /fixture accepted reply lost/);
			lost++;
			result = { kind: 'continue' };
		}
	} while (result.kind === 'continue');
	assert.equal(result.kind, 'complete');
	assert.equal(lost, 2);
	assert.equal(f.ctx.cursor.phase, 'complete');
	const seal = JSON.parse(Buffer.from(f.objects.get(`snapshots/${f.id}/complete.json`)!).toString());
	assert.deepEqual(seal, f.expected);
	assert.equal(f.ctx.cursor.sealHash, hash(seal));
	assert.equal((await verifyBackup(f.store, f.id, { scope, authorize: async () => {} })).manifestHash, seal.manifestHash);
});
test('corrupt independent bytes or revoked current authority cannot produce a completion seal', async () => {
	for (const mode of ['corrupt', 'revoke']) {
		const f = await fixture();
		if (mode === 'revoke') f.revoke();
		else {
			const k = [...f.objects.keys()].find((k) => k.startsWith('chunks/'))!;
			f.objects.get(k)![0] ^= 1;
		}
		await assert.rejects(async () => {
			for (let i = 0; i < 1200; i++) {
				const r = await createBackupEngine({ openDestination: async () => ({ store: f.store, binding: f.ctx.destinationBinding }) })(f.ctx);
				if (r.kind !== 'continue') break;
			}
		});
		assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
	}
});

test('outer work-unit abort rejects promptly and prevents late unstarted destination effects',async()=>{
 const f=await fixture(),abort=new AbortController();
 f.ctx.request=new Request(scope.apiOrigin+'/api/v1/backups',{signal:abort.signal});
 let release!:()=>void,effects=0;const gate=new Promise<void>(resolve=>{release=resolve;});
 const pending=createBackupEngine({openDestination:async(_id,access)=>{
  await gate;await access.authorize();effects++;return {store:f.store,binding:f.ctx.destinationBinding};
 }})(f.ctx);
 setTimeout(()=>abort.abort(new DOMException('fixture unit aborted','AbortError')),20);
 await assert.rejects(pending,{name:'AbortError'});release();await new Promise(resolve=>setImmediate(resolve));assert.equal(effects,0);
});
