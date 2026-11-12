import { attachmentIsBlocked, attachmentModerationStatus } from '../moderation/moderationCore';
import { getThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { getBoundThingsPersistence, nativeThingsReadMemoKey } from '../things/persistenceContext';
import type { ThingsReads, StoredThing } from '../things/persistence';
import type { Viewer, ThingDoc } from '../things/things';
import {
	isServiceKind,
	isServiceRole,
	isServiceStaff,
	SERVICE_WORKSPACE_ACL,
	serviceVisibleIds,
	type ServiceRecord,
	type ServiceRole,
	type ServiceWorkspaceConfig
} from '../../../schemas/serviceWorkspace';

export type WorkspaceAccess = {
	rootId: string;
	ownerId: string;
	config: ServiceWorkspaceConfig;
	role: ServiceRole;
	member: ServiceRecord | null;
	records: ServiceRecord[];
	visibleIds: Set<string>;
};
export const workspaceRecord = (doc: any): ServiceRecord => ({
	id: doc.shareId,
	kind: doc.crystal.recordType,
	values: doc.crystal.values || {},
	updatedAt: new Date(doc.updatedAt).toISOString(),
	folderId: doc.folderId || null
});

// Request-scoped object keys: media/comment batches share one bounded read,
// while every fresh HTTP request rechecks membership and linked customers.
const reads = new WeakMap<object, Map<string, Promise<WorkspaceAccess | null>>>();
const nativeReads = new WeakMap<object, Map<string, Promise<WorkspaceAccess | null>>>();
export async function loadWorkspaceAccess(rootId: string, viewer: Viewer): Promise<WorkspaceAccess | null> {
	if (!viewer?.id || viewer.pat || isCustomMongoEndpointActive() || !/^[A-Za-z0-9_-]{1,160}$/.test(rootId)) return null;
	const native = getBoundThingsPersistence(null);
	if (native) {
		// Opaque epochs are isolated to the actual request/transaction and rotate
		// on semantic mutations, rollback/commit and before post-commit effects.
		const epoch = nativeThingsReadMemoKey()!;
		let cache = nativeReads.get(epoch);
		if (!cache) { cache = new Map(); nativeReads.set(epoch, cache); }
		const key = JSON.stringify([viewer.id, rootId]), cached = cache.get(key);
		const result = cached ?? readNativeAccess(native, rootId, viewer.id);
		if (!cached) cache.set(key, result);
		const access = await result;
		// Check lifetime after awaiting even an already-coalesced result. A
		// concurrent mutation must not turn an old read phase into a fresh grant.
		return nativeThingsReadMemoKey() === epoch ? access : null;
	}
	let cache = reads.get(viewer);
	if (!cache) {
		cache = new Map();
		reads.set(viewer, cache);
	}
	const cached = cache.get(rootId);
	if (cached) return cached;
	const result = readAccess(rootId, viewer.id);
	cache.set(rootId, result);
	return result;
}
async function readAccess(rootId: string, viewerId: string): Promise<WorkspaceAccess | null> {
	const things = await getThingsCollection();
	const root = (await things.findOne({ shareId: rootId, thingtime: 'folder' } as any)) as any;
	const workspace = workspaceRoot(root, rootId, viewerId);
	if (!workspace) return null;
	const membership = viewerId === workspace.ownerId ? null : await things.findOne({
			ownerId: workspace.ownerId,
			thingtime: 'data',
			'crystal.workspaceId': rootId,
			'crystal.recordType': 'member',
			'crystal.values.userId': viewerId,
			'crystal.values.archived': { $ne: true }
		} as any);
	const authority = workspaceAuthority(workspace, viewerId, membership);
	if (!authority) return null;
	const docs = await things
		.find({ ownerId: workspace.ownerId, thingtime: 'data', 'crystal.workspaceId': rootId })
		.toArray();
	return workspaceAccessFromCandidates(rootId, viewerId, root, membership, docs);
}
async function readNativeAccess(reads: ThingsReads, rootId: string, viewerId: string): Promise<WorkspaceAccess | null> {
	const root = await reads.readExact(rootId);
	const workspace = workspaceRoot(root, rootId, viewerId);
	if (!workspace) return null;
	const docs: StoredThing[] = [];
	let cursor: string | null = null;
	do {
		const page = await reads.readWindow({ ownerId: workspace.ownerId, kinds: ['data'], limit: 128, cursor });
		for (const doc of page.documents) if (doc.crystal?.workspaceId === rootId) docs.push(doc);
		cursor = page.nextCursor;
	} while (cursor !== null);
	const memberships = docs.filter(doc => doc.crystal?.recordType === 'member' && doc.crystal?.values?.userId === viewerId && doc.crystal?.values?.archived !== true);
	// Native imported duplicates fail closed rather than letting storage order
	// choose a privileged role. Hosted findOne selection remains unchanged.
	if (viewerId !== workspace.ownerId && memberships.length !== 1) return null;
	return workspaceAccessFromCandidates(rootId, viewerId, root, memberships[0], docs);
}
/** Shared authorization/projection over fetched candidates, never a provider
 * selector or an ACL grant. Both storage adapters use these same decisions. */
export function workspaceAccessFromCandidates(rootId: string, viewerId: string, root: StoredThing | null, membership: StoredThing | null | undefined, docs: StoredThing[]): WorkspaceAccess | null {
	const workspace = workspaceRoot(root, rootId, viewerId);
	if (!workspace) return null;
	const authority = workspaceAuthority(workspace, viewerId, membership);
	return authority ? projectWorkspace(workspace, authority, viewerId, docs) : null;
}
type WorkspaceRoot = Pick<WorkspaceAccess, 'rootId' | 'ownerId' | 'config'>;
function workspaceRoot(root: any, rootId: string, viewerId: string): WorkspaceRoot | null {
	if (root?.shareId !== rootId || !root?.thingtime?.includes('folder') || attachmentIsBlocked(root)) return null;
	const config = root.extended?.serviceWorkspace as ServiceWorkspaceConfig | undefined;
	if (config?.version !== 1 || !config.folders || typeof config.name !== 'string') return null;
	const ownerId = String(root.ownerId);
	if (viewerId !== ownerId && attachmentModerationStatus(root) === 'pending') return null;
	return { rootId, ownerId, config };
}
function workspaceAuthority(workspace: WorkspaceRoot, viewerId: string, membership: any): Pick<WorkspaceAccess, 'role' | 'member'> | null {
	if (viewerId === workspace.ownerId) return { role: 'Admin', member: null };
	if (!workspaceCandidate(membership, workspace) || membership.crystal?.recordType !== 'member' || membership.crystal?.values?.userId !== viewerId || membership.crystal?.values?.archived === true ||
		attachmentIsBlocked(membership) || attachmentModerationStatus(membership) === 'pending' || !isServiceRole(membership.crystal?.values?.role)) return null;
	return { role: membership.crystal.values.role, member: workspaceRecord(membership) };
}
function workspaceCandidate(doc: any, workspace: WorkspaceRoot): boolean {
	return doc?.ownerId === workspace.ownerId && doc.thingtime?.includes('data') && doc.crystal?.workspaceId === workspace.rootId;
}
function projectWorkspace(workspace: WorkspaceRoot, authority: Pick<WorkspaceAccess, 'role' | 'member'>, viewerId: string, docs: StoredThing[]): WorkspaceAccess {
	const records = docs.filter(doc => workspaceCandidate(doc, workspace) && isServiceKind(doc.crystal?.recordType) && !attachmentIsBlocked(doc) &&
		(viewerId === workspace.ownerId || (attachmentModerationStatus(doc) !== 'pending' && (doc.crystal.recordType === 'member' || workspaceRootFor(doc) === workspace.rootId)))).map(workspaceRecord);
	return { ...workspace, ...authority, records, visibleIds: serviceVisibleIds(records, authority.role, authority.member?.values.customerId) };
}
export function workspaceRootFor(doc: any): string | null {
	if (!Array.isArray(doc?.acl) || doc.acl.length !== 3 || !['tt:user', 'tt:custom', SERVICE_WORKSPACE_ACL].every((acl) => doc.acl.includes(acl)))
		return null;
	const root = doc.thingtime?.includes('webpage') ? doc.extended?.serviceWorkspaceId : doc.crystal?.workspaceId;
	return typeof root === 'string' ? root : null;
}
export async function serviceWorkspaceCanRead(doc: ThingDoc, viewer: Viewer): Promise<boolean> {
	const rootId = workspaceRootFor(doc);
	if (!rootId) return false;
	const access = await loadWorkspaceAccess(rootId, viewer);
	if (!access || access.ownerId !== String(doc.ownerId)) return false;
	if (doc.thingtime?.includes('webpage')) return access.config.pageId === doc.shareId;
	return access.visibleIds.has(doc.shareId);
}
export function workspaceCanWrite(access: WorkspaceAccess, kind: string): boolean {
	return kind === 'member' ? access.role === 'Admin' : isServiceStaff(access.role);
}
