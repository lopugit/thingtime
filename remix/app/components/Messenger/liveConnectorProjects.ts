import { isLiveAiSource, type ChatSummary } from './messengerTypes';

export const MAX_LIVE_CONNECTOR_PROJECTS = 128;

export type LiveConnectorProjectReference = {
	projectId: string;
	projectLabel: string;
};

const projectReference = (value: LiveConnectorProjectReference): LiveConnectorProjectReference | null => {
	const projectId = value.projectId.trim();
	const projectLabel = value.projectLabel.trim();
	if (
		!/^[A-Za-z0-9._-]{1,128}$/u.test(projectId) ||
		!projectLabel ||
		new TextEncoder().encode(projectLabel).length > 120 ||
		/[/\\\p{Cc}\p{Cf}]/u.test(projectLabel)
	)
		return null;
	return { projectId, projectLabel };
};

/**
 * Heartbeat-advertised projects are authoritative. Freshly mirrored sessions
 * provide a bounded path-free fallback while the next heartbeat is in flight.
 */
export const projectsForLiveConnector = ({
	advertised,
	chats,
	deviceId,
	connectorId
}: {
	advertised: LiveConnectorProjectReference[];
	chats: ChatSummary[];
	deviceId: string;
	connectorId: string;
}): LiveConnectorProjectReference[] => {
	const result: LiveConnectorProjectReference[] = [];
	const labelsByID = new Map<string, string>();
	const append = (candidate: LiveConnectorProjectReference) => {
		if (result.length >= MAX_LIVE_CONNECTOR_PROJECTS) return;
		const reference = projectReference(candidate);
		if (!reference) return;
		const existing = labelsByID.get(reference.projectId);
		if (existing) return;
		labelsByID.set(reference.projectId, reference.projectLabel);
		result.push(reference);
	};
	advertised.forEach(append);
	for (const chat of chats) {
		const source = isLiveAiSource(chat.externalSource) ? chat.externalSource : null;
		if (
			!source ||
			source.deviceId !== deviceId ||
			source.connectorId !== connectorId ||
			typeof source.projectId !== 'string' ||
			typeof source.projectLabel !== 'string'
		)
			continue;
		append({ projectId: source.projectId, projectLabel: source.projectLabel });
	}
	return result;
};

export const selectedLiveConnectorProject = (
	projects: LiveConnectorProjectReference[],
	requestedProjectId: string | null | undefined
): string =>
	requestedProjectId && projects.some((project) => project.projectId === requestedProjectId)
		? requestedProjectId
		: projects[0]?.projectId || '';
