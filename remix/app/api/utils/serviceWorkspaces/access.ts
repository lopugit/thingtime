import { attachmentIsBlocked, attachmentModerationStatus } from '../moderation/moderationCore';
import { getThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
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

export const MAX_WORKSPACE_RECORDS = 5000;
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
export async function loadWorkspaceAccess(rootId: string, viewer: Viewer): Promise<WorkspaceAccess | null> {
	if (!viewer?.id || viewer.pat || isCustomMongoEndpointActive() || !/^[A-Za-z0-9_-]{1,160}$/.test(rootId)) return null;
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
	const config = root?.extended?.serviceWorkspace as ServiceWorkspaceConfig | undefined;
	if (attachmentIsBlocked(root)) return null;
	if (config?.version !== 1 || !config.folders || typeof config.name !== 'string') return null;
	const ownerId = String(root.ownerId);
	if (viewerId !== ownerId && attachmentModerationStatus(root) === 'pending') return null;
	let member: ServiceRecord | null = null;
	let role: ServiceRole = 'Admin';
	if (viewerId !== ownerId) {
		const membership = (await things.findOne({
			ownerId,
			thingtime: 'data',
			'crystal.workspaceId': rootId,
			'crystal.recordType': 'member',
			'crystal.values.userId': viewerId,
			'crystal.values.archived': { $ne: true }
		} as any)) as any;
		if (
			!membership ||
			attachmentIsBlocked(membership) ||
			attachmentModerationStatus(membership) === 'pending' ||
			!isServiceRole(membership.crystal?.values?.role)
		)
			return null;
		member = workspaceRecord(membership);
		role = member.values.role;
	}
	const docs = await things
		.find({ ownerId, thingtime: 'data', 'crystal.workspaceId': rootId })
		.limit(MAX_WORKSPACE_RECORDS + 1)
		.toArray();
	if (docs.length > MAX_WORKSPACE_RECORDS) throw new Error('Workspace record limit exceeded. Contact support to expand this workspace.');
	const records = docs
		.filter(
			(doc: any) =>
				isServiceKind(doc.crystal?.recordType) &&
				!attachmentIsBlocked(doc) &&
				(viewerId === ownerId ||
					(attachmentModerationStatus(doc) !== 'pending' && (doc.crystal.recordType === 'member' || workspaceRootFor(doc) === rootId)))
		)
		.map(workspaceRecord);
	const visibleIds = serviceVisibleIds(records, role, member?.values.customerId);
	return { rootId, ownerId, config, role, member, records, visibleIds };
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
