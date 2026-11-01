#!/usr/bin/env node
import { createInterface } from 'node:readline';

import { CodexAppServerConnector } from './live/codexAppServer.js';
import { CodexLocalHistory } from './live/codexLocalHistory.js';
import { publicConnectorError } from './live/jsonlRpc.js';
import { LocalProjectRegistry, refreshEmptyProjectRegistry } from './live/projectRegistry.js';
import type { LiveConnector } from './live/types.js';
import type { ApprovalDecision, SendMessageRequest } from './live/types.js';
import { decodeRuntimeRequest, runtimeEvent, runtimeReply, type RuntimeRequest, type RuntimeWire } from './live/nodeWire.js';

const projects = LocalProjectRegistry.fromEnvironment(process.env);
const connectors = new Map<string, LiveConnector>([['codex-app-server', new CodexAppServerConnector(undefined, new CodexLocalHistory(), projects)]]);

const stringValue = (value: unknown, name: string, max = 4_096): string => {
	if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is invalid.`);
	return value.trim();
};

const optionalString = (value: unknown, name: string, max = 4_096): string | null => {
	if (value === undefined || value === null || value === '') return null;
	return stringValue(value, name, max);
};

const approvalDecision = (value: unknown): ApprovalDecision => {
	if (value === 'accept' || value === 'acceptForSession' || value === 'decline' || value === 'cancel') return value;
	throw new Error('Approval decision is invalid.');
};

const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
let activeWire: RuntimeWire = 'json-rpc';
const connector = (id: unknown): LiveConnector => {
	const value = connectors.get(String(id || ''));
	if (!value) throw new Error('Unknown connector.');
	return value;
};

const eventPumps = new Map<string, Promise<void>>();
const startConnector = async (value: LiveConnector) => {
	await value.start();
	if (!eventPumps.has(value.id)) {
		eventPumps.set(
			value.id,
			(async () => {
				for await (const event of value.events()) write(runtimeEvent(activeWire, event));
			})()
		);
	}
};

const handle = async (request: RuntimeRequest): Promise<unknown> => {
	const params = request.params ?? {};
	switch (request.method) {
		case 'connector/list': {
			// On a fresh installation there is no environment-seeded registry.
			// Ask each capable local connector for one bounded discovery pass
			// before returning its path-free public metadata. Failure stays local
			// and connector/list can still report already-known references.
			try {
				projects.reloadFromFile();
			} catch {
				// Registry paths and local validation errors remain node-local.
			}
			await refreshEmptyProjectRegistry(projects, connectors.values(), startConnector);
			return {
				connectors: [...connectors.values()].map((value) => ({
					id: value.id,
					label: value.label,
					capabilities: value.capabilities,
					projects: value.id === 'codex-app-server' ? projects.list() : []
				}))
			};
		}
		case 'connector/start': {
			const value = connector(params.connectorId);
			await startConnector(value);
			return { ok: true };
		}
		case 'connector/stop':
			await connector(params.connectorId).stop();
			return { ok: true };
		case 'session/list':
			return connector(params.connectorId).listSessions({
				cursor: optionalString(params.cursor, 'Cursor', 2_048),
				limit: typeof params.limit === 'number' ? params.limit : undefined,
				search: optionalString(params.search, 'Search', 512)
			});
		case 'session/read':
			return connector(params.connectorId).readSession({
				sessionId: stringValue(params.sessionId, 'Session id', 512),
				cursor: optionalString(params.cursor, 'Cursor', 2_048),
				limit: typeof params.limit === 'number' ? params.limit : undefined
			});
		case 'session/create': {
			const projectPath = projects.resolve(optionalString(params.projectId, 'Project id', 128));
			return connector(params.connectorId).createSession({
				commandId: stringValue(params.commandId, 'Command id', 512),
				projectPath,
				prompt: optionalString(params.prompt, 'Prompt', 256_000)
			});
		}
		case 'session/send': {
			const mode = params.mode === 'queue' || params.mode === 'steer' ? params.mode : null;
			if (!mode) throw new Error('Send mode must be queue or steer.');
			const send: SendMessageRequest = {
				commandId: stringValue(params.commandId, 'Command id', 512),
				sessionId: stringValue(params.sessionId, 'Session id', 512),
				text: stringValue(params.text, 'Message', 256_000),
				mode,
				expectedTurnId: optionalString(params.expectedTurnId, 'Expected turn id', 512)
			};
			return connector(params.connectorId).sendMessage(send);
		}
		case 'session/interrupt':
			await connector(params.connectorId).interrupt({
				commandId: stringValue(params.commandId, 'Command id', 512),
				sessionId: stringValue(params.sessionId, 'Session id', 512),
				turnId: stringValue(params.turnId, 'Turn id', 512)
			});
			return { ok: true };
		case 'approval/respond':
			await connector(params.connectorId).respondToApproval({
				commandId: stringValue(params.commandId, 'Command id', 512),
				requestId: typeof params.requestId === 'number' ? params.requestId : stringValue(params.requestId, 'Request id', 512),
				decision: approvalDecision(params.decision)
			});
			return { ok: true };
		default:
			throw new Error('Unknown runtime method.');
	}
};

const dispatchLine = async (line: string): Promise<void> => {
	if (!line.trim()) return;
	let request: RuntimeRequest | null = null;
	let wire: RuntimeWire = activeWire;
	try {
		const decoded = decodeRuntimeRequest(line);
		request = decoded.request;
		wire = decoded.wire;
		activeWire = wire;
		const result = await handle(request);
		write(runtimeReply(wire, request.id, result));
	} catch (error) {
		const connectorError = publicConnectorError(error);
		write(
			runtimeReply(wire, request?.id ?? null, null, {
				code: connectorError?.code ?? 'runtime_error',
				message: connectorError?.message ?? 'The connector runtime request failed.'
			})
		);
	}
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const inFlight = new Set<Promise<void>>();
for await (const line of lines) {
	const task = dispatchLine(line);
	inFlight.add(task);
	void task.finally(() => inFlight.delete(task));
}

await Promise.allSettled([...inFlight]);
await Promise.allSettled([...connectors.values()].map((value) => value.stop()));
