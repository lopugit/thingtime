import { getThing, updateThing } from '../things/things';
import type { PublicUser } from '../auth/users';
import { listUserVault, revealUserVaultValue } from '../lopu/userVault';
import { workspaceAccess, WorkspaceError } from './workspaces';
import { isServiceStaff } from '../../../schemas/serviceWorkspace';
import type { WorkspaceAccess } from './access';

// Only these explicitly browser/server-designated entries can power a workspace.
// Ambiguous duplicate names fail closed instead of silently selecting a credential.
export async function workspaceMapKeys(access: WorkspaceAccess, includePlaces = false) {
	const { entries, groups } = await listUserVault(access.ownerId);
	const select = async (key: string) => {
		const matches = entries.filter(
			(entry) =>
				entry.kind === 'secret' &&
				entry.key === key &&
				(access.config.mapsEnvironmentId === undefined || entry.groupId === access.config.mapsEnvironmentId)
		);
		return matches.length === 1 ? revealUserVaultValue(access.ownerId, matches[0].id) : null;
	};
	return {
		groups: groups.map((group) => ({ id: group.id, name: group.name })),
		browserKey: await select('GOOGLE_MAPS_JAVASCRIPT_API_KEY'),
		placesKey: includePlaces ? await select('GOOGLE_PLACES_API_KEY') : null
	};
}
async function googlePlaces(key: string, path: string, fields: string, body?: unknown) {
	try {
		const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
			method: body ? 'POST' : 'GET',
			redirect: 'error',
			signal: AbortSignal.timeout(8000),
			headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields },
			...(body ? { body: JSON.stringify(body) } : {})
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error('Provider rejected request');
		}
		const reader = response.body?.getReader();
		if (!reader) throw new Error('Empty provider response');
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.length;
			if (size > 128 * 1024) {
				await reader.cancel();
				throw new Error('Response too large');
			}
			chunks.push(next.value);
		}
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new WorkspaceError(
			502,
			'Google Places could not complete this request. Check Places API (New), billing, quota and API key restrictions in your Google project.'
		);
	}
}
export async function searchWorkspaceAddresses(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	if (!isServiceStaff(access.role)) throw new WorkspaceError(403, 'Only staff can search for new properties');
	const query = typeof input.query === 'string' ? input.query.trim() : '';
	if (query.length < 3 || query.length > 200) throw new WorkspaceError(400, 'Enter between 3 and 200 characters');
	const { placesKey } = await workspaceMapKeys(access, true);
	if (!placesKey) throw new WorkspaceError(409, 'Add one GOOGLE_PLACES_API_KEY secret to your selected Vault environment');
	const response = await googlePlaces(placesKey, 'places:autocomplete', 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text', {
		input: query,
		...(typeof input.sessionToken === 'string' && /^[a-zA-Z0-9_-]{1,36}$/.test(input.sessionToken) ? { sessionToken: input.sessionToken } : {})
	});
	return {
		ok: true,
		suggestions: (response.suggestions || [])
			.slice(0, 5)
			.map((s: any) => ({ id: s.placePrediction?.placeId, text: s.placePrediction?.text?.text }))
			.filter((s: any) => typeof s.id === 'string' && typeof s.text === 'string')
	};
}
export async function workspacePlace(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	const record = access.records.find((r) => r.id === input.recordId && r.kind === 'address' && access.visibleIds.has(r.id));
	const placeId = record ? record.values.placeId : isServiceStaff(access.role) ? input.placeId : null;
	if (typeof placeId !== 'string' || !/^[a-zA-Z0-9_-]{1,300}$/.test(placeId)) throw new WorkspaceError(400, 'Select a Google address first');
	const { placesKey } = await workspaceMapKeys(access, true);
	if (!placesKey) throw new WorkspaceError(409, 'A unique GOOGLE_PLACES_API_KEY secret is required in your selected Vault environment');
	const sessionToken =
		typeof input.sessionToken === 'string' && /^[a-zA-Z0-9_-]{1,36}$/.test(input.sessionToken)
			? `?sessionToken=${encodeURIComponent(input.sessionToken)}`
			: '';
	const place = await googlePlaces(placesKey, `places/${encodeURIComponent(placeId)}${sessionToken}`, 'id,formattedAddress,location');
	return { ok: true, placeId: place.id, address: place.formattedAddress, location: place.location };
}

export async function configureWorkspaceMaps(user: PublicUser, input: any) {
	const access = await workspaceAccess(user, input.rootId);
	if (user.id !== access.ownerId) throw new WorkspaceError(403, 'Only the workspace owner can select Vault credentials');
	const { groups } = await listUserVault(access.ownerId);
	const groupId = input.environmentId;
	if (groupId !== null && groupId !== '__auto__' && !groups.some((group) => group.id === groupId))
		throw new WorkspaceError(400, 'Choose an owned Vault environment');
	const root = await getThing(user.id, access.rootId);
	if (!root.ok) throw new WorkspaceError(404, 'Workspace not found');
	const config = { ...access.config };
	if (groupId === '__auto__') delete config.mapsEnvironmentId;
	else config.mapsEnvironmentId = groupId;
	const updated = await updateThing(
		user.id,
		access.rootId,
		{ extended: { ...(root.thing.extended as Record<string, unknown> || {}), serviceWorkspace: config } },
		{ expectedUpdatedAt: root.thing.updatedAt }
	);
	if (!updated.ok) throw new WorkspaceError(409, 'Workspace changed. Refresh before configuring Maps.');
	return { ok: true };
}
