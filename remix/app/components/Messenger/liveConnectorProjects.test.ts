import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_LIVE_CONNECTOR_PROJECTS, projectsForLiveConnector, selectedLiveConnectorProject } from './liveConnectorProjects';
import type { ChatSummary } from './messengerTypes';

const chat = (deviceId: string, connectorId: string, projectId: string, projectLabel: string): ChatSummary =>
	({
		id: `${deviceId}-${connectorId}-${projectId}`,
		externalSource: {
			access: 'live',
			provider: 'chatgpt',
			sourceId: connectorId,
			label: 'Codex',
			connector: connectorId,
			readOnly: false,
			deviceId,
			connectorId,
			sessionId: `session-${projectId}`,
			projectId,
			projectLabel,
			capabilities: []
		}
	} as ChatSummary);

test('merges heartbeat and mirrored-session projects without paths or cross-device leakage', () => {
	const projects = projectsForLiveConnector({
		advertised: [{ projectId: 'advertised', projectLabel: 'Advertised' }],
		chats: [
			chat('device-1', 'codex-app-server', 'advertised', 'Ignored duplicate'),
			chat('device-1', 'codex-app-server', 'mirrored', 'Mirrored'),
			chat('device-2', 'codex-app-server', 'other-device', 'Other'),
			chat('device-1', 'other-connector', 'other-connector', 'Other'),
			chat('device-1', 'codex-app-server', 'private', '/Users/person/private')
		],
		deviceId: 'device-1',
		connectorId: 'codex-app-server'
	});
	assert.deepEqual(projects, [
		{ projectId: 'advertised', projectLabel: 'Advertised' },
		{ projectId: 'mirrored', projectLabel: 'Mirrored' }
	]);
	assert.equal(selectedLiveConnectorProject(projects, 'missing'), 'advertised');
	assert.equal(selectedLiveConnectorProject(projects, 'mirrored'), 'mirrored');
});

test('caps project fallback references', () => {
	const projects = projectsForLiveConnector({
		advertised: [],
		chats: Array.from({ length: MAX_LIVE_CONNECTOR_PROJECTS + 10 }, (_, index) =>
			chat('device-1', 'codex-app-server', `project-${index}`, `Project ${index}`)
		),
		deviceId: 'device-1',
		connectorId: 'codex-app-server'
	});
	assert.equal(projects.length, MAX_LIVE_CONNECTOR_PROJECTS);
});
