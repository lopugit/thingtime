import { randomUUID } from 'node:crypto';

import { getHomeThingsCollection } from '../mongodb/collections';
import { FEATURE_STACK_USER_HELD_STATUSES } from './featureStackLifecycleCore';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

const STACK_KIND = 'ci-feature-stack';
const ENTRY_KIND = 'ci-feature-stack-entry';
const REPOSITORY = () => (process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime').trim() || 'lopugit/thingtime';
const GIT_REF = /^(?![./])(?!.*(?:\.\.|\/\.|\.\/|@\{|\\|[[~^:?*]))[A-Za-z0-9._/-]{1,180}(?<![./])$/;

export type SavedFeatureStack = {
	id: string;
	name: string;
	sourcePrNumbers: number[];
	targets: string[];
	autoDecideBranches: boolean;
	status: string;
	lastDispatchId: string | null;
	lastRunAt: string | null;
	runs: SavedFeatureStackRun[];
	createdAt: string;
	updatedAt: string;
};

export type SavedFeatureStackRun = {
	id: string;
	runId: string | null;
	status: string;
	title: string;
	url: string | null;
	workflowRunId: number | null;
	startedAt: string;
	completedAt: string | null;
	linkCheckedAt: string | null;
};

const dateString = (value: unknown) => {
	const date = value instanceof Date ? value : new Date(String(value ?? ''));
	return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
};

const validateName = (value: unknown) => {
	const name = typeof value === 'string' ? value.trim() : '';
	const hasControlCharacter = [...name].some((character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127;
	});
	if (!name || name.length > 80 || hasControlCharacter) {
		throw new Error('Feature Stack name must be 1-80 printable characters.');
	}
	return name;
};

const validateSources = (value: unknown) => {
	if (!Array.isArray(value) || value.length < 1) throw new Error('Choose at least one pull request.');
	const values = value.map((item) => (typeof item === 'number' ? item : Number(String(item ?? ''))));
	if (values.some((item) => !Number.isSafeInteger(item) || item < 1 || item > 999_999_999)) {
		throw new Error('Feature Stack contains an invalid pull request number.');
	}
	if (new Set(values).size !== values.length) throw new Error('Feature Stack pull requests must be unique.');
	return values;
};

const validateTargets = (value: unknown) => {
	if (!Array.isArray(value) || value.length < 1) throw new Error('Choose at least one target branch.');
	const values = value.map((item) => String(item ?? '').trim());
	if (values.some((item) => !GIT_REF.test(item)) || new Set(values).size !== values.length) {
		throw new Error('Feature Stack targets must be unique valid branches.');
	}
	return values;
};

export const listFeatureStacks = async (): Promise<SavedFeatureStack[]> => {
	const things = await getHomeThingsCollection();
	const repository = REPOSITORY();
	const roots = await things
		.find({ thingtime: STACK_KIND, 'crystal.repository': repository, 'crystal.archived': { $ne: true } })
		.sort({ updatedAt: -1 })
		.toArray();
	const rootIds = roots.map((root: any) => String(root.shareId));
	const [entries, dispatches] = await Promise.all([
		things.find({ thingtime: ENTRY_KIND, 'crystal.repository': repository }).sort({ 'crystal.position': 1 }).toArray(),
		rootIds.length
			? things
					.find({
						thingtime: 'ci-dispatch',
						'crystal.repository': repository,
						$or: [{ parentId: { $in: rootIds } }, { 'crystal.externalId': /^feature-stack:/ }]
					})
					.sort({ 'crystal.sourceUpdatedAt': -1, updatedAt: -1 })
					.toArray()
			: []
	]);
	const entriesByParent = new Map<string, any[]>();
	for (const entry of entries) {
		if (typeof entry.parentId !== 'string') continue;
		const rows = entriesByParent.get(entry.parentId) ?? [];
		rows.push(entry);
		entriesByParent.set(entry.parentId, rows);
	}
	const runsByStack = new Map<string, SavedFeatureStackRun[]>();
	for (const dispatch of dispatches) {
		const externalId = String(dispatch.crystal?.externalId ?? '');
		const legacyStackId = externalId.match(/^feature-stack:(ci-feature-stack-[0-9a-f-]{36}):/)?.[1] ?? null;
		const stackId = typeof dispatch.parentId === 'string' && rootIds.includes(dispatch.parentId) ? dispatch.parentId : legacyStackId;
		if (!stackId || !rootIds.includes(stackId)) continue;
		const workflowRunId = Number(dispatch.crystal?.workflowRunId);
		const rows = runsByStack.get(stackId) ?? [];
		if (rows.length >= 20) continue;
		rows.push({
			id: String(dispatch.shareId),
			runId: typeof dispatch.crystal?.featureStackRunId === 'string' ? dispatch.crystal.featureStackRunId : null,
			status: String(dispatch.crystal?.runStatus ?? dispatch.crystal?.status ?? 'requested'),
			title: String(dispatch.crystal?.workflowRunTitle ?? dispatch.crystal?.title ?? 'Feature Stack run'),
			url: typeof dispatch.crystal?.workflowRunUrl === 'string' ? dispatch.crystal.workflowRunUrl : null,
			workflowRunId: Number.isSafeInteger(workflowRunId) ? workflowRunId : null,
			startedAt: dateString(dispatch.crystal?.startedAt ?? dispatch.crystal?.sourceUpdatedAt ?? dispatch.createdAt),
			completedAt: dispatch.crystal?.completedAt ? dateString(dispatch.crystal.completedAt) : null,
			linkCheckedAt: dispatch.crystal?.linkCheckedAt ? dateString(dispatch.crystal.linkCheckedAt) : null
		});
		runsByStack.set(stackId, rows);
	}
	return roots.map((root: any) => {
		const rows = (entriesByParent.get(String(root.shareId)) ?? []).filter((row) => row.crystal?.revision === root.crystal?.revision);
		return {
			id: String(root.shareId),
			name: String(root.crystal?.title ?? 'Feature Stack'),
			sourcePrNumbers: rows.filter((row) => row.crystal?.entryType === 'source').map((row) => Number(row.crystal?.prNumber)),
			targets: rows.filter((row) => row.crystal?.entryType === 'target').map((row) => String(row.crystal?.branch ?? '')),
			autoDecideBranches: root.crystal?.autoDecideBranches !== false,
			status: String(root.crystal?.status ?? 'saved'),
			lastDispatchId: typeof root.crystal?.lastDispatchId === 'string' ? root.crystal.lastDispatchId : null,
			lastRunAt: root.crystal?.lastRunAt ? dateString(root.crystal.lastRunAt) : null,
			runs: runsByStack.get(String(root.shareId)) ?? [],
			createdAt: dateString(root.createdAt),
			updatedAt: dateString(root.updatedAt)
		};
	});
};

export const saveFeatureStack = async (
	input: {
		id?: unknown;
		name?: unknown;
		sourcePrNumbers?: unknown;
		targets?: unknown;
		autoDecideBranches?: unknown;
	},
	actorId: string
): Promise<SavedFeatureStack> => {
	const things = await getHomeThingsCollection();
	const id = typeof input.id === 'string' && /^ci-feature-stack-[0-9a-f-]{36}$/.test(input.id) ? input.id : `ci-feature-stack-${randomUUID()}`;
	const current = await things.findOne({ shareId: id, thingtime: STACK_KIND });
	if (input.id && !current) throw new Error('Saved Feature Stack not found.');
	const name = validateName(input.name);
	const sourcePrNumbers = validateSources(input.sourcePrNumbers);
	const targets = validateTargets(input.targets);
	const autoDecideBranches = input.autoDecideBranches !== false;
	const now = new Date();
	const repository = REPOSITORY();
	const revision = randomUUID();
	const entries = [
		...sourcePrNumbers.map((prNumber, position) => ({ entryType: 'source', position, prNumber })),
		...targets.map((branch, position) => ({ entryType: 'target', position, branch }))
	];

	if (entries.length) {
		await things.insertMany(
			entries.map((entry, index) => ({
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				shareId: `${id}-entry-${index}-${randomUUID()}`,
				thingtime: [ENTRY_KIND],
				crystal: { repository, revision, ...entry },
				ownerId: 'system',
				acl: [],
				storageClass: 'control',
				parentId: id,
				targetId: null,
				tags: [],
				createdAt: now,
				updatedAt: now
			}))
		);
	}
	await things.updateOne(
		{ shareId: id, thingtime: STACK_KIND },
		{
			$set: {
				'crystal.title': name,
				'crystal.repository': repository,
				'crystal.autoDecideBranches': autoDecideBranches,
				'crystal.revision': revision,
				'crystal.status': current?.crystal?.status && current.crystal.status !== 'archived' ? String(current.crystal.status) : 'saved',
				'crystal.archived': false,
				'crystal.updatedBy': actorId,
				updatedAt: now
			},
			$setOnInsert: {
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				shareId: id,
				thingtime: [STACK_KIND],
				ownerId: 'system',
				acl: [],
				storageClass: 'control',
				parentId: null,
				targetId: null,
				tags: [],
				createdAt: now,
				'crystal.createdBy': actorId,
				'crystal.lastDispatchId': null,
				'crystal.lastRunAt': null
			}
		},
		{ upsert: true }
	);
	await things.deleteMany({ thingtime: ENTRY_KIND, parentId: id, 'crystal.revision': { $ne: revision } });
	return (await listFeatureStacks()).find((stack) => stack.id === id)!;
};

export const getFeatureStack = async (id: unknown) => {
	if (typeof id !== 'string') throw new Error('Choose a saved Feature Stack.');
	const stack = (await listFeatureStacks()).find((candidate) => candidate.id === id);
	if (!stack) throw new Error('Saved Feature Stack not found.');
	return stack;
};

export const markFeatureStackRun = async (id: string, dispatchId: string, runId: string, requestedAt: Date) => {
	const result = await (
		await getHomeThingsCollection()
	).updateOne(
		{ shareId: id, thingtime: STACK_KIND },
		{
			$set: {
				'crystal.status': 'running',
				'crystal.lastDispatchId': dispatchId,
				'crystal.lastFeatureStackRunId': runId,
				'crystal.lastRunAt': requestedAt,
				updatedAt: new Date()
			}
		}
	);
	if (!result.matchedCount) throw new Error('Saved Feature Stack not found.');
};

export const markFeatureStackLifecycleStatus = async (
	id: string,
	status: 'paused' | 'stopped',
	actorId: string,
	actionAt = new Date()
) => {
	const result = await (
		await getHomeThingsCollection()
	).updateOne(
		{ shareId: id, thingtime: STACK_KIND },
		{
			$set: {
				'crystal.status': status,
				'crystal.lastLifecycleAction': status,
				'crystal.lastLifecycleActorId': actorId,
				'crystal.lastLifecycleAt': actionAt,
				updatedAt: actionAt
			}
		}
	);
	if (!result.matchedCount) throw new Error('Saved Feature Stack not found.');
};

type WorkflowRunLink = {
	workflowRunId: number;
	url: string | null;
	title: string;
	status: string;
	startedAt: string | Date;
	completedAt?: string | Date | null;
};

const linkDispatchWorkflowRun = async (dispatch: any, input: WorkflowRunLink) => {
	if (!Number.isSafeInteger(input.workflowRunId)) return false;
	const things = await getHomeThingsCollection();
	const now = new Date();
	await things.updateOne(
		{ shareId: dispatch.shareId, thingtime: 'ci-dispatch' },
		{
			$set: {
				'crystal.workflowRunId': input.workflowRunId,
				'crystal.workflowRunUrl': input.url,
				'crystal.workflowRunTitle': input.title,
				'crystal.runStatus': input.status,
				'crystal.startedAt': new Date(input.startedAt),
				'crystal.completedAt': input.completedAt ? new Date(input.completedAt) : null,
				'crystal.linkCheckedAt': now,
				updatedAt: now
			}
		}
	);
	const externalId = String(dispatch.crystal?.externalId ?? '');
	const stackId =
		typeof dispatch.parentId === 'string'
			? dispatch.parentId
			: externalId.match(/^feature-stack:(ci-feature-stack-[0-9a-f-]{36}):/)?.[1] ?? null;
	if (stackId) {
		const normalized = input.status.toLowerCase();
		const stackStatus = ['failure', 'failed', 'cancelled'].includes(normalized)
			? normalized
			: ['success', 'completed', 'succeeded'].includes(normalized)
				? 'controller-completed'
				: 'running';
		await things.updateOne(
			{
				shareId: stackId,
				thingtime: STACK_KIND,
				'crystal.lastDispatchId': dispatch.shareId,
				'crystal.status': { $nin: [...FEATURE_STACK_USER_HELD_STATUSES] }
			},
			{ $set: { 'crystal.status': stackStatus, updatedAt: now } }
		);
	}
	return true;
};

export const linkFeatureStackWorkflowRun = async (input: {
	runId: string;
	stackId?: string;
	repository?: string;
	workflowRunId: number;
	url: string | null;
	title: string;
	status: string;
	startedAt: string | Date;
	completedAt?: string | Date | null;
}) => {
	if (!/^feature-stack-run-[0-9a-f-]{36}$/.test(input.runId)) return false;
	const dispatch = await (await getHomeThingsCollection()).findOne({
		thingtime: 'ci-dispatch',
		'crystal.featureStackRunId': input.runId,
		...(input.stackId ? { parentId: input.stackId } : {}),
		...(input.repository ? { 'crystal.repository': input.repository } : {})
	});
	return dispatch ? linkDispatchWorkflowRun(dispatch, input) : false;
};

export const reconcileLegacyFeatureStackRun = async (
	dispatchId: string,
	input: WorkflowRunLink
) => {
	const things = await getHomeThingsCollection();
	const dispatch = await things.findOne({ shareId: dispatchId, thingtime: 'ci-dispatch' });
	return dispatch ? linkDispatchWorkflowRun(dispatch, input) : false;
};

export const markFeatureStackRunLinkChecked = async (dispatchId: string) => {
	await (await getHomeThingsCollection()).updateOne(
		{ shareId: dispatchId, thingtime: 'ci-dispatch' },
		{ $set: { 'crystal.linkCheckedAt': new Date(), updatedAt: new Date() } }
	);
};

export const archiveFeatureStack = async (id: unknown) => {
	if (typeof id !== 'string') throw new Error('Choose a saved Feature Stack.');
	const result = await (
		await getHomeThingsCollection()
	).updateOne({ shareId: id, thingtime: STACK_KIND }, { $set: { 'crystal.archived': true, 'crystal.status': 'archived', updatedAt: new Date() } });
	if (!result.matchedCount) throw new Error('Saved Feature Stack not found.');
};
