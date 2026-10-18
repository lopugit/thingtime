import { applyEventsToWeights, emptyWeights, scorePost, topInterests, type PostFeatures } from '../api/utils/things/feedRanking';
import {
	MAX_SAVED_ALGORITHMS,
	normalizeAlgorithmName,
	sanitizeAlgorithmEmoji,
	sanitizeAlgorithmEvents
} from '../api/utils/algorithms/algorithmContent';
import { parseAlgorithmTransfer } from '../api/utils/algorithms/algorithmTransferCore';
import { isDefaultAlgorithm } from '../components/Feed/defaultAlgorithms';
import { algorithmTransferContent, isTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import type { LocalThing } from './things';
import { type WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceTransaction, type WorkspaceScope } from './storage';

export type LocalAlgorithmOptions = {
	scope?: WorkspaceScope;
	observationScope?: Extract<WorkspaceScope, { kind: 'account' }>;
	now?: () => number;
	uuid?: () => string;
	onWrite?(tx: WorkspaceTransaction, row: LocalThing | null, previous: LocalThing | null): Promise<void>;
	onActive?(tx: WorkspaceTransaction, id: string | null): Promise<void>;
};
const validWeightKey = (value: unknown): value is string =>
	typeof value === 'string' &&
	!!value &&
	value.length <= 512 &&
	!['__proto__', 'prototype', 'constructor'].includes(value) &&
	![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
type SavedFeatures = Omit<PostFeatures, 'createdAt'> & { createdAt: string; observedAt: number };
const publicFeatures = (post: any): SavedFeatures | null => {
	if (
		!validWeightKey(post?.id) ||
		post.id.length > 200 ||
		!validWeightKey(post.type) ||
		!validWeightKey(post.author?.id) ||
		typeof post.createdAt !== 'string' ||
		!Number.isFinite(Date.parse(post.createdAt))
	)
		return null;
	return {
		type: post.type,
		ownerId: post.author.id,
		tags: Array.isArray(post.tags) ? post.tags.filter(validWeightKey).slice(0, 100) : [],
		createdAt: new Date(post.createdAt).toISOString(),
		observedAt: Date.now()
	};
};

const project = (row: LocalThing) => ({
	id: row.id,
	name: row.crystal.name,
	emoji: row.crystal.emoji,
	parentId: row.crystal.parentId || null,
	description: row.crystal.description || '',
	shared: false,
	listed: false,
	localOnly: true,
	eventCount: row.crystal.eventCount,
	lastTrainedAt: row.crystal.lastTrainedAt,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	topInterests: topInterests(algorithmTransferContent(row.crystal).weights)
});

/** Local profiles use canonical training/ranking maths. Anonymous observations
 * come from credential-free public feeds; account observations are bounded and
 * isolated by their authorized source plane, even though profiles live at home. */
export class LocalAlgorithms {
	private scope: WorkspaceScope;
	private featureCollection: string;
	constructor(private db: WorkspaceDatabase, private lease: WorkspaceLease, private options: LocalAlgorithmOptions = {}) {
		this.scope = options.scope ?? { kind: 'anonymous' };
		const source = options.observationScope;
		if (
			source &&
			(this.scope.kind !== 'account' ||
				source.ownerId !== this.scope.ownerId ||
				source.origin !== this.scope.origin ||
				!source.dataPlane ||
				source.dataPlane.length > 200)
		)
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Feed observations must belong to this account and origin.', 409);
		// Account profiles live at home, but identical post IDs in different
		// databases must never share observations. Old unscoped account entries
		// deliberately confer no training input after this upgrade.
		this.featureCollection =
			this.scope.kind === 'anonymous' ? 'algorithm-post-features' : `algorithm-features-v1:${source?.dataPlane ?? this.scope.dataPlane}`;
	}
	private now() {
		return this.options.now?.() ?? Date.now();
	}
	private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) {
		return this.db.transaction(this.scope, mode, this.lease, run);
	}
	private async read(tx: WorkspaceTransaction, id: string) {
		const row = await tx.get<LocalThing>('things', id);
		if (!row || !isTransferAlgorithm(row)) throw new WorkspaceError('NOT_FOUND', 'Algorithm is not in this workspace', 404);
		return row;
	}
	private async save(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing | null) {
		algorithmTransferContent(row.crystal);
		row.updatedAt = new Date(Math.max(this.now(), Date.parse(row.updatedAt) + 1)).toISOString();
		row.revision++;
		await tx.put('things', row.id, row);
		await this.options.onWrite?.(tx, row, previous);
		return project(row);
	}
	async list() {
		return this.transaction('readonly', (tx) => this.listIn(tx));
	}
	async listIn(tx: WorkspaceTransaction) {
		this.lease.assertCurrent();
		return {
			ok: true,
			algorithms: (await tx.list<LocalThing>('things'))
				.map((row) => row.value)
				.filter(isTransferAlgorithm)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
				.map(project),
			activeAlgorithmId: (await tx.get<string>('settings', 'active-algorithm')) || null
		};
	}
	async create(input: { name?: unknown; emoji?: unknown; branchFrom?: string; description?: unknown; events?: unknown }) {
		const name = normalizeAlgorithmName(input.name);
		if (!name) throw new WorkspaceError('INVALID_ALGORITHM', 'Algorithm name is required');
		return this.transaction('readwrite', async (tx) => {
			if ((await tx.list<LocalThing>('things')).filter((row) => isTransferAlgorithm(row.value)).length >= MAX_SAVED_ALGORITHMS)
				throw new WorkspaceError('LOCAL_QUOTA', 'This workspace has reached its algorithm limit', 413);
			const parent = input.branchFrom ? await this.read(tx, input.branchFrom) : null;
			const base = {
				name,
				emoji: sanitizeAlgorithmEmoji(input.emoji),
				weights: parent ? algorithmTransferContent(parent.crystal).weights : emptyWeights(),
				eventCount: 0,
				lastTrainedAt: null
			};
			const events = sanitizeAlgorithmEvents(input.events),
				trained = applyEventsToWeights(
					base.weights,
					events,
					await this.features(
						tx,
						events.map((event) => event.thingId)
					)
				);
			const now = new Date(this.now()).toISOString();
			const content = parseAlgorithmTransfer({
				...base,
				weights: trained.weights,
				eventCount: trained.applied,
				lastTrainedAt: trained.applied ? now : null
			});
			const row: LocalThing = {
				id: `${this.scope.kind === 'anonymous' ? 'local-' : ''}${this.options.uuid?.() ?? crypto.randomUUID()}`,
				thingtime: ['feed-algorithm'],
				crystal: snapshotTransferValue({
					...content,
					parentId: parent?.id || null,
					description: typeof input.description === 'string' ? input.description.trim().slice(0, 300) : ''
				}) as LocalThing['crystal'],
				createdAt: now,
				updatedAt: now,
				revision: 0
			};
			return { ok: true, algorithm: await this.save(tx, row, null) };
		});
	}
	async update(input: {
		id: string;
		name?: unknown;
		emoji?: unknown;
		description?: unknown;
		shared?: unknown;
		listed?: unknown;
		expectedUpdatedAt?: string;
	}) {
		if (input.shared || input.listed)
			throw new WorkspaceError('REMOTE_ACCOUNT_REQUIRED', 'Local algorithms stay on this device. Sign in to share a separate account copy.', 401);
		return this.transaction('readwrite', async (tx) => {
			const row = await this.read(tx, input.id),
				previous = structuredClone(row);
			if (input.expectedUpdatedAt && row.updatedAt !== input.expectedUpdatedAt)
				throw new WorkspaceError('WRITE_CONFLICT', 'This algorithm changed in another editor. Reload before saving.', 409);
			if (input.name !== undefined) {
				const name = normalizeAlgorithmName(input.name);
				if (!name) throw new WorkspaceError('INVALID_ALGORITHM', 'Algorithm name is required');
				row.crystal.name = name;
			}
			if (input.emoji !== undefined) row.crystal.emoji = sanitizeAlgorithmEmoji(input.emoji);
			if (input.description !== undefined) {
				if (typeof input.description !== 'string') throw new WorkspaceError('INVALID_ALGORITHM', 'Description must be text');
				row.crystal.description = input.description.trim().slice(0, 300);
			}
			return { ok: true, algorithm: await this.save(tx, row, previous) };
		});
	}
	async setActive(id: string | null) {
		return this.transaction('readwrite', async (tx) => {
			if (id && !isDefaultAlgorithm(id)) await this.read(tx, id);
			if (id) await tx.put('settings', 'active-algorithm', id);
			else await tx.delete('settings', 'active-algorithm');
			await this.options.onActive?.(tx, id);
			return { ok: true, activeAlgorithmId: id };
		});
	}
	async remove(id: string) {
		return this.transaction('readwrite', (tx) => this.removeIn(tx, id));
	}
	async removeIn(tx: WorkspaceTransaction, id: string) {
		this.lease.assertCurrent();
		const previous = await this.read(tx, id);
		if ((await tx.list<LocalThing>('things')).some((row) => row.value.folderId === id || row.value.targetId === id))
			throw new WorkspaceError('HAS_CHILDREN', 'Remove related local Things before deleting this algorithm');
		await tx.delete('things', id);
		if ((await tx.get('settings', 'active-algorithm')) === id) {
			await tx.delete('settings', 'active-algorithm');
			await this.options.onActive?.(tx, null);
		}
		await this.options.onWrite?.(tx, null, previous);
		return { ok: true };
	}
	private async features(tx: WorkspaceTransaction, ids: string[]) {
		const result = new Map<string, PostFeatures>();
		for (const id of new Set(ids)) {
			const saved = await tx.get<SavedFeatures>(this.featureCollection, id);
			if (saved) result.set(id, { ...saved, createdAt: new Date(saved.createdAt) });
		}
		return result;
	}
	async observePublicPosts(posts: any[]) {
		return this.observePosts(posts);
	}
	/** Input comes from the current adapter's authorized feed response. This
	 * records bounded features only; it performs no reads or remote mutations. */
	async observePosts(posts: any[]) {
		return this.transaction('readwrite', async (tx) => {
			for (const post of posts.slice(0, 200)) {
				const features = publicFeatures(post);
				if (features) await tx.put(this.featureCollection, post.id, features);
			}
			const all = await tx.list<SavedFeatures>(this.featureCollection);
			all.sort((a, b) => b.value.observedAt - a.value.observedAt || a.id.localeCompare(b.id));
			for (const row of all.slice(1000)) await tx.delete(this.featureCollection, row.id);
		});
	}
	async track(input: { algorithmId: string; events?: unknown }) {
		return this.transaction('readwrite', async (tx) => {
			const row = await this.read(tx, input.algorithmId),
				previous = structuredClone(row),
				content = algorithmTransferContent(row.crystal),
				events = sanitizeAlgorithmEvents(input.events);
			const trained = applyEventsToWeights(
				content.weights,
				events,
				await this.features(
					tx,
					events.map((event) => event.thingId)
				)
			);
			if (trained.applied) {
				row.crystal = {
					...row.crystal,
					...(snapshotTransferValue(
						parseAlgorithmTransfer({
							...content,
							weights: trained.weights,
							eventCount: content.eventCount + trained.applied,
							lastTrainedAt: new Date(this.now()).toISOString()
						})
					) as LocalThing['crystal'])
				};
				await this.save(tx, row, previous);
			}
			return { ok: true, trained: trained.applied > 0, applied: trained.applied, eventCount: row.crystal.eventCount };
		});
	}
	async rankPage<T extends { id: string }>(id: string, posts: T[]) {
		return this.transaction('readonly', async (tx) => {
			const weights = algorithmTransferContent((await this.read(tx, id)).crystal).weights,
				features = new Map<string, PostFeatures>(),
				now = new Date();
			for (const post of posts) {
				const row = publicFeatures(post);
				if (row) features.set(post.id, { ...row, createdAt: new Date(row.createdAt) });
			}
			const score = (post: T) => (features.has(post.id) ? scorePost(weights, features.get(post.id)!, now) : 0);
			return [...posts].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
		});
	}
}
