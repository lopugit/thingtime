import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import type { ServiceRecord, ServiceRole } from '~/schemas/serviceWorkspace';
import { readWorkspaceResponse } from './workspaceResponse';
export type WorkspaceSnapshot = {
	rootId: string;
	name: string;
	timeZone: string;
	role: ServiceRole;
	owner: boolean;
	records: ServiceRecord[];
	team: { id: string; name: string; role: string }[];
	mapsBrowserKey: string | null;
	mapsEnvironmentId: string | null;
	mapsEnvironments: { id: string; name: string }[];
	mapsConfigured: boolean;
	nextCursor: number | null;
};
export async function workspaceRequest(rootId: string, body?: Record<string, unknown>, cursor?: number): Promise<any> {
	await requireThingtimeCapability('api.builder-workspaces', '1.0.1');
	const response = await fetch(
		body
			? '/api/v1/builder/workspaces'
			: `/api/v1/builder/workspaces?rootId=${encodeURIComponent(rootId)}${cursor === undefined ? '' : `&cursor=${cursor}`}`,
		{
			signal: AbortSignal.timeout(20000),
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { 'Content-Type': 'application/json' },
			...(body ? { method: 'POST', body: JSON.stringify({ ...body, rootId }) } : {})
		}
	);
	return readWorkspaceResponse(response);
}
export async function readAllWorkspace(rootId: string): Promise<WorkspaceSnapshot> {
	const result: WorkspaceSnapshot = await workspaceRequest(rootId);
	let previous = 0;
	while (result.nextCursor !== null) {
		if (!Number.isSafeInteger(result.nextCursor) || result.nextCursor <= previous || result.nextCursor >= 5000)
			throw new Error('Workspace pagination changed. Refresh to try again.');
		previous = result.nextCursor;
		const page = await workspaceRequest(rootId, undefined, result.nextCursor);
		result.records = [...new Map([...result.records, ...page.records].map((record) => [record.id, record])).values()];
		result.nextCursor = page.nextCursor;
	}
	return result;
}
export const attachmentUrl = (id: string) => `/api/v1/attachments/content?id=${encodeURIComponent(id)}`;
