import { workspaceMapKeys } from './maps';
import { createHash } from 'node:crypto';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { createThing, getThing, updateThing, viewerOf } from '../things/things';
import type { PublicUser } from '../auth/users';
import { findUserByUsername } from '../auth/users';
import { loadWorkspaceAccess, MAX_WORKSPACE_RECORDS, workspaceCanWrite, type WorkspaceAccess } from './access';
import {
	SERVICE_FIELDS,
	SERVICE_KINDS,
	SERVICE_LABELS,
	SERVICE_WORKSPACE_ACL,
	isServiceKind,
	isServiceStaff,
	validateServiceValues,
	type ServiceKind,
	type ServiceWorkspaceConfig,
	type ServiceRecord
} from '../../../schemas/serviceWorkspace';

export class WorkspaceError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}
const check = (result: any) => {
	if (result?.ok === false) throw new WorkspaceError(result.status || 400, result.error);
	return result;
};
const stableId = (root: string, part: string) => 'service-' + createHash('sha256').update(`${root}:${part}`).digest('hex').slice(0, 40);
const id = (value: unknown) => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new WorkspaceError(400, 'A valid id is required');
	return value;
};
const recordAcl = ['tt:user', 'tt:custom', SERVICE_WORKSPACE_ACL];

async function createOnce(ownerId: string, input: Parameters<typeof createThing>[1]) {
	const expectedKinds = Array.isArray(input.thingtime) ? input.thingtime : [];
	const expectedCrystal = input.crystal as Record<string, unknown> | undefined;
	const verify = (thing: any) => {
		if (
			thing.author.id !== ownerId ||
			!expectedKinds.every((kind) => thing.thingtime.includes(kind)) ||
			(input.folderId && thing.folderId !== input.folderId) ||
			(expectedCrystal?.workspaceId && thing.crystal?.workspaceId !== expectedCrystal.workspaceId)
		)
			throw new WorkspaceError(409, 'A workspace record id is already in use');
		return thing;
	};
	const existing = await getThing({ id: ownerId }, String(input.shareId));
	if (existing.ok) return verify(existing.thing);
	const result = await createThing(ownerId, input);
	if (result.ok === false) {
		const retry = await getThing({ id: ownerId }, String(input.shareId));
		if (retry.ok) return verify(retry.thing);
		check(result);
	}
	return check(await getThing({ id: ownerId }, String(input.shareId))).thing;
}
export async function initializeWorkspace(user: PublicUser, input: any) {
	if (isCustomMongoEndpointActive()) throw new WorkspaceError(403, 'Service workspaces use your home Thingtime account');
	const rootId = id(input.rootId);
	const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
	if (!name) throw new WorkspaceError(400, 'Workspace name is required');
	const timeZone = typeof input.timeZone === 'string' ? input.timeZone : 'Australia/Melbourne';
	try {
		new Intl.DateTimeFormat('en', { timeZone }).format();
	} catch {
		throw new WorkspaceError(400, 'Choose a valid time zone');
	}
	const root = await createOnce(user.id, {
		shareId: rootId,
		thingtime: ['folder'],
		crystal: { name, icon: '🌿', description: 'Service franchise workspace: customers, properties, jobs, visits and equipment.' },
		acl: ['tt:user']
	});
	if (!root.thingtime.includes('folder') || root.author.id !== user.id) throw new WorkspaceError(409, 'Choose a new workspace id');
	if (root.extended?.serviceWorkspace?.version === 1) return { ok: true, rootId };
	const folders = {} as Record<ServiceKind, string>;
	const operationsId = stableId(rootId, 'operations');
	await createOnce(user.id, {
		shareId: operationsId,
		thingtime: ['folder'],
		folderId: rootId,
		crystal: { name: 'Operations', icon: '📋' },
		acl: ['tt:user']
	});
	for (const kind of SERVICE_KINDS) {
		folders[kind] = stableId(rootId, `folder:${kind}`);
		await createOnce(user.id, {
			shareId: folders[kind],
			thingtime: ['folder'],
			folderId: ['visit', 'link', 'subjob', 'time', 'usage'].includes(kind) ? operationsId : rootId,
			crystal: { name: SERVICE_LABELS[kind], icon: kind === 'equipment' ? '🧰' : '📁' },
			acl: ['tt:user']
		});
	}
	const config: ServiceWorkspaceConfig = { version: 1, name, timeZone, folders };
	await createOnce(user.id, {
		shareId: stableId(rootId, `member:${user.id}`),
		thingtime: ['data'],
		folderId: folders.member,
		crystal: {
			workspaceId: rootId,
			recordType: 'member',
			values: { username: user.username, userId: user.id, role: 'Admin', workspaceOwner: true, createdBy: user.id }
		},
		acl: ['tt:user']
	});
	check(
		await updateThing(user.id, rootId, { extended: { ...(root.extended || {}), serviceWorkspace: config } }, { expectedUpdatedAt: root.updatedAt })
	);
	return { ok: true, rootId };
}
export async function workspaceAccess(user: PublicUser, rootId: unknown): Promise<WorkspaceAccess> {
	const access = await loadWorkspaceAccess(id(rootId), viewerOf(user));
	if (!access) throw new WorkspaceError(404, 'Workspace not found or access has been revoked');
	return access;
}
export async function readWorkspace(user: PublicUser, rootId: unknown, cursor = 0) {
	const access = await workspaceAccess(user, rootId);
	const records = access.records.filter((r) => access.visibleIds.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
	const maps = await workspaceMapKeys(access).catch(() => ({ browserKey: null, groups: [] }));
	const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
	// Staff selectors need names and ids, never the membership policy fields.
	const team = isServiceStaff(access.role)
		? access.records
				.filter((r) => r.kind === 'member' && !r.values.archived && isServiceStaff(r.values.role))
				.map((r) => ({ id: r.id, name: r.values.username, role: r.values.role }))
		: [];
	return {
		ok: true,
		rootId: access.rootId,
		name: access.config.name,
		timeZone: access.config.timeZone,
		role: access.role,
		owner: user.id === access.ownerId,
		records: records.slice(start, start + 250),
		team,
		nextCursor: start + 250 < records.length ? start + 250 : null,
		mapsEnvironmentId: access.config.mapsEnvironmentId ?? (access.config.mapsEnvironmentId === null ? null : '__auto__'),
		mapsEnvironments: user.id === access.ownerId ? maps.groups : [],
		mapsConfigured: !!maps.browserKey,
		mapsBrowserKey: maps.browserKey
	};
}
function relatedRecord(access: WorkspaceAccess, value: string, kind: ServiceKind): ServiceRecord {
	const record = access.records.find((r) => r.id === value && r.kind === kind && !r.values.archived);
	if (!record) throw new WorkspaceError(400, `Choose a ${kind} from this workspace`);
	return record;
}
function validateReferences(access: WorkspaceAccess, kind: ServiceKind, values: Record<string, any>) {
	for (const field of SERVICE_FIELDS[kind]) if (field.ref && values[field.key]) relatedRecord(access, values[field.key], field.ref);
	if (kind === 'time' && values.subjobId) {
		const visit = relatedRecord(access, values.visitId, 'visit');
		if (relatedRecord(access, values.subjobId, 'subjob').values.jobId !== visit.values.jobId)
			throw new WorkspaceError(400, 'Sub-job must belong to this visit’s job');
	}
	if (kind === 'usage') {
		for (const [field, category] of [
			['batteryId', 'Battery'],
			['vehicleId', 'Vehicle']
		]) {
			if (values[field] && relatedRecord(access, values[field], 'equipment').values.category !== category)
				throw new WorkspaceError(400, `Choose a ${category.toLowerCase()} for ${field}`);
		}
	}
	if (values.employeeId && !isServiceStaff(relatedRecord(access, values.employeeId, 'member').values.role))
		throw new WorkspaceError(400, 'Choose an active staff member');
}
export async function saveWorkspaceRecord(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	if (!isServiceKind(input.kind)) throw new WorkspaceError(400, 'Unknown record type');
	const kind = input.kind;
	if (!workspaceCanWrite(access, kind)) throw new WorkspaceError(403, 'Your role cannot change these records');
	let values: Record<string, any>;
	try {
		values = validateServiceValues(kind, input.values, access.config.timeZone);
	} catch (error) {
		throw new WorkspaceError(400, (error as Error).message);
	}
	validateReferences(access, kind, values);
	let recordId = id(input.id);
	if (kind === 'member') {
		const account = await findUserByUsername(values.username);
		if (!account) throw new WorkspaceError(400, 'That Thingtime username was not found. Ask them to sign up first.');
		const userId = String(account._id);
		if (userId === access.ownerId) throw new WorkspaceError(400, 'The workspace owner is always an Admin');
		values.userId = userId;
		values.username = String(account.username);
		recordId = stableId(access.rootId, `member:${userId}`);
	}
	const existing = access.records.find((r) => r.id === recordId);
	if (
		existing &&
		!input.expectedUpdatedAt &&
		existing.values.createdBy === user.id &&
		existing.kind === kind &&
		Object.entries(values).every(([key, value]) => existing.values[key] === value)
	)
		return { ok: true, id: existing.id };
	if (existing && existing.kind !== kind) throw new WorkspaceError(409, 'Record type cannot change');
	if (existing && (typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt !== existing.updatedAt))
		throw new WorkspaceError(409, 'This record changed. Refresh before saving your edits.');
	if (!existing && access.records.length >= MAX_WORKSPACE_RECORDS) throw new WorkspaceError(409, 'Workspace record limit reached');
	if (kind === 'link') {
		const duplicate = access.records.find(
			(r) =>
				r.kind === 'link' &&
				!r.values.archived &&
				r.values.customerId === values.customerId &&
				r.values.addressId === values.addressId &&
				r.id !== recordId
		);
		if (duplicate) return { ok: true, id: duplicate.id, existing: true };
	}
	if (kind === 'visit') values.order = existing?.values.order ?? Date.now();
	values.archived = existing?.values.archived === true;
	values.createdBy = existing?.values.createdBy || user.id;
	values.updatedBy = user.id;
	// Per-record folders give visits their own durable place beneath Jobs.
	let folderId = existing?.folderId || access.config.folders[kind];
	const parentKey = kind === 'visit' || kind === 'subjob' ? values.jobId : kind === 'time' || kind === 'usage' ? values.visitId : null;
	if (parentKey) {
		folderId = stableId(access.rootId, `record-folder:${parentKey}`);
		const parent = access.records.find((r) => r.id === parentKey)!;
		await createOnce(access.ownerId, {
			shareId: folderId,
			thingtime: ['folder'],
			folderId: parent.folderId || access.config.folders.job,
			crystal: { name: String(parent.values.title || 'Job').slice(0, 100) + ' · records', icon: '📋' },
			acl: ['tt:user']
		});
	}
	const crystal = { workspaceId: access.rootId, recordType: kind, values, ...(parentKey ? { parentId: parentKey } : {}) };
	if (existing) check(await updateThing(access.ownerId, recordId, { crystal }, { replaceCrystal: true, expectedUpdatedAt: input.expectedUpdatedAt }));
	else
		check(
			await createThing(access.ownerId, {
				shareId: recordId,
				thingtime: ['data'],
				crystal,
				folderId,
				acl: kind === 'member' ? ['tt:user'] : recordAcl
			})
		);
	return { ok: true, id: recordId };
}
export async function archiveWorkspaceRecord(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	const record = access.records.find((r) => r.id === input.id);
	if (!record) throw new WorkspaceError(404, 'Record not found');
	if (!workspaceCanWrite(access, record.kind)) throw new WorkspaceError(403, 'Your role cannot archive this record');
	if (record.kind === 'member' && record.values.userId === access.ownerId) throw new WorkspaceError(400, 'The workspace owner is always an Admin');
	if (input.expectedUpdatedAt !== record.updatedAt) throw new WorkspaceError(409, 'Record changed. Refresh first.');
	check(
		await updateThing(
			access.ownerId,
			record.id,
			{ crystal: { values: { ...record.values, archived: input.archived !== false, updatedBy: user.id } } },
			{ expectedUpdatedAt: input.expectedUpdatedAt }
		)
	);
	return { ok: true };
}
export async function moveWorkspaceVisit(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	if (!isServiceStaff(access.role)) throw new WorkspaceError(403, 'Only staff can schedule visits');
	const visit = relatedRecord(access, id(input.id), 'visit');
	let values;
	try {
		values = { ...visit.values, ...validateServiceValues('visit', { ...visit.values, date: input.date, time: input.time ?? visit.values.time }) };
	} catch (error) {
		throw new WorkspaceError(400, (error as Error).message);
	}
	if (!Number.isFinite(input.order) || Math.abs(input.order) > Number.MAX_SAFE_INTEGER) throw new WorkspaceError(400, 'Invalid planner order');
	values.order = input.order;
	values.updatedBy = user.id;
	if (input.expectedUpdatedAt !== visit.updatedAt) throw new WorkspaceError(409, 'Visit changed. Refresh before moving it.');
	check(await updateThing(access.ownerId, visit.id, { crystal: { values } }, { expectedUpdatedAt: input.expectedUpdatedAt }));
	return { ok: true };
}
export async function bindWorkspacePage(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	if (user.id !== access.ownerId) throw new WorkspaceError(403, 'Only the owner can connect the builder page');
	const page = check(await getThing(viewerOf(user), id(input.pageId))).thing;
	if (page.author.id !== user.id || !page.thingtime.includes('webpage')) throw new WorkspaceError(400, 'Choose an owned builder page');
	const root = check(await getThing(viewerOf(user), access.rootId)).thing;
	check(
		await updateThing(
			user.id,
			access.rootId,
			{ extended: { ...(root.extended || {}), serviceWorkspace: { ...access.config, pageId: page.id } } },
			{ expectedUpdatedAt: root.updatedAt }
		)
	);
	check(
		await updateThing(
			user.id,
			page.id,
			{ extended: { ...(page.extended || {}), serviceWorkspaceId: access.rootId }, acl: recordAcl },
			{ expectedUpdatedAt: page.updatedAt }
		)
	);
	return { ok: true };
}
