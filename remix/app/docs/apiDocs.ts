import type { DeploymentDataEnvironment } from '~/api/utils/deployment/dataEnvironment';
import { CHATGPT_AUTHORIZE_PATH, CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH, CHATGPT_MCP_PATH, CHATGPT_TOKEN_PATH } from '../api/utils/chatgpt/pluginCore';

export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiAuthMode = 'none' | 'optional' | 'session' | 'bearer' | 'session-or-bearer';

export type ApiRequestExample = {
  name: string;
  description: string;
  method: ApiHttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null>;
  headers?: Record<string, string>;
  body?: unknown;
};

export type ApiResponseExample = {
  status: number;
  description: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type ApiEndpointDoc = {
  id: string;
  /** Stable per-operation compatibility contract. Major changes are breaking. */
  contractVersion: `${number}.${number}.${number}`;
  group: string;
  title: string;
  endpoint: string;
  docsEndpoint: string;
  summary: string;
  detail: string;
  auth: {
    mode: ApiAuthMode;
    description: string;
  };
  methods: ApiHttpMethod[];
  steps: string[];
  requestExamples: ApiRequestExample[];
  responseExamples: ApiResponseExample[];
  notes?: string[];
  featureVersion?: string;
};

export type ApiPlatformExamples = {
  curl: string;
  wget: string;
  node: string;
  python: string;
  ruby: string;
};

export type SerializedApiEndpointDoc = ApiEndpointDoc & {
  platformExamples: ApiPlatformExamples;
};

const endpoint = (doc: Omit<ApiEndpointDoc, 'docsEndpoint' | 'contractVersion'> & Partial<Pick<ApiEndpointDoc, 'contractVersion'>>): ApiEndpointDoc => ({
  ...doc,
  contractVersion: doc.contractVersion || '1.0.0',
  docsEndpoint: `${doc.endpoint}-docs`
});

const deviceEndpointDocs: ApiEndpointDoc[] = [
	endpoint({
		id: 'devices',
		contractVersion: '1.8.0',
		group: 'devices',
		title: 'Paired devices',
		endpoint: '/api/v1/devices',
		summary: 'Lists safe paired-computer summaries or one detailed mirror.',
		detail:
			'Returns protected dedicated projections for the caller’s devices, state and connectors. Generic /things never exposes these kinds. Credentials, hashes, paths, arguments and screen transport data are omitted.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session.' },
		methods: ['GET'],
		steps: ['GET to list devices.', 'Pass id to retrieve one device detail.'],
		requestExamples: [{ name: 'One device', description: 'Load one safe device projection.', method: 'GET', query: { id: 'device-id' } }],
		responseExamples: [
			{
				status: 200,
				description: 'Device mirror.',
				body: { ok: true, devices: [{ id: 'device-id', name: 'MacBook Pro', online: true, locked: false, connectors: [] }] }
			}
		]
	}),
	endpoint({
		id: 'devices-permissions',
		group: 'devices',
		title: 'Device permission mode',
		endpoint: '/api/v1/devices/permissions',
		summary: 'Sets the current account’s execution preference for one paired computer.',
		detail:
			'Each account/device connection defaults to always-allow, so supported actions run without a repeated Thingtime approval prompt. ask-every-time retains the existing one-command approval flow; deny rejects new remote actions. Pairing, freshness, capability, locked-session and macOS privacy checks remain enforced in every mode.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session.' },
		methods: ['POST'],
		steps: ['Choose a paired device.', 'Set its per-account execution mode.', 'Future commands follow the new preference.'],
		requestExamples: [
			{
				name: 'Ask every time',
				description: 'Require a prompt before each future command.',
				method: 'POST',
				body: { deviceId: 'device-id', mode: 'ask-every-time' }
			}
		],
		responseExamples: [{ status: 200, description: 'Preference saved.', body: { ok: true, deviceId: 'device-id', mode: 'ask-every-time' } }]
	}),
	endpoint({
		id: 'devices-pairing',
		group: 'devices',
		title: 'Create device pairing challenge',
		endpoint: '/api/v1/devices/pairing',
		summary: 'Creates one strong, short-lived, single-use pairing challenge.',
		detail:
			'Returns the only copy of a 256-bit pairing secret. Thingtime stores only its domain-separated SHA-256 hash in a TTL-reaped scoped session.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session; fail-closed rate limited.' },
		methods: ['POST'],
		steps: ['Create a challenge.', 'Transfer the secret to the local node over the QR/deep-link pairing channel.'],
		requestExamples: [{ name: 'Pair computer', description: 'Create one challenge.', method: 'POST' }],
		responseExamples: [
			{
				status: 200,
				description: 'Challenge created.',
				body: { ok: true, pairing: { pairingId: 'pair-id', pairingSecret: 'ttpair_…', expiresAt: '2026-08-18T01:00:00.000Z' } }
			}
		]
	}),
	endpoint({
		id: 'devices-pairing-claim',
		group: 'devices',
		title: 'Claim device pairing',
		endpoint: '/api/v1/devices/pairing/claim',
		summary: 'Atomically pairs one node with a locally generated opaque credential.',
		detail:
			'The node generates a ttnode_ credential with at least 256 random bits and retains it in Keychain or an equivalent OS vault. Thingtime stores only its hash. Device creation, quota admission, credential session creation and challenge consumption commit together. Exact retries recover; changed retries return 409.',
		auth: { mode: 'none', description: 'One-time pairing secret in the JSON body; fail-closed IP rate limit.' },
		methods: ['POST'],
		steps: [
			'Generate and persist the node credential locally.',
			'POST the challenge, credential, descriptor and capabilities once.',
			'Use the credential only as Bearer auth on node routes.'
		],
		requestExamples: [
			{
				name: 'Claim',
				description: 'Pair a macOS node.',
				method: 'POST',
				body: {
					pairingSecret: 'ttpair_…',
					credential: 'ttnode_…',
					device: { name: 'MacBook Pro', platform: 'macos', model: 'MacBookPro', osVersion: '15.6', appVersion: '1.0' },
					capabilities: ['session.read', 'session.send']
				}
			}
		],
		responseExamples: [
			{ status: 200, description: 'Paired.', body: { ok: true, device: { id: 'device-id', name: 'MacBook Pro' }, credentialStored: true } },
			{
				status: 409,
				description: 'Challenge was claimed with different content.',
				body: { ok: false, error: 'This pairing challenge was already claimed with different device data' }
			}
		]
	}),
	endpoint({
		id: 'devices-node-state',
		contractVersion: '1.8.0',
		group: 'devices',
		title: 'Publish device state',
		endpoint: '/api/v1/devices/node/state',
		summary: 'Applies one quota-accounted, monotonic state and connector snapshot.',
		detail:
			'The credential fixes owner and device; request ids cannot override either. Equal revision/equal hash is a no-op, equal revision/different hash is 409, and older revisions are ignored. Raw paths, process arguments and window titles are not accepted.',
		auth: { mode: 'bearer', description: 'Scoped ttnode_ Bearer credential only.' },
		methods: ['POST'],
		steps: [
			'Increment the durable local revision.',
			'Send the complete bounded state and connector snapshot.',
			'Retry the exact body until acknowledged.'
		],
		requestExamples: [
			{
				name: 'Snapshot',
				description: 'Publish device state.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					revision: 42,
					state: {
						locked: false,
						volume: 0.5,
						brightness: 0.8,
						battery: { level: 0.82, charging: true, isExternalPower: true, isPreventingIdleSleep: false, isLowPowerModeEnabled: false },
						powerTimers: { displayIdleMinutes: 10, systemSleepMinutes: 30, diskIdleMinutes: 0 },
						appleMusic: { isInstalled: true, isRunning: false },
						spotify: { isInstalled: true, isRunning: false },
						chromeYouTube: { isInstalled: true, isRunning: false },
						displays: [{ id: 42, width: 1728, height: 1117, isMain: true, isBuiltIn: true, brightness: 0.8, brightnessControlSupported: true, currentMode: { id: '1728x1117@60000:0', width: 1728, height: 1117, refreshRate: 60 }, availableModes: [], originX: 0, originY: 0, mirroredDisplayId: null, hdrActive: false }],
						openApps: [{ id: 'com.openai.chat', name: 'ChatGPT', frontmost: true }]
					},
					connectors: [
						{ id: 'chatgpt-desktop', kind: 'chatgpt', label: 'ChatGPT', status: 'connected', capabilities: ['session.read', 'session.send'] }
					]
				}
			}
		],
		responseExamples: [{ status: 200, description: 'Applied or exactly replayed.', body: { ok: true, revision: 42, applied: true, stale: false } }]
	}),
	endpoint({
		id: 'devices-commands',
		contractVersion: '1.8.0',
		group: 'devices',
		title: 'Device commands',
		endpoint: '/api/v1/devices/commands',
		summary: 'Lists or creates idempotent, typed commands for one device.',
		detail:
			'Unknown kinds and input fields are rejected. The typed vocabulary covers controlled apps; audio routing, mute, and levels; Wi-Fi; persistent per-display mode, layout, and mirroring controls; printer, camera, Bluetooth-device, VPN, and power controls; fixed Apple Music and Spotify playback and app-volume changes; fixed active-tab Chrome YouTube/YouTube Music volume; strict screen-relative pointer movement/click/scroll; bounded text entry; allowlisted keyboard shortcuts; lifecycle actions; and screen-session metadata. Every remote input command always needs a fresh approval and the node must have macOS Accessibility permission. Text is not exposed as a key log, and no clipboard, arbitrary script, shell, event tap, Input Monitoring, Full Disk Access, or root capability is requested. Every media volume action accepts only level: 0..1 and always needs a fresh approval plus macOS Automation consent. Chrome additionally requires the user-enabled Allow JavaScript from Apple Events setting and runs one fixed media-element command only; it never accepts a URL, selector, script, browser-profile input, or reports page data. AirDrop and global camera availability use two distinct fixed profile-proposal commands. They each accept only enabled: boolean, require a fresh approval, write exactly one local .mobileconfig, and open macOS profile review; the Mac user must separately install or decline it. The proposal cannot silently install a profile, create MDM enrollment, carry arbitrary profile content, or alter per-app camera TCC. Wi-Fi accepts only a visible SSID and never a password. HDR and Low Power Mode are read-only; Focus, Bluetooth radio state, per-app camera privacy, cross-origin browser embeds, generic global media playback, and live screen-pixel transport have no supported scoped setter. No arbitrary executable input exists. Pairing, capability, freshness, locked-session and macOS privacy checks remain required in every mode.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session.' },
		methods: ['GET', 'POST'],
		steps: ['Use a stable requestId.', 'POST one closed kind-specific envelope.', 'Retry it unchanged; changed reuse returns 409.'],
		requestExamples: [
			{
				name: 'Move pointer',
				description: 'Queue one approval-gated pointer event relative to a currently reported display.',
				method: 'POST',
				body: { deviceId: 'device-id', requestId: 'web-pointer-123', kind: 'input.pointer.move', input: { displayId: 42, x: 400, y: 300 } }
			},
			{
				name: 'Queue chat message',
				description: 'Queue, rather than steer, one session message.',
				method: 'POST',
				body: {
					deviceId: 'device-id',
					requestId: 'web-123',
					kind: 'session.send',
					input: { connectorId: 'chatgpt-desktop', sessionId: 'chat-1', text: 'Please run the tests.', delivery: 'queue' }
				}
			},
			{
				name: 'Steer current turn',
				description: 'Optimistically locks steering to the visible turn.',
				method: 'POST',
				body: {
					deviceId: 'device-id',
					requestId: 'web-124',
					kind: 'session.send',
					input: { connectorId: 'chatgpt-desktop', sessionId: 'chat-1', text: 'Focus on auth.', delivery: 'steer', expectedTurnId: 'turn-9' }
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Command accepted.',
				body: {
					ok: true,
					command: { id: 'command-id', status: 'queued', kind: 'session.send', requiresApproval: false, approvalState: 'not-required' },
					idempotent: false
				}
			},
			{ status: 409, description: 'requestId conflict.', body: { ok: false, error: 'requestId was already used for different command content' } }
		]
	}),
	endpoint({
		id: 'devices-node-commands',
		contractVersion: '1.8.0',
		group: 'devices',
		title: 'Device command lease channel',
		endpoint: '/api/v1/devices/node/commands',
		summary: 'Claims, heartbeats and reports journal-backed device work.',
		detail:
			'op=claim optionally long-polls for 20 seconds and returns a short random lease. Only the lease hash is stored. Required-approval commands cannot be claimed while approvalState is pending or denied; a claimed envelope explicitly carries approvalState=approved or not-required. op=heartbeat extends the lease; op=report carries a stable eventId and a monotonic status. Ambiguous expired execution becomes needs-review and is never blindly reclaimed. approval-request and approvals implement the separate in-flight one-decision approval bridge; screen-status updates lifecycle metadata only.',
		auth: { mode: 'bearer', description: 'Scoped ttnode_ Bearer credential only.' },
		methods: ['POST'],
		steps: ['Claim one command.', 'Journal before side effects.', 'Heartbeat while active.', 'Report with a stable eventId until acknowledged.'],
		requestExamples: [
			{
				name: 'Claim',
				description: 'Bounded long poll.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: { op: 'claim', waitMs: 20000 }
			},
			{
				name: 'Report',
				description: 'Report exact result metadata.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					op: 'report',
					commandId: 'command-id',
					leaseId: 'lease-secret',
					eventId: 'journal-event-7',
					status: 'succeeded',
					outputRef: 'turn-10'
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Command claimed.',
				body: {
					ok: true,
					command: { id: 'command-id', leaseId: 'lease-secret', status: 'claimed', requiresApproval: true, approvalState: 'approved' },
					serverTime: '2026-08-18T01:00:00.000Z'
				}
			}
		]
	}),
	endpoint({
		id: 'devices-node-sync',
		group: 'devices',
		title: 'Device chat mirror sync',
		endpoint: '/api/v1/devices/node/sync',
		summary: 'Maps one bounded native AI batch into quota-billed relational Messenger rows.',
		detail:
			'Same bounded batch vocabulary as /ai/connections, but owner/device identity comes from the node credential and the connector must already be active on that device. Device and connector are included in server-hashed idempotency namespaces. Edits update existing message segments and delete stale trailing segments transactionally, so retries neither duplicate nor leak quota.',
		auth: { mode: 'bearer', description: 'Scoped ttnode_ Bearer credential only.' },
		methods: ['POST'],
		steps: [
			'Publish the connector in node/state.',
			'Send projects, conversations, then messages.',
			'Coalesce live deltas and retry batches unchanged.'
		],
		requestExamples: [
			{
				name: 'Sync message',
				description: 'Upsert one mirrored message.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					source: { provider: 'chatgpt', sourceId: 'desktop', label: 'ChatGPT', connector: 'chatgpt-desktop', mode: 'local' },
					groups: [],
					conversations: [{ id: 'chat-1', title: 'Thingtime', groupId: null }],
					messages: [{ id: 'message-1', conversationId: 'chat-1', role: 'assistant', text: 'Working…' }],
					final: false
				}
			}
		],
		responseExamples: [
			{ status: 200, description: 'Batch applied.', body: { ok: true, accepted: { groups: 0, conversations: 1, messages: 1, messageSegments: 1 } } }
		]
	}),
	endpoint({
		id: 'devices-node-live-sync',
		group: 'devices',
		title: 'Device live AI materialization',
		endpoint: '/api/v1/devices/node/live-sync',
		summary: 'Materializes bounded live desktop sessions, transcript pages and monotonic visible events.',
		detail:
			'Node identity fixes owner and device; connector metadata and capabilities come from the active device-connector row. sessions.upsert accepts up to 100 revisioned summaries with optional opaque projectId and projectLabel but never paths. transcript.page accepts up to 100 discriminated revisioned entries: completed visible user/assistant messages are quota-billed relational mirrors, while closed safe activity labels are retained briefly as control-plane history. events.append accepts 1..100 contiguous sequence events from the closed visible vocabulary: message.queued/submitted/delta, item.started/completed, turn.started/completed/interrupted, approval.requested/responded, and connector.warning. Accepted events enter /devices/events as ai.session-event payloads shaped {connectorId,sessionId,sequence,observedAt,turnId,itemId,type,payload}; reasoning, paths and tool input/output are rejected. Deltas preserve exact whitespace and expire, while each non-empty completed visible item and every submitted user prompt must carry a matching revisioned message envelope that reconciles in the same transaction. The envelope is never projected into the event payload. Equal revisions/hashes replay, changed equal revisions and stale revisions return 409, and shorter completed revisions delete trailing segments and refund their exact quota bytes.',
		auth: { mode: 'bearer', description: 'Scoped ttnode_ Bearer credential only.' },
		methods: ['POST'],
		steps: [
			'Publish the AI connector through node/state.',
			'Upsert revisioned session summaries.',
			'Page discriminated visible history into transcript.page.',
			'Append contiguous live events and include matching message envelopes on submitted/completed visible text.'
		],
		requestExamples: [
			{
				name: 'Session summary',
				description: 'Create or refresh one live native session.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					op: 'sessions.upsert',
					connectorId: 'chatgpt-desktop',
					sessions: [
						{
							sessionId: 'session-1',
							revision: 4,
							title: 'Thingtime',
							projectId: 'project-1',
							projectLabel: 'Thingtime',
							state: 'running',
							updatedAt: '2026-08-18T01:00:00.000Z'
						}
					]
				}
			},
			{
				name: 'Transcript page',
				description: 'Materialize completed visible messages and safe activity.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					op: 'transcript.page',
					connectorId: 'chatgpt-desktop',
					sessionId: 'session-1',
					page: { cursor: null, nextCursor: 'older-2', hasMore: true },
					entries: [
						{
							type: 'message',
							messageId: 'message-1',
							revision: 1,
							role: 'assistant',
							text: 'Working…',
							createdAt: null,
							completedAt: '2026-08-18T01:00:02.000Z'
						},
						{
							type: 'activity',
							activityId: 'activity-1',
							revision: 1,
							turnId: 'turn-1',
							activity: 'command',
							label: 'Command execution',
							status: 'completed',
							observedAt: '2026-08-18T01:00:02.000Z'
						}
					]
				}
			},
			{
				name: 'Live delta',
				description: 'Publish one exact visible assistant delta.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					op: 'events.append',
					connectorId: 'chatgpt-desktop',
					sessionId: 'session-1',
					events: [
						{
							eventId: 'event-1',
							sequence: 1,
							observedAt: '2026-08-18T01:00:03.000Z',
							turnId: 'turn-1',
							itemId: 'message-2',
							type: 'message.delta',
							payload: { delta: ' Running tests…' }
						}
					]
				}
			},
			{
				name: 'Submitted prompt',
				description: 'Persist a remote user prompt while publishing its live delivery event.',
				method: 'POST',
				headers: { Authorization: 'Bearer ttnode_…' },
				body: {
					op: 'events.append',
					connectorId: 'chatgpt-desktop',
					sessionId: 'session-1',
					events: [
						{
							eventId: 'event-2',
							sequence: 2,
							observedAt: '2026-08-18T01:00:04.000Z',
							turnId: 'turn-1',
							itemId: null,
							type: 'message.submitted',
							payload: { commandId: 'command-1', mode: 'queue', text: 'Run the tests' },
							message: {
								messageId: 'command-1',
								revision: 1,
								role: 'user',
								text: 'Run the tests',
								createdAt: '2026-08-18T01:00:04.000Z',
								completedAt: '2026-08-18T01:00:04.000Z'
							}
						}
					]
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Events accepted.',
				body: {
					ok: true,
					op: 'events.append',
					acceptedEvents: 1,
					replayedEvents: 0,
					materializedMessages: 1,
					idempotentMessages: 0,
					messageSegments: 1,
					lastSequence: 2
				}
			},
			{ status: 409, description: 'Stale or gapped sequence.', body: { ok: false, error: 'Live event sequence 2 is required before 3' } }
		]
	}),
	endpoint({
		id: 'devices-approvals',
		group: 'devices',
		title: 'Device approvals',
		endpoint: '/api/v1/devices/approvals',
		summary: 'Lists approval requests or records one final decision.',
		detail: 'Approvals are owner/device filtered. Repeating the same decision is a no-op; a conflicting or expired decision returns 409.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session.' },
		methods: ['GET', 'POST'],
		steps: ['GET pending approvals for a device.', 'POST approved or denied once.'],
		requestExamples: [
			{ name: 'Approve', description: 'Approve one local action.', method: 'POST', body: { approvalId: 'approval-id', decision: 'approved' } }
		],
		responseExamples: [
			{ status: 200, description: 'Decision saved.', body: { ok: true, approval: { id: 'approval-id', status: 'approved' }, idempotent: false } }
		]
	}),
	endpoint({
		id: 'devices-events',
		group: 'devices',
		title: 'Device event stream',
		endpoint: '/api/v1/devices/events',
		summary: 'Returns a reconnectable, cursor-ordered NDJSON device event feed.',
		detail:
			'The request may wait up to 20 seconds. Each response emits hello, zero or more bounded events, and the next cursor, with no-store/no-buffer headers. Reconnect using the last acknowledged cursor; no high-frequency frames or token deltas are persisted here.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session.' },
		methods: ['GET'],
		steps: ['Open with deviceId and optional cursor.', 'Process newline-delimited events.', 'Reconnect with the final cursor.'],
		requestExamples: [
			{ name: 'Stream', description: 'Wait for events.', method: 'GET', query: { deviceId: 'device-id', cursor: null, waitMs: 20000, limit: 100 } }
		],
		responseExamples: [
			{
				status: 200,
				description: 'application/x-ndjson stream.',
				body: { type: 'cursor', cursor: 'opaque-cursor' },
				headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
			}
		]
	}),
	endpoint({
		id: 'devices-screen',
		group: 'devices',
		title: 'Screen session lifecycle',
		endpoint: '/api/v1/devices/screen',
		summary: 'Lists, starts or stops safe screen-session lifecycle metadata.',
		detail:
			'Stores only quota-billed requested/approval/connecting/active/terminal metadata. Frames, screenshots, audio, SDP, ICE and TURN credentials are rejected and never persist through this endpoint. Starting queues an allowlisted screen.start command requiring local approval.',
		auth: { mode: 'session-or-bearer', description: 'Full Thingtime user session.' },
		methods: ['GET', 'POST'],
		steps: ['POST action=start with a stable requestId.', 'Wait for local approval and screen-status events.', 'POST action=stop when done.'],
		requestExamples: [
			{
				name: 'Start view-only',
				description: 'Request local approval.',
				method: 'POST',
				body: { action: 'start', deviceId: 'device-id', requestId: 'screen-1', viewOnly: true }
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Lifecycle created.',
				body: { ok: true, session: { id: 'screen-id', status: 'requested', viewOnly: true }, command: { kind: 'screen.start', status: 'queued' } }
			}
		]
	})
];

export const apiEndpointDocs: ApiEndpointDoc[] = [
	endpoint({
		id: 'capabilities',
		contractVersion: '1.1.0',
		group: 'platform',
		title: 'API capabilities',
		endpoint: '/api/v1/capabilities',
		summary: 'Returns the origin-scoped compatibility manifest for every documented and executable Thingtime API operation.',
		detail:
			'Clients use this public manifest to negotiate supported API contracts before enabling optional features. Semantic api.* features are independently versioned; route.* features enumerate every active API route, including intentionally undocumented diagnostics. The manifest also declares the non-secret data/authentication environment and federation group for this origin, so aliases and previews can select the correct first-party authority without inferring it from a deployment URL. Additions are minor or patch changes and breaking changes receive a new major version.',
		auth: { mode: 'none', description: 'Public deployment metadata only: never an account, connection string, credential, or other database secret.' },
		methods: ['GET'],
		steps: ['Fetch once per origin and honour the short cache window.', 'Compare only the feature contracts a client requires.'],
		requestExamples: [{ name: 'Discover capabilities', description: 'Read the active API contract manifest.', method: 'GET' }],
		responseExamples: [
			{
				status: 200,
				description: 'Versioned capability manifest plus non-secret data authority.',
				body: {
					ok: true,
					schemaVersion: 1,
					features: { 'api.capabilities': '1.1.0', 'api.devices': '1.0.0' },
					dataEnvironment: {
						schemaVersion: 1,
						id: 'development',
						kind: 'development',
						federationId: 'development',
						authorityOrigin: 'https://dev.thingtime.com'
					}
				}
			}
		]
	}),
	endpoint({
		id: 'peers',
		contractVersion: '1.1.0',
		group: 'platform',
		title: 'Deployment peer discovery',
		endpoint: '/api/v1/peers',
		summary: 'Streams bounded, authenticated same-data-environment peer leases and accepts signed deployment announcements.',
		detail:
			'First-party deployments authenticate with a short-lived HMAC envelope plus an Ed25519 deployment signature. The signed envelope binds the stable public federationId, so production, development, and custom database authorities never gossip into each other. The receiver pins each public key to its canonical origin; every NDJSON event is independently signed. GET returns a capped NDJSON page rather than an all-peers array; POST announces one peer or starts a bounded bootstrap-plus-gossip sync. Peer records are relational, TTL-reaped control-plane rows and contain only public deployment origins, signing public keys, safe data-environment ids, and observed lease times.',
		auth: { mode: 'bearer', description: 'Deployment-to-deployment HMAC headers using THINGTIME_PEER_DISCOVERY_SECRET plus an Ed25519 signature from THINGTIME_PEER_SIGNING_PRIVATE_KEY; browser and user tokens are not accepted.' },
		methods: ['GET', 'POST'],
		steps: ['Sign the exact method, path, timestamp and raw request body.', 'GET pages NDJSON peer events with a maximum of 50 rows.', 'POST { op: "announce", origin } or a self-signed { op: "sync" }.'],
		requestExamples: [
			{ name: 'Stream one page', description: 'A trusted deployment reads a bounded peer page.', method: 'GET', query: { limit: 25 } },
			{ name: 'Announce this deployment', description: 'A trusted peer renews only its own lease.', method: 'POST', body: { op: 'announce', origin: 'https://pr-68.previews.dev.thingtime.com' } }
		],
		responseExamples: [{ status: 200, description: 'NDJSON peer events followed by a page-complete cursor.', headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }],
		notes: ['Peer discovery is unavailable unless both private deployment credentials are configured. It never exposes users, data-plane endpoints, private keys, tokens, paths, or an unbounded peer list.']
	}),
	endpoint({
		id: 'peers-sync',
		group: 'platform',
		title: 'Advance deployment peer discovery',
		endpoint: '/api/v1/peers/sync',
		summary: 'Trusted scheduler-only, bounded peer gossip pass.',
		detail:
			'Vercel Cron invokes this production bootstrap route every five minutes with CRON_SECRET. It emits the same independently Ed25519-signed NDJSON progress records as a self-signed peer sync, advances at most one cursor page for each bounded probe set, and never returns an all-peers array. Other deployments can schedule the same route with their own CRON_SECRET.',
		auth: { mode: 'bearer', description: 'Exact CRON_SECRET bearer only; it is a deployment scheduler endpoint, not a browser or user API.' },
		methods: ['GET'],
		steps: [
			'Configure CRON_SECRET, THINGTIME_PEER_DISCOVERY_SECRET, THINGTIME_PEER_SIGNING_PRIVATE_KEY, THINGTIME_PUBLIC_ORIGIN, and THINGTIME_DATA_ENV in the deployment environment.',
			'Let the scheduler invoke the route; do not expose its credentials to clients.'
		],
		requestExamples: [{ name: 'Scheduled sync', description: 'Vercel supplies the private bearer header.', method: 'GET' }],
		responseExamples: [{ status: 200, description: 'A bounded signed NDJSON sync progression.', headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }],
		notes: ['Vercel cron runs the production bootstrap. Preview and non-Vercel deployments need an equivalent trusted deploy hook or scheduler to join and keep renewing their lease.']
	}),
	endpoint({
		id: 'admin-peers',
		group: 'admin',
		title: 'Deployment peer explorer',
		endpoint: '/api/v1/admin/peers',
		summary: 'Returns an administrator-only, cursor-paged diagnostic projection of locally known deployment leases.',
		detail:
			'Used by Developer → Deployment peers. It reuses the signed mesh cursor bounds while returning JSON only to an authenticated administrator. It never exposes HMAC material, private keys, request signatures, or a peer traversal cursor; each row contains only origin, pinned public key, lease timestamps, and a derived active or expired status.',
		auth: { mode: 'session-or-bearer', description: 'Thingtime administrator session or bearer token.' },
		methods: ['GET'],
		steps: ['GET one bounded page (default 25, maximum 50).', 'Follow nextCursor deliberately when more diagnostic rows are needed.', 'Use the Developer → Deployment peers page for all-field filtering and grid, card, or list presentation.'],
		requestExamples: [{ name: 'Read one peer page', description: 'Administrators only.', method: 'GET', query: { limit: 25 } }],
		responseExamples: [
			{
				status: 200,
				description: 'Private diagnostic peer page.',
				body: {
					ok: true,
					peers: [
						{
							origin: 'https://thingtime.com',
							signingPublicKey: 'base64url-spki',
							firstSeenAt: '2026-08-24T00:00:00.000Z',
							lastSeenAt: '2026-08-24T00:05:00.000Z',
							expiresAt: '2026-08-24T00:15:00.000Z',
							status: 'active'
						}
					],
					nextCursor: null
				}
			}
		],
		notes: ['The browser route is intentionally separate from /api/v1/peers. It cannot participate in gossip or access a deployment signing identity.']
	}),
	...deviceEndpointDocs,
  endpoint({
    id: 'docs',
    group: 'docs',
    title: 'All API docs as Markdown',
    endpoint: '/api/docs',
    summary: 'Every Thingtime API endpoint documented in one Markdown file — made for AIs and humans alike.',
    detail:
      'GET returns text/markdown covering every endpoint in this catalog: methods, auth, summary, detail, ' +
      'steps, request/response examples, and a curl call each. If you are an AI (or a person) discovering ' +
      'the API by scanning /api* routes, fetch this once and you have the whole reference. Per-endpoint ' +
      'JSON versions also exist at <endpoint>-docs (e.g. /api/v1/things-docs), and the human-readable ' +
      'browser docs live at /docs/api. Anonymous, no auth.',
    auth: { mode: 'none', description: 'Public — documentation data.' },
    methods: ['GET'],
    steps: ['GET /api/docs and read the Markdown.'],
    requestExamples: [{ name: 'Fetch the reference', description: 'The whole API as one Markdown document.', method: 'GET' }],
    responseExamples: [{ status: 200, description: 'Markdown document.', headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }]
  }),
  endpoint({
    id: 'admin-ci-control',
    group: 'admin',
    title: 'CI control dashboard snapshot',
    endpoint: '/api/v1/admin/ci',
    featureVersion: '1.0.2',
    summary: 'Read the protected GitHub/Vercel CI entity graph and immutable status history.',
    detail:
      'Returns repositories, features, branches, pull requests, workflow runs, deployments, previews, audited dispatches, and relational ci-event history stored as protected Things. The response also reports integration readiness and freshness without exposing credentials.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET'],
    steps: ['GET with an admin session.', 'Render cached entities immediately, then reconcile in the background when freshness is stale.'],
    requestExamples: [{ name: 'Load CI control', description: 'Use limit=0 to load every selectable feature, branch, and pull request. Recent run, deployment, preview, and dispatch activity stays bounded; summary counts remain exact.', method: 'GET', query: { limit: 0 } }],
    responseExamples: [
      {
        status: 200,
        description: 'CI control snapshot.',
        body: {
          ok: true,
          dashboard: {
            pullRequests: [{ kind: 'ci-pull-request', number: 190, status: 'conflicting' }],
            workflowRuns: [{ kind: 'ci-workflow-run', runId: 31303934385, status: 'in_progress' }],
            events: [{ kind: 'ci-event', eventType: 'workflow_run', statusTo: 'in_progress' }]
          },
          integration: {
            repository: 'lopugit/thingtime',
            controlPlaneRef: 'github-actions',
            githubAppConfigured: true,
            providerRouterConfigured: true,
            vercelRunnerConfigured: true,
            vercelRunnerReady: true,
            vercelRunnerMissing: []
          }
        }
      },
      { status: 403, description: 'Not an admin.', body: { ok: false, error: 'Admins only' } },
      {
        status: 503,
        description: 'A MongoDB blocking sort exceeded its memory ceiling. Retry-After is present and the client keeps its last-known cached snapshot.',
        headers: { 'Retry-After': '30' },
        body: {
          ok: false,
          error: 'CI dashboard data is temporarily unavailable. Last-known cached data remains safe to use.',
          code: 'ci_dashboard_query_capacity',
          retryable: true
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-ci-dispatch',
    group: 'admin',
    title: 'Dispatch a CI control-plane workflow',
    endpoint: '/api/v1/admin/ci/dispatch',
    featureVersion: '2.1.0',
    summary: 'Dispatch one allowlisted GitHub Actions workflow and write an immutable audit event.',
    detail:
      'Admins can request a multi-target Feature Stack, the resolver, stack rebaser, promoters, sync, Web CI, or Electron release. A Feature Stack accepts one or more ordered open same-repository PRs and one or more target branches. With auto-decide enabled, the server uses each live PR base branch to assign it only to compatible selected targets, safely omits selected sources and targets with no compatible partner, snapshots every remaining source ref and SHA into a canonical immutable plan, and rejects a plan with no compatible pair instead of crossing branch families. The protected Lopu controller combines each target-specific source list in order, mechanically verifies merge topology and conflict-only AI edits, then opens one branch-protected auto-merge PR per active target. Workflow names and inputs are server-allowlisted; arbitrary workflow paths, caller-provided SHAs, and secret-bearing inputs are rejected. GitHub App installation credentials remain server-only.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
		steps: [
			'Choose an allowlisted workflow and target ref.',
			'POST optional allowlisted inputs.',
			'Follow the returned dispatch id in /api/v1/admin/ci.'
		],
    requestExamples: [
      {
        name: 'Retry conflict resolution',
        description: 'Ask the develop listener to resolve one exact PR using the github-actions control plane.',
        method: 'POST',
        body: { workflow: 'resolve-conflicts', ref: 'develop', inputs: { pr_number: '190' } }
      },
      {
        name: 'Merge a Feature Stack into develop and main',
        description: 'Snapshot the selected PRs in this exact order and dispatch one verified integration job per target.',
        method: 'POST',
        body: {
          workflow: 'feature-stack',
          ref: 'develop',
          inputs: {
            name: 'Search + Messenger',
            source_pr_numbers: [427, 434],
            targets: ['develop', 'main']
          }
        }
      }
    ],
    responseExamples: [
      {
        status: 202,
        description: 'GitHub accepted the dispatch.',
        body: { ok: true, dispatchId: 'ci-example', workflowFile: 'resolve-pr-conflicts.yml', ref: 'develop', controlPlaneRef: 'github-actions' }
      },
			{
				status: 502,
				description: 'GitHub could not accept the request.',
				body: { ok: false, error: 'The workflow could not be dispatched. Check the GitHub App integration and try again.' }
			}
    ]
  }),
  endpoint({
    id: 'admin-ci-feature-stacks',
    group: 'admin',
    title: 'Manage saved Feature Stacks',
    endpoint: '/api/v1/admin/ci/stacks',
    featureVersion: '1.3.0',
    summary: 'Save, edit, list, run, pause, stop, restart, and archive reusable multi-target Feature Stacks.',
    detail:
      'Saved stacks are protected system Things. Their ordered source pull requests and target branches are relational ci-feature-stack-entry Things, while each bounded run-history row is a relational ci-dispatch linked to the exact GitHub workflow run. GET includes a bounded stack-specific event stream so progress heartbeats remain visible even when unrelated repository activity exceeds the general dashboard event window. POST run reloads live PR metadata, safely omits sources that have already closed, merged, or become drafts, preserves the order of every remaining live source, and creates the immutable target-aware controller plan and durable run identity at execution time. Pause and stop cancel only the exact active linked workflow while preserving the saved definition and history; restart cancels active compute before dispatching a fresh immutable run.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: ['GET all saved stacks.', 'POST save to create or edit a stack.', 'POST run or restart to dispatch a current live plan.', 'POST pause or stop to cancel exact active compute while preserving history, or delete to archive it.'],
    requestExamples: [
      { name: 'Save a stack', description: 'Sources and targets have no product-imposed count cap.', method: 'POST', body: { action: 'save', name: 'Search + Actions', sourcePrNumbers: [427, 486], targets: ['main', 'github-actions'], autoDecideBranches: true } },
      { name: 'Run a stack', description: 'Run the latest saved revision.', method: 'POST', body: { action: 'run', id: 'ci-feature-stack-example' } },
      { name: 'Pause a stack', description: 'Cancel active compute and preserve the saved definition for restart.', method: 'POST', body: { action: 'pause', id: 'ci-feature-stack-example' } },
      { name: 'Restart a stack', description: 'Cancel an active run if necessary and dispatch a fresh immutable plan.', method: 'POST', body: { action: 'restart', id: 'ci-feature-stack-example' } }
    ],
    responseExamples: [{ status: 200, description: 'Redacted saved stack configuration with bounded workflow and progress-event history.', body: { ok: true, stacks: [{ id: 'ci-feature-stack-example', name: 'Search + Actions', sourcePrNumbers: [427, 486], targets: ['main', 'github-actions'], autoDecideBranches: true, status: 'saved', runs: [{ id: 'ci-dispatch-example', runId: 'feature-stack-run-example', status: 'success', workflowRunId: 123, url: 'https://github.com/lopugit/thingtime/actions/runs/123' }] }], events: [{ id: 'ci-event-example', parentId: 'ci-dispatch-example', eventType: 'feature_stack_progress', statusTo: 'in_progress', occurredAt: '2026-09-01T00:10:00.000Z', data: { message: 'Lopu progress: 1 active, 0 queued, 0/1 finished.', progressPercent: 45 } }] } }]
  }),
  endpoint({
    id: 'admin-ci-previews',
    group: 'admin',
    title: 'Manage opt-in PR preview environments',
    endpoint: '/api/v1/admin/ci/previews',
    featureVersion: '1.0.0',
    summary: 'Enable or disable exact-SHA develop and production-environment previews for one trusted pull request.',
    detail:
      'This admin-only controller validates a live, open, non-draft pull request from the configured repository before enabling a preview. Develop and production are independent durable policy switches and may both be enabled. The server creates an immutable Vercel deployment for the current head SHA using either the configured develop Custom Environment or the production environment. Production enabling requires an explicit acknowledgement. Credential values remain server-only, custom-domain assignment is always disabled, and disabling removes only deployments carrying Thingtime\'s PR-and-environment ownership markers.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
    steps: [
      'Select a same-repository open pull request.',
      'Enable develop, production, or both; acknowledge production-environment access when enabling production.',
      'Follow the returned immutable Vercel URL and the signed webhook status in CI Control.'
    ],
    requestExamples: [
      {
        name: 'Enable a develop preview',
        description: 'Build the exact current PR head with the develop Custom Environment.',
        method: 'POST',
        body: { prNumber: 496, environment: 'develop', enabled: true }
      },
      {
        name: 'Enable a production-environment preview',
        description: 'Explicitly allow this trusted PR to run with production environment values without assigning production domains.',
        method: 'POST',
        body: { prNumber: 496, environment: 'production', enabled: true, acknowledgeProductionData: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Policy stored and the exact-SHA deployment created or reused.',
        body: { ok: true, policy: { prNumber: 496, develop: true, production: true }, deployment: { deploymentId: 'dpl_example', status: 'queued', url: 'https://thingtime-example.vercel.app/' } }
      },
      { status: 409, description: 'The PR is not a trusted live source, acknowledgement is absent, or the preview provider rejected the build.', body: { ok: false, error: 'Preview policy could not be updated' } }
    ]
  }),
  endpoint({
    id: 'admin-ci-credentials',
    group: 'admin',
    title: 'Manage the ordered Lopu credential waterfall',
    endpoint: '/api/v1/admin/ci/credentials',
    featureVersion: '2.0.0',
    summary: 'Store, rotate, enable, delete, and reorder named AI-platform credentials without exposing their values.',
    detail:
      'Credential values are AES-256-GCM encrypted with THINGTIME_ADMIN_VAULT_KEY and are write-only from the browser. Each entry has a built-in or custom AI platform label; GET and every mutation response contain redacted metadata only. Lopu requests the ordered compatible platform subset from the vault at run time, so GitHub needs one stable router secret instead of one repository secret per account. At most eight entries are stored.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      'GET the redacted ordered list.',
      'POST create, rotate, set-enabled, reorder, or delete.',
      'Use the CI Control page to manage the order without copying values back into the browser.'
    ],
    requestExamples: [
      { name: 'Add a named AI account', description: 'The platform may be built-in or custom; the value is accepted once and never returned.', method: 'POST', body: { action: 'create', name: 'Thingtime Claude', platform: 'Anthropic', value: '<oauth-token>', enabled: true } },
      { name: 'Reorder the waterfall', description: 'Every stored id must appear exactly once.', method: 'POST', body: { action: 'reorder', order: ['lopu_credential_first', 'lopu_credential_second'] } }
    ],
    responseExamples: [
      { status: 200, description: 'Redacted metadata.', body: { ok: true, vaultConfigured: true, credentials: [{ id: 'lopu_credential_first', name: 'Thingtime Claude', platform: 'Anthropic', credentialType: 'claude-code-oauth-token', priority: 0, enabled: true }] } },
      { status: 403, description: 'Not an admin.', body: { ok: false, error: 'Admins only' } }
    ]
  }),
  endpoint({
    id: 'admin-ci-automations',
    group: 'admin',
    title: 'Set a CI automation execution provider',
    endpoint: '/api/v1/admin/ci/automations',
    summary: 'Enable or disable one allowlisted automation and choose GitHub-hosted Actions or Vercel Sandbox compute.',
    detail:
      'Stores one protected ci-automation Thing per allowlisted workflow. Vercel execution keeps the reviewed workflow definition on the protected github-actions branch and runs its Linux jobs on a short-lived Vercel Sandbox registered as a uniquely labelled GitHub self-hosted runner. Unsupported workloads remain locked to GitHub.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
		steps: [
			'Choose an allowlisted workflow.',
			'Choose github-actions or vercel-sandbox.',
			'POST the policy and inspect the resulting audit event in CI Control.'
		],
    requestExamples: [
      {
        name: 'Run the conflict resolver on Vercel',
        description: 'Future automatic and manual resolver runs route through Vercel Workflow and Sandbox.',
        method: 'POST',
        body: { workflow: 'resolve-conflicts', executionProvider: 'vercel-sandbox', enabled: true }
      }
    ],
    responseExamples: [
			{
				status: 200,
				description: 'Policy updated.',
				body: { ok: true, policy: { key: 'resolve-conflicts', executionProvider: 'vercel-sandbox', enabled: true } }
			},
			{
				status: 409,
				description: 'Provider unsupported for this workflow.',
				body: { ok: false, error: 'This automation requires a GitHub-hosted runner' }
			},
      {
        status: 409,
        description: 'Vercel provider setup is incomplete.',
        body: {
          ok: false,
          error: 'Vercel Sandbox is not ready. Complete the GitHub App, provider router, and Vercel runtime setup first.',
          missing: ['THINGTIME_GITHUB_APP_PRIVATE_KEY']
        }
      }
    ]
  }),
  endpoint({
    id: 'chatgpt-mcp',
    group: 'integrations',
    title: 'ChatGPT MCP gateway',
    endpoint: CHATGPT_MCP_PATH,
    summary: 'A streamable HTTP Model Context Protocol gateway for ChatGPT and Codex.',
    detail:
      'Implements 32 bounded MCP tools plus prompts, account-scoped resources, and a sandboxed review UI for connected Thingtime accounts. `login_thingtime` maps @Thingtime login to the host’s OAuth browser and registered callback; `list_thingtime_accounts` maps @Thingtime list accounts to safe multi-account metadata. The read surface includes exact single/batch IDs, target-specific comments, browse/search, schema discovery and validation, relationship/thread traversal, ACL-aware change polling, history, and workflows. Composed writes must produce a signed before/after preview first; apply rechecks token scopes and optimistic updatedAt preconditions, stops after the first failed operation, and persists an honest encrypted receipt with a bounded undo plan. Thingtime Capability data Things compile only the registered create/update/delete grammar with explicit input placeholders — no arbitrary URLs, API paths, database queries, or code. tools/list, prompts/list, resources/list, and static UI/contract resources are public metadata and never return account data. Account resources and every tool call require a revocable MCP-only bridge token; underlying scoped PATs stay AES-256-GCM encrypted in one origin-bound connection record. Discovery begins at /.well-known/oauth-protected-resource and the semantic capability manifest lives at /.well-known/thingtime-chatgpt-capabilities.json.',
    auth: { mode: 'bearer', description: 'OAuth 2.1 ChatGPT bridge Bearer token for tools/call. tools/list is public metadata; unauthenticated tool calls return an MCP OAuth challenge.' },
    methods: ['POST'],
    steps: [
      'Discover protected-resource metadata and complete the authorization-code flow with S256 PKCE.',
      'POST JSON-RPC initialize, tools/list, prompts/list, resources/list, resources/read, and tools/call requests to this endpoint.',
      'Use get_thingtime_thing or get_thingtime_things for known IDs and list_thingtime_comments for a known target; reserve list/search for discovery.',
      'For composed writes, preview the complete plan, review its UI diff, obtain confirmation, then apply the exact signed receipt.'
    ],
    requestExamples: [
      {
        name: 'List tools',
        description: 'MCP JSON-RPC discovery after initialize.',
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Public tool metadata, including each tool’s OAuth requirement and precise action annotations.',
        body: { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_thingtime_thing', securitySchemes: [{ type: 'oauth2', scopes: ['thingtime'] }], annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] } }
      },
      {
        status: 401,
        description: 'MCP OAuth challenge.',
        headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://thingtime.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="A Thingtime connection is required"' },
        body: { jsonrpc: '2.0', id: 1, result: { isError: true, _meta: { 'mcp/www_authenticate': ['Bearer resource_metadata="https://thingtime.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="A Thingtime connection is required"'] } } }
      }
    ],
    notes: [
      'This route does not proxy arbitrary URLs or generic Thingtime API paths. Endpoint origins and operations are explicitly allowlisted.',
      'The capability manifest independently versions MCP, OAuth, connections, read/write Things, schemas, relationships, previews, resources, history, workflows, UI, changes, and Capability Things. It maps every executable tool and MCP method to its owning feature.',
      'resources/subscribe is deliberately advertised as false: list_thingtime_changes is the compatible bounded polling contract, and MCP mutation deletions remain visible through encrypted history receipts.'
    ]
  }),
  endpoint({
    id: 'chatgpt-oauth-authorize',
    group: 'integrations',
    title: 'ChatGPT OAuth authorization',
    endpoint: CHATGPT_AUTHORIZE_PATH,
    summary: 'First-party browser connection page for one or more scoped Thingtime accounts.',
    detail:
      'GET is the OAuth 2.1 authorization endpoint. It requires response_type=code, a configured ChatGPT client ID, or a bounded Codex CIMD/DCR client ID, its matching registered callback, resource equal to this origin’s MCP endpoint, state, and an S256 PKCE challenge. The `thingtime` scope is mandatory; clients may additionally request `offline_access` for rotating refresh credentials. The resulting form accepts one or more named Thingtime API endpoints and personal access tokens, validates every token using /api/v1/tokens/self, encrypts the connection bundle before persistence, then redirects only a five-minute single-use authorization code back to the approved callback. POST submits that form; credentials are never included in the redirect, OAuth code, or client transcript.',
    auth: { mode: 'none', description: 'OAuth public-client request plus user-entered scoped personal access tokens on the first-party connection page.' },
    methods: ['GET', 'POST'],
    steps: [
      'Create least-privilege personal access tokens in each Thingtime account.',
      'Let ChatGPT open this endpoint with its OAuth parameters and approve the accounts in the first-party browser page.',
      'The browser redirects to ChatGPT with a short-lived code and original state.'
    ],
    requestExamples: [
      {
        name: 'Open the OAuth connection page',
        description: 'ChatGPT uses a random state and S256 PKCE challenge.',
        method: 'GET',
        query: {
          response_type: 'code',
          client_id: 'https://chatgpt.com',
          redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
          resource: 'https://thingtime.com/api/v1/integrations/chatgpt/mcp',
          code_challenge: '<S256-challenge>',
          code_challenge_method: 'S256',
          state: '<random-state-at-least-16-characters>',
          scope: 'thingtime offline_access'
        }
      }
    ],
    responseExamples: [
      { status: 200, description: 'First-party form requesting named endpoint/token pairs.', headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      { status: 302, description: 'After validation, redirects to the ChatGPT callback with code, state, and issuer.' },
      { status: 400, description: 'Invalid OAuth request or account form.', body: 'An HTML error page with no credentials echoed.' }
    ]
  }),
  endpoint({
    id: 'chatgpt-oauth-register',
    group: 'integrations',
    title: 'ChatGPT OAuth dynamic client registration',
    endpoint: CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH,
    summary: 'Register a bounded loopback public client when a Codex client cannot use CIMD.',
    detail:
      'OAuth Dynamic Client Registration is a compatibility fallback for Codex clients that do not yet support ChatGPT Client ID Metadata Documents. The endpoint accepts one to eight exact http://127.0.0.1:<port>/callback loopback redirect URIs only, returns a signed opaque public client ID, and never accepts a custom scheme, localhost alias, web URL, query, fragment, or credentialed redirect. The resulting client remains bound to those same registered redirect URIs during authorization-code exchange.',
    auth: { mode: 'none', description: 'Public-client registration is safe because every accepted callback is an exact local loopback URL.' },
    methods: ['POST'],
    steps: ['Register exact loopback callbacks before authorization.', 'Use the returned opaque client_id for the matching authorization-code flow.', 'Discard the client ID when the local client no longer needs the connection.'],
    requestExamples: [
      {
        name: 'Register a Codex loopback client',
        description: 'The client supplies its exact ephemeral local callback before authorization.',
        method: 'POST',
        body: { redirect_uris: ['http://127.0.0.1:49152/callback/thingtime_mcp_AbC123'], token_endpoint_auth_method: 'none' }
      }
    ],
    responseExamples: [
      { status: 201, description: 'A signed public client ID bound to the supplied loopback callback.', body: { client_id: '<signed-opaque-client-id>', redirect_uris: ['http://127.0.0.1:49152/callback/thingtime_mcp_AbC123'], token_endpoint_auth_method: 'none' } },
      { status: 400, description: 'The client attempted an unsupported redirect URI.' }
    ]
  }),
  endpoint({
    id: 'chatgpt-oauth-token',
    group: 'integrations',
    title: 'ChatGPT OAuth token exchange',
    endpoint: CHATGPT_TOKEN_PATH,
    summary: 'Exchange an OAuth code or rotate a refresh credential for an MCP-only bridge credential.',
    detail:
      'For `grant_type=authorization_code`, POST code, client_id, redirect_uri, resource, and code_verifier. The code is one-use and bound atomically to the exact client, callback, resource, and S256 verifier. A `thingtime offline_access` authorization also returns a single-use rotating refresh token. For `grant_type=refresh_token`, POST refresh_token and client_id, plus the same resource when supplied; the token is consumed atomically and replaced. Success returns a non-expiring, server-revocable bridge access token that only works at the ChatGPT MCP gateway; it cannot authenticate any other Thingtime API route and contains no underlying personal access token. Since it does not expire, `expires_in` is omitted.',
    auth: { mode: 'none', description: 'The one-time code, exact binding, and PKCE verifier are the public-client proof.' },
    methods: ['POST'],
    steps: ['Verify state and issuer at the callback.', 'Exchange with the original S256 verifier.', 'Store only the returned bridge credential and, when issued, replace the previous refresh credential atomically.'],
    requestExamples: [
      {
        name: 'Exchange authorization code',
        description: 'Standard OAuth form-encoded public client request.',
        method: 'POST',
        body: { grant_type: 'authorization_code', code: '<one-time-code>', client_id: 'https://chatgpt.com/oauth/client.json', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', resource: 'https://thingtime.com/api/v1/integrations/chatgpt/mcp', code_verifier: '<43-to-128-character-pkce-verifier>' }
      },
      {
        name: 'Rotate an offline-access credential',
        description: 'The former refresh token becomes invalid as this request succeeds.',
        method: 'POST',
        body: { grant_type: 'refresh_token', refresh_token: '<single-use-refresh-jwt>', client_id: 'https://chatgpt.com/oauth/client.json', resource: 'https://thingtime.com/api/v1/integrations/chatgpt/mcp' }
      }
    ],
    responseExamples: [
      { status: 200, description: 'Non-expiring but server-revocable MCP-only bridge access token, plus a replacement refresh credential when offline access was granted.', body: { access_token: '<bridge-jwt>', token_type: 'Bearer', refresh_token: '<rotating-refresh-jwt>', scope: 'thingtime offline_access' } },
      { status: 400, description: 'Invalid, expired, used, or mismatched authorization or refresh grant.', body: { error: 'invalid_grant' } }
    ]
  }),
  endpoint({
    id: 'integration-ci-provider-route',
    group: 'integrations',
    title: 'Route trusted CI work to its selected compute provider',
    endpoint: '/api/v1/integrations/ci/route',
    summary: 'Accept a short-lived HMAC-signed request from the protected control plane and route or continue the workflow.',
    detail:
      'This internal endpoint never accepts arbitrary workflow paths or runners. It validates the signed raw body, freshness window, repository configuration, workflow allowlist, and stored automation policy. Vercel failures fall back to the already-waiting GitHub run and are recorded in ci-event history.',
    auth: { mode: 'none', description: 'Server-to-server HMAC authentication via X-Thingtime-CI-Signature.' },
    methods: ['POST'],
		steps: [
			'Sign the exact JSON body with THINGTIME_CI_ROUTER_SECRET using HMAC-SHA256.',
			'POST within ten minutes of requestedAt.',
			'Honor execute and executionProvider in the response.'
		],
    requestExamples: [
      {
        name: 'Route an automatic resolver trigger',
        description: 'The protected router job asks Thingtime whether this run should continue on GitHub or move to Vercel.',
        method: 'POST',
        headers: { 'X-Thingtime-CI-Signature': 'sha256=<hmac>' },
				body: {
					workflow: 'resolve-conflicts',
					deliveryKey: '123:1:push',
					actorId: 'github-actions[bot]',
					requestedAt: '2026-08-10T01:00:00.000Z',
					inputs: { branch: 'develop' }
				}
      }
    ],
    responseExamples: [
			{
				status: 202,
				description: 'Routing decision accepted.',
				body: { ok: true, execute: false, executionProvider: 'vercel-sandbox', dispatchId: 'ci-example' }
			},
      { status: 403, description: 'Invalid signature.', body: { ok: false, error: 'Invalid route signature' } }
    ]
  }),
  endpoint({
    id: 'integration-ci-credentials',
    group: 'integrations',
    title: 'Deliver the ordered Lopu credential waterfall',
    endpoint: '/api/v1/integrations/ci/credentials',
    featureVersion: '1.1.0',
    summary: 'Return enabled credentials to one fresh, signed, protected-branch GitHub Actions request.',
    detail:
      'The exact body is HMAC-SHA256 signed with THINGTIME_CI_ROUTER_SECRET. The server verifies repository, workflow ref, run identity, freshness, requested platform, and a single-use nonce before decrypting only the ordered compatible entries. Responses are no-store and intended only for immediate in-memory use by Lopu.',
    auth: { mode: 'none', description: 'Server-to-server HMAC authentication via X-Thingtime-CI-Signature.' },
    methods: ['POST'],
    steps: [
      'Create a fresh nonce and request timestamp in a workflow running from github-actions.',
      'Sign the exact JSON body with THINGTIME_CI_ROUTER_SECRET.',
      'On the first migration request only, the controller may include its existing OAuth slots; an empty vault imports them once.',
      'Mask every returned value immediately and keep it only for the current job.'
    ],
    requestExamples: [{ name: 'Fetch for one controller run', description: 'A nonce cannot be replayed. bootstrapCredentials is accepted only while the vault is empty.', method: 'POST', body: { platform: 'Anthropic', repository: 'lopugit/thingtime', workflowRef: 'lopugit/thingtime/.github/workflows/resolve-pr-conflicts.yml@refs/heads/github-actions', runId: '123456', runAttempt: '1', nonce: 'abcdefghijklmnopqrstuvwxyz012345', requestedAt: '2026-08-31T05:00:00.000Z', bootstrapCredentials: [{ name: 'Thingtime Claude', value: '<legacy-oauth-token>' }] } }],
    responseExamples: [
      { status: 200, description: 'Ordered enabled credentials for the requested platform. Values must be masked immediately.', body: { ok: true, credentials: [{ id: 'lopu_credential_first', name: 'Thingtime Claude', platform: 'Anthropic', credentialType: 'claude-code-oauth-token', value: '<oauth-token>' }] } },
      { status: 409, description: 'Replay blocked.', body: { ok: false, error: 'Credential request was already used.' } }
    ]
  }),
  endpoint({
    id: 'integration-ci-progress',
    group: 'integrations',
    title: 'Record a Feature Stack progress heartbeat',
    endpoint: '/api/v1/integrations/ci/progress',
    featureVersion: '1.0.0',
    summary: 'Attach a fresh, signed Lopu progress update to the exact Feature Stack dispatch.',
    detail:
      'The protected github-actions controller reports immediately, on phase changes, every ten minutes, and at completion. Thingtime validates the exact HMAC-signed body, repository, run identifiers, freshness window, bounded target phases, and the stored run-to-stack relationship before appending a relational ci-event. The admin CI console formats the stored estimate in the viewer local timezone.',
    auth: { mode: 'none', description: 'Server-to-server HMAC authentication via X-Thingtime-CI-Signature.' },
    methods: ['POST'],
    steps: [
      'Poll the current protected workflow run with actions:read.',
      'Sign the exact JSON body with THINGTIME_CI_ROUTER_SECRET.',
      'POST the first snapshot, each phase change, every ten minutes, and the terminal snapshot.'
    ],
    requestExamples: [{ name: 'Report Feature Stack progress', description: 'One immutable update for the exact stack run.', method: 'POST', headers: { 'X-Thingtime-CI-Signature': 'sha256=<hmac>' }, body: { deliveryId: 'feature-stack-run-<uuid>:123:1:4', repository: 'lopugit/thingtime', stackId: 'ci-feature-stack-<uuid>', featureStackRunId: 'feature-stack-run-<uuid>', workflowRunId: 123, workflowRunUrl: 'https://github.com/lopugit/thingtime/actions/runs/123', runAttempt: 1, startedAt: '2026-09-01T00:00:00.000Z', reportedAt: '2026-09-01T00:10:00.000Z', expectedFinishAt: '2026-09-01T00:30:00.000Z', status: 'in_progress', message: 'Lopu is resolving 1 of 2 target branches.', progressPercent: 48, targets: [{ target: 'main', status: 'in_progress', phase: 'Resolving conflicts with Lopu', progressPercent: 55, jobUrl: 'https://github.com/lopugit/thingtime/actions/runs/123/job/456' }] } }],
    responseExamples: [
      { status: 202, description: 'Progress event recorded or idempotently replayed.', body: { ok: true, dispatchId: 'ci-example', eventId: 'ci-event-example', inserted: true } },
      { status: 403, description: 'Invalid signature.', body: { ok: false, error: 'Invalid progress signature.' } },
      { status: 404, description: 'The signed run does not belong to a stored Feature Stack dispatch.', body: { ok: false, error: 'Feature Stack run not found.' } }
    ]
  }),
  endpoint({
    id: 'admin-ci-reconcile',
    group: 'admin',
    title: 'Reconcile CI state from GitHub',
    endpoint: '/api/v1/admin/ci/reconcile',
    summary: 'Refresh branches, open PRs, Actions runs, and deployments without discarding webhook history.',
    detail:
      'Uses the least-privileged Thingtime GitHub App installation token to reconcile current GitHub state. Existing ci-event history is append-only; reconciliation corrects current projections and writes its own audit event.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
    steps: ['POST with an admin session.', 'Reload /api/v1/admin/ci after completion.'],
    requestExamples: [{ name: 'Reconcile', description: 'Refresh current GitHub state.', method: 'POST', body: {} }],
    responseExamples: [
      { status: 200, description: 'Reconciliation completed.', body: { ok: true, repository: 'lopugit/thingtime', touched: 72 } },
			{
				status: 502,
				description: 'GitHub could not be queried.',
				body: { ok: false, error: 'GitHub reconciliation failed. Existing dashboard history was preserved.' }
			}
    ]
  }),
  endpoint({
    id: 'github-ci-webhook',
    group: 'integrations',
    title: 'GitHub CI webhook',
    endpoint: '/api/v1/integrations/github/webhook',
    summary: 'Receive signed GitHub App events for the CI control plane.',
    detail:
      'Validates X-Hub-Signature-256 against the raw body with a constant-time HMAC-SHA256 comparison, rejects oversized payloads, allowlists the configured repository, and projects only bounded operational fields into protected Things.',
    auth: { mode: 'none', description: 'Public transport endpoint; every request requires a valid GitHub webhook signature.' },
    methods: ['POST'],
		steps: [
			'Configure the GitHub App webhook secret.',
			'Subscribe only to the required repository, PR, workflow, check, deployment, push, create, and delete events.',
			'POSTs are idempotent by X-GitHub-Delivery.'
		],
		requestExamples: [
			{
				name: 'Signed GitHub delivery',
				description: 'Sent by GitHub App webhooks with signature and delivery headers.',
				method: 'POST',
				body: { action: 'synchronize', repository: { full_name: 'lopugit/thingtime' } }
			}
		],
    responseExamples: [
      { status: 202, description: 'Verified event accepted.', body: { ok: true, accepted: true, touched: ['ci-example'] } },
      { status: 403, description: 'Signature mismatch.', body: { ok: false, error: 'Invalid webhook signature' } }
    ]
  }),
  endpoint({
    id: 'vercel-ci-webhook',
    group: 'integrations',
    title: 'Vercel deployment webhook',
    endpoint: '/api/v1/integrations/vercel/webhook',
    summary: 'Receive signed Vercel deployment and preview status events.',
    detail:
      'Validates x-vercel-signature with a constant-time HMAC-SHA1 comparison over the raw body, then stores deployment and preview projections plus relational history Things. The webhook secret is never returned by any API.',
    auth: { mode: 'none', description: 'Public transport endpoint; every request requires a valid Vercel signature.' },
    methods: ['POST'],
		steps: [
			'Create a project-scoped Vercel webhook.',
			'Subscribe to deployment.created, deployment.ready, deployment.error, deployment.canceled, and deployment.deleted.',
			'Store the one-time webhook secret in THINGTIME_VERCEL_WEBHOOK_SECRET.'
		],
		requestExamples: [
			{
				name: 'Signed Vercel delivery',
				description: 'Sent by Vercel with x-vercel-signature.',
				method: 'POST',
				body: { type: 'deployment.ready', payload: { deployment: { id: 'dpl_example', url: 'preview.example.app' } } }
			}
		],
    responseExamples: [
			{
				status: 202,
				description: 'Verified deployment event accepted.',
				body: { ok: true, accepted: true, touched: ['ci-deployment', 'ci-preview'] }
			},
      { status: 403, description: 'Signature mismatch.', body: { ok: false, error: 'Invalid webhook signature' } }
    ]
  }),
  endpoint({
    id: 'admin-integrations',
    group: 'admin',
    title: 'Admin integration vault and proxy',
    endpoint: '/api/v1/admin/integrations',
    summary: 'Manage write-only encrypted external credentials and endpoint read/write policies (admin only).',
    detail:
      'Stores external credentials as AES-256-GCM ciphertext using THINGTIME_ADMIN_VAULT_KEY. GET returns only metadata, endpoint policy, and redacted audit rows—never a credential value. The proxy accepts a saved endpoint id, not an arbitrary upstream URL. It enforces HTTPS origin/path allowlists, selected read/create-only/full-write permissions, request/response byte bounds, redirects disabled, and a fail-closed rate limit. Vercel create-only environment-variable writes check the remote project env list before POST; they never use PATCH/upsert. Generic create-only endpoints are refused rather than simulated unsafely.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      'Provision THINGTIME_ADMIN_VAULT_KEY as a distinct 32-byte base64url server secret. Do not reuse JWT, session, peer, or cron secrets.',
      'POST action:create-secret with a label and value. The value is write-only and never appears in a later response.',
      'POST action:save-endpoint with a saved secret id, provider, HTTPS origin, closed path prefixes, and read/write policy.',
      'POST action:proxy with endpointId, operation, path, and a bounded JSON body. Only the Vercel adapter supports create-only writes.'
    ],
    requestExamples: [
      {
        name: 'Create write-only credential',
        description: 'Value is encrypted server-side and omitted from every response.',
        method: 'POST',
        body: { action: 'create-secret', label: 'Vercel project token', value: '<write-only-token>' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Vault metadata; no encrypted fields or credential values are exposed.',
        body: {
          ok: true,
          vaultConfigured: true,
          secrets: [{ id: 'secret_example', label: 'Vercel project token' }],
          endpoints: [{ id: 'endpoint_example', writeMode: 'create-only' }]
        }
      },
      { status: 403, description: 'Not an admin.', body: { ok: false, error: 'Admins only' } }
    ]
  }),
  endpoint({
    id: 'admin-rate-limits',
    group: 'admin',
    title: 'Rate-limit config',
    endpoint: '/api/v1/admin/rate-limits',
    summary: 'Read or update the global per-endpoint rate limits (admin only).',
    detail:
      'Admins configure how often each throttled endpoint (e.g. things.react, things.comment) can be called per user. GET returns the current merged config plus the endpoint list + defaults; POST { endpoints: { <name>: { limit, windowMs, enabled } } } updates it. Unknown endpoints are ignored and values clamped server-side.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      'GET to load the current config, endpoint names, and defaults.',
      'POST endpoints with limit (per window), windowMs, and enabled to change a limit.',
      'Non-admins receive 403; anonymous callers 401.',
      'Changes take effect within seconds (the limiter caches config briefly).'
    ],
    requestExamples: [
      { name: 'Read config', description: 'Load the current rate limits.', method: 'GET' },
      {
        name: 'Update react limit',
        description: 'Allow 30 reactions per minute.',
        method: 'POST',
        body: { endpoints: { 'things.react': { limit: 30, windowMs: 60000, enabled: true } } }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Current config.',
        body: {
          ok: true,
          config: { 'things.react': { limit: 60, windowMs: 60000, enabled: true } },
          endpoints: ['things.react', 'things.comment'],
          defaults: { 'things.react': { limit: 60, windowMs: 60000, enabled: true } }
        }
      },
      { status: 403, description: 'Not an admin.', body: { ok: false, error: 'Admins only' } }
    ]
  }),
  endpoint({
    id: 'admin-users',
    group: 'admin',
    title: 'Admin user lookup',
    endpoint: '/api/v1/admin/users',
    summary: 'List current admins and search users to promote/demote (admin only).',
    detail:
      'Returns a newest-first bounded snapshot of current DB-flagged admins; limit and totalCapped describe that snapshot. With ?q=<query> it also returns matching users (by username/email) so an admin can promote or demote them. Env-allowlist admins are marked envAdmin and cannot be demoted from the UI.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET'],
    steps: [
      'GET with credentials to list current admins.',
      'Add ?q=<username or email> to search users to manage.',
      'Use POST /api/v1/admin/set-admin with a returned user id to change their admin flag.',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      { name: 'List admins', description: 'Current admins only.', method: 'GET' },
      { name: 'Search users', description: 'Find users to promote.', method: 'GET', query: { q: 'lopu' } }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Admins + search results.',
        body: {
          ok: true,
          admins: [{ id: '64f000000000000000000001', username: 'lopu', isAdmin: true, envAdmin: true }],
          limit: 200,
          totalCapped: false,
          results: [{ id: '64f000000000000000000002', username: 'nik', isAdmin: false, envAdmin: false }]
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-users-overview',
    group: 'admin',
    title: 'Admin users overview',
    endpoint: '/api/v1/admin/users/overview',
    summary: 'The /admin Users tab: users with subscription tier, quotas, storage usage, and app/token counts (admin only).',
    detail:
      'Enriches the admin user search with everything the management dashboard shows per user: subscription ' +
			'(tier, admin overrides, effective quotas, metered flag), canonical account storage (allowance, exact ' +
			'logical bytes used, remaining/overage, accounting status/version/reconciliation time), and the exact ' +
			'app-namespace subset of that same total, plus counts (registered apps, co-managed apps, owned accounts, PATs, ' +
      'connected apps with a live grant). ?q= searches by username/email; limit selects a bounded 1–200 row ' +
      'keyset page (default 20). When nextCursor is non-null, pass it back unchanged with the same q to continue. ' +
			'totalCapped remains an alias for whether another page exists. Flat used-byte aliases and appNamespaceBytes ' +
			'are null until the canonical account ledger is ready; storage.status is the authoritative readiness signal.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET'],
    steps: [
      'GET with credentials (optionally ?q=<username or email>&limit=<1-200>&cursor=<nextCursor>).',
      'Each row carries subscription.effective — the quotas actually enforced for that user.',
      'Change a tier or overrides via POST /api/v1/admin/subscriptions.',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      { name: 'Admin snapshot', description: 'Up to 200 newest overview rows.', method: 'GET', query: { limit: 200 } },
      { name: 'Search', description: 'Overview rows matching a query.', method: 'GET', query: { q: 'nik' } },
      { name: 'Continue', description: 'Continue the same stable keyset scan.', method: 'GET', query: { limit: 200, cursor: '<nextCursor>' } }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Overview rows.',
        body: {
          ok: true,
          users: [
            {
              id: '64f000000000000000000002',
              username: 'nik',
              createdAt: '2026-08-05T00:00:00.000Z',
              isAdmin: false,
              accountKind: 'user',
							storage: {
								usedBytes: 1048576,
								allowanceBytes: 524288000,
								remainingBytes: 523239424,
								overageBytes: 0,
								status: 'ready',
								accountingVersion: 1,
								reconciledAt: '2026-08-05T00:00:00.000Z'
							},
							storageAllowanceBytes: 524288000,
							storageUsedBytes: 1048576,
              appNamespaceBytes: 1048576,
              subscription: {
                tier: 'free',
                isDefault: true,
                overrides: null,
                effective: { appStorageBytes: 52428800, maxApps: 20, maxPats: 200, userStorageBytes: 524288000 }
              },
              counts: { apps: 2, linkedApps: 1, ownedAccounts: 0, pats: 3, connectedApps: 4 }
            }
          ],
          limit: 200,
          totalCapped: false,
          nextCursor: null
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-apps',
    group: 'admin',
    title: 'Admin apps overview',
    endpoint: '/api/v1/admin/apps',
    summary: 'Every registered app with owner, managers, user count, storage usage, tier, and suspension state (admin only).',
    detail:
      'The /admin Apps tab: all apps across all users (newest first, ?q= filters by name/clientId). Each row ' +
      'carries the registering owner, any co-managers assigned via account-links, the count of distinct users ' +
      'holding a live grant, the summed (user, app) namespace storage, the app-level subscription (isDefault ' +
      "true = budgets fall through to each end user's tier), and revokedAt when suspended. limit selects a " +
      'bounded 1–200 row keyset page (default 100). Pass a non-null nextCursor back unchanged with the same q; ' +
      'totalCapped remains an alias for whether another page exists.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET'],
    steps: [
      'GET with credentials (optionally ?q=<name or clientId>&limit=<1-200>&cursor=<nextCursor>).',
      'Suspend or restore an app via POST /api/v1/admin/apps/revoke.',
      'Assign co-managers via POST /api/v1/admin/links with linkKind "app".',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      { name: 'Admin snapshot', description: 'Up to 200 newest apps.', method: 'GET', query: { limit: 200 } },
      { name: 'Search', description: 'Filter by name or clientId.', method: 'GET', query: { q: 'rainbow' } },
      { name: 'Continue', description: 'Continue the same stable keyset scan.', method: 'GET', query: { limit: 200, cursor: '<nextCursor>' } }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'App rows.',
        body: {
          ok: true,
          apps: [
            {
              clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
              name: 'Rainbow Notes',
              origins: ['https://rainbownotes.example'],
              createdAt: '2026-08-05T00:00:00.000Z',
              revokedAt: null,
              owner: { id: '64f000000000000000000002', username: 'nik' },
              managers: [{ id: '64f000000000000000000003', username: 'lopu' }],
              userCount: 12,
              usedBytes: 3145728,
              subscription: { tier: 'free', isDefault: true }
            }
          ],
          limit: 200,
          totalCapped: false,
          nextCursor: null
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-apps-revoke',
    group: 'admin',
    title: 'Suspend / restore an app',
    endpoint: '/api/v1/admin/apps/revoke',
    summary: "Revoke an app's access platform-wide, or restore it (admin only).",
    detail:
      'POST { clientId, revoked: true } stamps crystal.revokedAt on the app, sweeps every live app session, ' +
      'and the token choke point (resolveAppToken) refuses anything the sweep missed — the consent screen and ' +
      '/oauth/authorize also refuse while suspended. { revoked: false } lifts the suspension; swept sessions ' +
      'are NOT resurrected (users simply re-authorize). This is the platform-level kill switch; end users ' +
      'revoke their own grants via /api/v1/oauth/grants/revoke.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
    steps: [
      'POST { clientId, revoked: true } to suspend (tokens die immediately).',
      'POST { clientId, revoked: false } to restore.',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      {
        name: 'Suspend',
        description: 'Kill every token the app holds.',
        method: 'POST',
        body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', revoked: true }
      },
      {
        name: 'Restore',
        description: 'Lift the suspension.',
        method: 'POST',
        body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', revoked: false }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Updated app.',
        body: {
          ok: true,
          app: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', name: 'Rainbow Notes', revokedAt: '2026-08-02T00:00:00.000Z' }
        }
      },
      { status: 404, description: 'Unknown clientId.', body: { ok: false, error: 'App not found' } }
    ]
  }),
  endpoint({
    id: 'admin-subscriptions',
    group: 'admin',
    title: 'Subscription tiers & quota overrides',
    endpoint: '/api/v1/admin/subscriptions',
    summary: 'Assign an exact live tier revision or custom quota overrides to a user or app (admin only).',
    detail:
      'Every assignment stores the stable tier id, immutable versionId/version, name, metering flag, and quota ' +
      'snapshot. Publishing a replacement can therefore archive the old revision without changing existing ' +
      'users or apps. Per-field admin overrides win over the snapshot (explicit null = unlimited). GET without ' +
      "params returns live revisions; with ?subjectType=user|app&subjectId= it also returns that subject's " +
      'assignment and its archived current revision when needed. POST { subjectType, subjectId, tier, ' +
      'tierVersionId, overrides?, note? } assigns; clear pins the current default revision.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      "GET to load the tier catalog (and one subject's assignment with ?subjectType&subjectId).",
      'POST { subjectType, subjectId, tier, tierVersionId } to assign an exact live revision.',
      'Use userStorageBytes/maxApps/maxPats overrides for users or appStorageBytes for apps; null means unlimited.',
      'POST { subjectType, subjectId, clear: true } to pin the current live default revision.',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      { name: 'Catalog', description: 'All tiers with their default quotas.', method: 'GET' },
      {
        name: 'Look up a user',
        description: "One subject's assignment.",
        method: 'GET',
        query: { subjectType: 'user', subjectId: '64f000000000000000000002' }
      },
      {
        name: 'Assign pro + override',
        description: 'Pro tier v1 with a custom 2 GiB user-storage override.',
        method: 'POST',
        body: {
          subjectType: 'user',
          subjectId: '64f000000000000000000002',
          tier: 'pro',
          tierVersionId: 'subscription-tier-pro-v1',
          overrides: { userStorageBytes: 2147483648 },
          note: 'Beta partner'
        }
      },
      {
        name: 'Reset',
        description: 'Back to implicit free.',
        method: 'POST',
        body: { subjectType: 'user', subjectId: '64f000000000000000000002', clear: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Assignment + catalog.',
        body: {
          ok: true,
          subscription: {
            subjectType: 'user',
            subjectId: '64f000000000000000000002',
            tier: 'pro',
            tierVersionId: 'subscription-tier-pro-v1',
            tierVersion: 1,
            tierName: 'Pro',
            metered: false,
            overrides: { userStorageBytes: 2147483648 },
            effective: { appStorageBytes: 107374182400, userStorageBytes: 2147483648, maxApps: 100, maxPats: 1000 },
            isDefault: false
          }
        }
      },
      {
        status: 400,
        description: 'Unknown or non-live revision.',
        body: { ok: false, error: 'Unknown or non-live tier revision: gold — refresh the catalog at /api/v1/tiers' }
      }
    ]
  }),
  endpoint({
    id: 'admin-tiers',
    group: 'admin',
    title: 'Manage subscription tiers',
    endpoint: '/api/v1/admin/tiers',
    summary: 'Create, edit, publish, and archive versioned subscription-tier revisions (admin only).',
    detail:
      'GET returns every protected subscription-tier Thing grouped into live, drafts, and archived. New tiers ' +
      'start as draft v1. Only drafts can be edited; create-version clones a live or archived revision into the ' +
      'next draft. Publish uses a per-tier lease and durable recovery journal to archive the previous live ' +
      'revision and promote the draft; readers keep the prior revision available during that cross-document ' +
      'handoff. Prices are integer ' +
      'minor units for daily/weekly/monthly/yearly renewal options. The six percentage-saved comparisons are ' +
      'saved from the annualized formula unless a custom override is supplied. Inclusions are bounded Editor.js ' +
      'blocks rendered on the customer card. Archiving never deletes history, and the live default tier can only ' +
      'be replaced by publishing a new revision.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      'GET to load the Live, Draft / not live, and Archived sections.',
      'POST action create with tier content to create a new stable tier id and draft v1.',
      'POST action update-draft with versionId and tier content to edit a draft.',
      'POST action create-version with versionId to clone the next draft revision.',
      'POST action publish or archive with versionId to change catalog visibility without deleting history.'
    ],
    requestExamples: [
      { name: 'Catalog history', description: 'All tier revisions grouped by lifecycle status.', method: 'GET' },
      {
        name: 'Create a draft',
        description: 'Create an editable tier with pricing, discount rules, Editor.js inclusions, and quota defaults.',
        method: 'POST',
        body: {
          action: 'create',
          tier: {
            title: 'Studio',
            tagline: 'For growing creative teams.',
            emoji: '🎨',
            bannerImageUrl: 'https://images.example/studio.jpg',
            sortOrder: 40,
            metered: false,
            currency: 'USD',
            prices: { daily: 300, weekly: 1800, monthly: 5900, yearly: 59000 },
            discountOverrides: { yearlyFromMonthly: 20 },
            inclusions: { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Priority support' } }] },
            quotas: { appStorageBytes: 107374182400, userStorageBytes: 21474836480, maxApps: 100, maxPats: 1000 }
          }
        }
      },
      {
        name: 'Publish a draft',
        description: 'Make one immutable revision available to new assignments.',
        method: 'POST',
        body: { action: 'publish', versionId: 'subscription-tier-studio-a1b2c3d4-v1' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Grouped catalog and the changed tier.',
        body: {
          ok: true,
          tier: { id: 'studio-a1b2c3d4', versionId: 'subscription-tier-studio-a1b2c3d4-v1', version: 1, status: 'draft', title: 'Studio' },
          tiers: [
            { id: 'free', versionId: 'subscription-tier-free-v1', version: 1, status: 'live', title: 'Free' },
            { id: 'plus', versionId: 'subscription-tier-plus-v1', version: 1, status: 'live', title: 'Plus' },
            { id: 'pro', versionId: 'subscription-tier-pro-v1', version: 1, status: 'live', title: 'Pro' },
            { id: 'payg', versionId: 'subscription-tier-payg-v1', version: 1, status: 'live', title: 'Pay as you go' },
            { id: 'studio-a1b2c3d4', versionId: 'subscription-tier-studio-a1b2c3d4-v1', version: 1, status: 'draft', title: 'Studio' }
          ],
          live: [
            { id: 'free', versionId: 'subscription-tier-free-v1', version: 1, status: 'live', title: 'Free' },
            { id: 'plus', versionId: 'subscription-tier-plus-v1', version: 1, status: 'live', title: 'Plus' },
            { id: 'pro', versionId: 'subscription-tier-pro-v1', version: 1, status: 'live', title: 'Pro' },
            { id: 'payg', versionId: 'subscription-tier-payg-v1', version: 1, status: 'live', title: 'Pay as you go' }
          ],
					drafts: [{ id: 'studio-a1b2c3d4', versionId: 'subscription-tier-studio-a1b2c3d4-v1', version: 1, status: 'draft', title: 'Studio' }],
          archived: []
        }
      },
      { status: 409, description: 'Lifecycle conflict.', body: { ok: false, error: 'Only draft tier versions can be edited' } }
    ]
  }),
  endpoint({
    id: 'tiers',
    group: 'subscriptions',
    title: 'Live subscription tiers',
    endpoint: '/api/v1/tiers',
    summary: 'List the live, selectable tier-card revisions with pricing and inclusions.',
    detail:
      'Public read-only catalog. Each item includes a stable id, immutable versionId/version, name, tagline, ' +
      'optional banner image, daily/weekly/monthly/yearly minor-unit prices, six computed-or-custom discounts, ' +
      'Editor.js inclusions, and quota defaults. Draft and archived revisions are excluded.',
    auth: { mode: 'none', description: 'Public catalog; no credentials required.' },
    methods: ['GET'],
    steps: ['GET and render each returned live revision as a tier option.'],
    requestExamples: [{ name: 'Live catalog', description: 'All tiers selectable by a new customer.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Live tier revisions.',
        body: {
          ok: true,
          tiers: [
            {
              id: 'pro',
              versionId: 'subscription-tier-pro-v2',
              version: 2,
              status: 'live',
              title: 'Pro',
              prices: { daily: 300, weekly: 1800, monthly: 5900, yearly: 59000 },
              discounts: { yearlyFromDaily: 46.12, yearlyFromWeekly: 36.97, yearlyFromMonthly: 16.67 }
            }
          ]
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-links',
    group: 'admin',
    title: 'Account & app ownership links',
    endpoint: '/api/v1/admin/links',
    summary: 'Assign accounts and apps to owner accounts, many-to-many (admin only).',
    detail:
      'Ownership links let one login manage many identities: linkKind "account" gives a user owner access to ' +
      'another (usually service) account — it appears under "Owned accounts" in their switcher and can be ' +
      'assumed without credentials; linkKind "app" makes them a co-manager of a registered app (it appears in ' +
      'their /apps and update/delete accept them). Both directions are many-to-many: any number of owners per ' +
      'target, any number of targets per owner. GET lists by ?userId= or ?targetId= (+optional &linkKind=); ' +
      'POST { action: "add"|"remove", linkKind, userId, targetId } assigns or unassigns.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      "GET ?userId=<id> for the links a user holds, or ?targetId=<id|clientId> for a target's owners.",
      'POST { action: "add", linkKind: "account", userId, targetId } to hand a user an account.',
      'POST { action: "add", linkKind: "app", userId, targetId: "<clientId>" } to add an app co-manager.',
      'POST { action: "remove", ... } to unassign.',
      'Non-admins receive 403; anonymous callers 401.'
    ],
    requestExamples: [
      { name: 'Links a user holds', description: 'Everything assigned to one user.', method: 'GET', query: { userId: '64f000000000000000000002' } },
      {
        name: 'Assign a service account',
        description: 'nik can now sign into the bot account.',
        method: 'POST',
        body: { action: 'add', linkKind: 'account', userId: '64f000000000000000000002', targetId: '64f000000000000000000009' }
      },
      {
        name: 'Unassign an app',
        description: 'Remove a co-manager.',
        method: 'POST',
        body: { action: 'remove', linkKind: 'app', userId: '64f000000000000000000002', targetId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Decorated links.',
        body: {
          ok: true,
          links: [
            {
              linkKind: 'account',
              userId: '64f000000000000000000002',
              targetId: '64f000000000000000000009',
              role: 'owner',
              username: 'nik',
              targetUsername: 'nik-bot'
            }
          ]
        }
      },
      { status: 404, description: 'Unknown target.', body: { ok: false, error: 'Target account not found' } }
    ]
  }),
  endpoint({
    id: 'auth-accounts-owned',
    group: 'auth',
    title: 'Owned accounts',
    endpoint: '/api/v1/auth/accounts/owned',
    summary: 'The accounts you own via admin-assigned links — each can be signed into without credentials.',
    detail:
      'Lists the accounts (usually service accounts) an admin has assigned to you with an "account" ownership ' +
      'link. The account switcher shows these under "Owned accounts"; POST /api/v1/auth/accounts/assume signs ' +
      "into one. Unlike /api/v1/auth/accounts (this browser's roster), this list follows your links — it is " +
      'the same on every device.',
    auth: { mode: 'session', description: 'Requires a signed-in session.' },
    methods: ['GET'],
    steps: [
      'GET with credentials.',
      'Render the returned accounts in the switcher\'s "Owned accounts" section.',
      'POST /api/v1/auth/accounts/assume { accountId } to sign into one.'
    ],
    requestExamples: [{ name: 'List owned accounts', description: 'Accounts assigned to you.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Owned accounts.',
        body: { ok: true, accounts: [{ id: '64f000000000000000000009', username: 'nik-bot', displayName: 'Nik Bot', accountKind: 'service' }] }
      },
      { status: 401, description: 'Not signed in.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'auth-accounts-assume',
    group: 'auth',
    title: 'Assume an owned account',
    endpoint: '/api/v1/auth/accounts/assume',
    summary: 'Sign into an account you own (via an admin-assigned link) without its credentials.',
    detail:
      'POST { accountId } — if you hold an "account" ownership link to it, a fresh browser session is minted ' +
      "for the target, folded into this browser's roster (the switcher lists it immediately), and made the " +
      "active account. The authorization is the server-side link, never the roster cookie, so the roster's " +
      'anti-fixation ownership gate stays intact. Each browser gets its own session — assuming the same ' +
      'account elsewhere never signs this one out.',
    auth: { mode: 'session', description: 'Requires a signed-in session holding the ownership link.' },
    methods: ['POST'],
    steps: [
      'GET /api/v1/auth/accounts/owned to find assumable accounts.',
      'POST { accountId } — the response sets tt_auth + tt_accounts cookies.',
      'The assumed account is now active; switch back via /api/v1/auth/accounts/switch.'
    ],
    requestExamples: [
      { name: 'Assume', description: 'Sign into an owned service account.', method: 'POST', body: { accountId: '64f000000000000000000009' } }
    ],
    responseExamples: [
      { status: 200, description: 'Now active.', body: { ok: true, user: { id: '64f000000000000000000009', username: 'nik-bot' } } },
      { status: 403, description: 'No ownership link.', body: { ok: false, error: 'You are not an owner of that account' } }
    ]
  }),
  endpoint({
    id: 'auth-account-hints',
    contractVersion: '1.0.1',
    group: 'auth',
    title: 'Cross-deployment account hints',
    endpoint: '/api/v1/auth/account-hints',
    summary: 'Accounts this browser is signed into on other Thingtime deployments, for the auto-login popup.',
    detail:
      'Every sign-in writes a { rosterId, origin } pointer into the Domain=.thingtime.com tt_hints cookie, ' +
      'so production, dev, and preview deployments share it. This endpoint resolves those pointers LIVE ' +
      'through the same roster + session chokepoints as the account switcher: a hint exists exactly while ' +
      'its session on the other deployment is live, and dead pointers are pruned (the cookie is rewritten). ' +
      'Responses carry only public profile hints (username, display name, avatar) — never emails, session ' +
      'ids, or tokens — and picking a suggestion still requires that account\'s password or passkey. ' +
      'Same-origin only: no CORS headers, so no cross-site page can read a browser\'s suggestions. Every response is ' +
      'Cache-Control: private, no-store and Vary: Cookie, so a shared intermediary cannot retain another browser\'s hints.',
    auth: { mode: 'none', description: 'Cookie-driven; works signed out (that is its point).' },
    methods: ['GET'],
    steps: [
      'GET with credentials (the browser sends tt_hints automatically).',
      'Render hints as "continue as" suggestions; each lists the deployments (origins) it was seen on.',
      'On pick, prefill the username for password login or call the passkey login ceremony.',
      'Entries with alreadyHere:true are already in this origin\'s switcher — skip them in the popup.'
    ],
    requestExamples: [{ name: 'Fetch suggestions', description: 'Resolve this browser\'s cross-deployment hints.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'One live account found on another deployment.',
        headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
        body: {
          ok: true,
          hints: [
            {
              user: { id: '64f000000000000000000002', username: 'nik', displayName: 'Nik', avatarUrl: null },
              origins: [{ origin: 'https://thingtime.com', lastSeenAt: '2026-08-19T03:12:00.000Z' }],
              alreadyHere: false
            }
          ]
        }
      },
      { status: 200, description: 'No hints (cookie empty or every session ended).', body: { ok: true, hints: [] } }
    ]
  }),
  endpoint({
    id: 'auth-account-hints-resolve',
    contractVersion: '1.0.1',
    group: 'auth',
    title: 'Resolve own-origin hints (federated)',
    endpoint: '/api/v1/auth/account-hints/resolve',
    summary: 'This deployment vouches for the hint pointers ITS origin wrote — the federated half of auto-login.',
    detail:
      'Cross-origin, credentialed, CORS-restricted to the Thingtime family (and localhost dev). Another ' +
      'deployment\'s page calls this when its own /account-hints reported pointers it could not resolve ' +
      '(different database): the shared tt_hints cookie arrives on the same-site fetch, and THIS deployment ' +
      'resolves only the pointers its own origin wrote, through the same live roster/session chokepoints. ' +
      'Each environment answers only for its own sessions — the user\'s browser assembles the full picture; ' +
      'no deployment ever holds another\'s session state. Read-only: never prunes, never sets cookies. Every response is ' +
      'Cache-Control: private, no-store and Vary: Origin, Cookie.',
    auth: { mode: 'none', description: 'Cookie-driven; answers only for pointers this origin minted.' },
    methods: ['GET'],
    steps: [
      'GET /api/v1/auth/account-hints on your own origin first.',
      'For each origin in its `unresolved`, fetch that origin\'s /account-hints/resolve with credentials.',
      'Merge the returned hints (dedupe by user id) into the "continue as" list.'
    ],
    requestExamples: [{ name: 'Federated resolve', description: 'Asked by another deployment\'s page.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'This origin vouches for one live account.',
        headers: { 'Cache-Control': 'private, no-store', Vary: 'Origin, Cookie' },
        body: { ok: true, hints: [{ user: { id: '64f000000000000000000002', username: 'nik', displayName: 'Nik', avatarUrl: null }, origins: [{ origin: 'https://dev.thingtime.com', lastSeenAt: '2026-08-19T03:12:00.000Z' }], alreadyHere: false }] }
      },
      { status: 200, description: 'Nothing to vouch for.', body: { ok: true, hints: [] } }
    ]
  }),
  endpoint({
    id: 'auth-sso-handoff',
    group: 'auth',
    title: 'Mint a cross-origin sign-in code',
    endpoint: '/api/v1/auth/sso-handoff',
    summary: 'A signed-in Thingtime surface mints a short-lived, origin-bound, single-use code for another deployment.',
    detail:
      'POST { origin } — for Thingtime deployments OUTSIDE the *.thingtime.com cookie family (immutable ' +
      '*.vercel.app previews, custom domains). The code is a 2-minute purpose-fenced JWT bound to the target ' +
      'origin (aud), backed by a pre-minted browser session that self-expires if never claimed. The target ' +
      'page redeems it at ITS OWN /api/v1/auth/sso-session. Origins stay default-open (owner decision) — ' +
      'security is the per-code binding, TTL, and single use. Used by the /authorize?self=1 popup and the ' +
      'FedCM assertion endpoint.',
    auth: { mode: 'session', description: 'Requires a signed-in session (app tokens are rejected).' },
    methods: ['POST'],
    steps: [
      'POST { origin: "https://<target-origin>" } from a signed-in first-party surface.',
      'Deliver the code to the target page (postMessage from the popup, or the FedCM token).',
      'The target page POSTs it to its own /api/v1/auth/sso-session within 2 minutes.'
    ],
    requestExamples: [
      { name: 'Mint for a preview', description: 'Sign into an immutable preview deployment.', method: 'POST', body: { origin: 'https://thingtime-abc123-lopugits-projects.vercel.app' } }
    ],
    responseExamples: [
      { status: 200, description: 'Code minted.', body: { ok: true, code: 'eyJhbGciOi…', aud: 'https://thingtime-abc123-lopugits-projects.vercel.app', expiresAt: '2026-08-19T05:02:00.000Z' } },
      { status: 401, description: 'Not signed in.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'auth-sso-session',
    group: 'auth',
    title: 'Redeem a sign-in code',
    endpoint: '/api/v1/auth/sso-session',
    summary: 'Exchange a handoff code for a first-class session on THIS deployment.',
    detail:
      'POST { code } — verifies the signature (deployments share JWT key material), requires the code\'s aud ' +
      'to equal this deployment\'s public origin, claims it atomically exactly once (a second redemption ' +
      'revokes the session — theft signal), then runs the exact password-login tail: httpOnly auth cookie, ' +
      'switcher roster merge, cross-deployment hint pointer. Redemption only succeeds where this deployment ' +
      'shares the minting environment\'s database (an immutable preview and its alias twin do) — anything ' +
      'else fails closed with a generic error.',
    auth: { mode: 'none', description: 'The code is the credential.' },
    methods: ['POST'],
    steps: [
      'Receive a code from the /authorize?self=1 popup (postMessage) or a FedCM assertion.',
      'POST { code } to THIS deployment within 2 minutes.',
      'On 200 the session cookies are set — treat it like a successful /api/v1/login.'
    ],
    requestExamples: [{ name: 'Redeem', description: 'Become a session here.', method: 'POST', body: { code: 'eyJhbGciOi…' } }],
    responseExamples: [
      { status: 200, description: 'Signed in.', body: { ok: true, user: { id: '64f000000000000000000002', username: 'nik' } } },
      { status: 403, description: 'Code bound to a different origin.', body: { ok: false, error: 'This sign-in link belongs to a different site' } },
      { status: 401, description: 'Expired, replayed, or different environment.', body: { ok: false, error: 'This sign-in link is no longer valid — try again' } }
    ]
  }),
  endpoint({
    id: 'fedcm-config',
    group: 'auth',
    title: 'FedCM provider config',
    endpoint: '/api/v1/fedcm/config',
    summary: 'The FedCM identity-provider manifest — where the browser finds the accounts and assertion endpoints.',
    detail:
      'Discovered via /.well-known/web-identity at the domain root. Any page can pass this URL as configURL ' +
      'to navigator.credentials.get({ identity }) and the BROWSER — never the page — fetches the accounts ' +
      'list with the user\'s first-party Thingtime cookies and renders its native "Continue as …" sheet. ' +
      'Pure metadata; endpoints are absolute URLs on this deployment.',
    auth: { mode: 'none', description: 'Public metadata.' },
    methods: ['GET'],
    steps: [
      'Reference it as configURL in navigator.credentials.get({ identity: { providers: [...] } }).',
      'Use clientId "thingtime-self" for Thingtime deployments (session handoff) or a ttapp_… clientId (app token).',
      'Redeem the returned token: sso-session for handoff codes, Bearer for app tokens.'
    ],
    requestExamples: [{ name: 'Fetch config', description: 'Browser loads the manifest.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Provider manifest.',
        body: {
          accounts_endpoint: 'https://thingtime.com/api/v1/fedcm/accounts',
          client_metadata_endpoint: 'https://thingtime.com/api/v1/fedcm/client-metadata',
          id_assertion_endpoint: 'https://thingtime.com/api/v1/fedcm/assertion',
          login_url: 'https://thingtime.com/login',
          branding: { name: 'Thingtime', background_color: '#16161a', color: '#ffffff' }
        }
      }
    ]
  }),
  endpoint({
    id: 'fedcm-accounts',
    group: 'auth',
    title: 'FedCM accounts',
    endpoint: '/api/v1/fedcm/accounts',
    summary: 'The signed-in accounts behind the browser\'s native "Continue as …" sheet.',
    detail:
      'Browser-mediated only: requires Sec-Fetch-Dest: webidentity (page JS can never set Sec-Fetch-*), so ' +
      'no embedding page can read it — the browser fetches with first-party cookies and draws the sheet ' +
      'itself. The list is this browser\'s own switcher roster (resolveRoster, ownership-gated), never a ' +
      'central registry: only sessions this roster owns can later be redeemed by an assertion. Returns 401 ' +
      'with an empty list when signed out.',
    auth: { mode: 'none', description: 'First-party cookies via the browser\'s FedCM fetch.' },
    methods: ['GET'],
    steps: [
      'Never call this from page JS — the browser does, during navigator.credentials.get({ identity }).',
      'Sign into thingtime.com first; the sheet lists the roster accounts.',
      'Direct (non-FedCM) requests are refused with 400.'
    ],
    requestExamples: [{ name: 'Browser fetch', description: 'Sent by the FedCM machinery.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Roster accounts.',
        body: { accounts: [{ id: '64f000000000000000000002', name: 'Nik', email: 'nik@example.com', picture: 'https://…/avatar.png' }] }
      },
      { status: 400, description: 'Not a FedCM fetch.', body: { ok: false, error: 'FedCM requests only' } }
    ]
  }),
  endpoint({
    id: 'fedcm-client-metadata',
    group: 'auth',
    title: 'FedCM client metadata',
    endpoint: '/api/v1/fedcm/client-metadata',
    summary: 'Policy links the browser shows alongside the FedCM consent sheet.',
    detail: 'Standard FedCM metadata endpoint; Thingtime\'s own pages and registered apps share the platform policies.',
    auth: { mode: 'none', description: 'Public metadata.' },
    methods: ['GET'],
    steps: ['Never call directly — the browser fetches it during the FedCM ceremony.'],
    requestExamples: [{ name: 'Browser fetch', description: 'Sent by the FedCM machinery.', method: 'GET', query: { client_id: 'thingtime-self' } }],
    responseExamples: [
      { status: 200, description: 'Policy links.', body: { privacy_policy_url: 'https://thingtime.com/', terms_of_service_url: 'https://thingtime.com/' } }
    ]
  }),
  endpoint({
    id: 'fedcm-assertion',
    group: 'auth',
    title: 'FedCM assertion',
    endpoint: '/api/v1/fedcm/assertion',
    summary: 'The browser exchanges the user\'s sheet pick for a token: a session-handoff code or an app token.',
    detail:
      'Browser-mediated only (Sec-Fetch-Dest: webidentity), form-encoded { client_id, account_id, nonce? } ' +
      'with the RP\'s Origin header. The picked account must belong to this browser\'s roster (re-checked ' +
      'server-side). client_id "thingtime-self" mints a 2-minute aud-bound single-use handoff code the RP ' +
      'redeems at its own /api/v1/auth/sso-session for a full session; a registered ttapp_… client gets the ' +
      'same app-scoped Bearer token the consent popup issues, baseline profile scope only (wider grants ' +
      'still require the consent popup). Errors use the FedCM { error: { code } } shape.',
    auth: { mode: 'none', description: 'First-party cookies via the browser\'s FedCM fetch; roster ownership enforced.' },
    methods: ['POST'],
    steps: [
      'Never call directly — the browser posts here after the user picks an account on the sheet.',
      'Thingtime-self RPs redeem the returned token at their own /api/v1/auth/sso-session.',
      'App RPs use the returned token as a Bearer credential, exactly like a consent-popup grant.'
    ],
    requestExamples: [
      { name: 'Browser assertion', description: 'Form-encoded by the FedCM machinery.', method: 'POST', body: { client_id: 'thingtime-self', account_id: '64f000000000000000000002' } }
    ],
    responseExamples: [
      { status: 200, description: 'Token minted.', body: { token: 'eyJhbGciOi…' } },
      { status: 401, description: 'Account not in this browser\'s roster.', body: { error: { code: 'unauthorized' } } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-list',
    group: 'auth',
    title: 'List passkeys',
    endpoint: '/api/v1/auth/passkeys',
    summary: 'The session user\'s passkeys: provider, dates, revocation state, and linked apps.',
    detail:
      'Each entry is safe metadata only (nickname, description, provider derived from the authenticator\'s ' +
      'AAGUID, created/last-used dates, backup state, transports, revokedAt) plus linkedApps — the origins ' +
      'and SSO apps the passkey has authenticated, with first/last-used timestamps and usage counts. ' +
      'Credential material (credential id, public key, counter) never leaves the server.',
    auth: { mode: 'session', description: 'Requires a signed-in session.' },
    methods: ['GET'],
    steps: [
      'GET with credentials.',
      'Render the list in Settings → Security; revoked entries stay listed until deleted.',
      'Offer rename/describe (POST /update), revoke (POST /revoke), and delete (POST /delete).'
    ],
    requestExamples: [{ name: 'List passkeys', description: 'All passkeys for the session user.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'One active passkey.',
        body: {
          ok: true,
          passkeys: [
            {
              id: 'a1b2c3d4-…',
              nickname: 'MacBook Touch ID',
              description: null,
              providerName: 'iCloud Keychain',
              aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
              deviceType: 'multiDevice',
              backedUp: true,
              transports: ['internal', 'hybrid'],
              createdAt: '2026-08-19T03:00:00.000Z',
              lastUsedAt: '2026-08-19T04:00:00.000Z',
              lastUsedOrigin: 'https://thingtime.com',
              revokedAt: null,
              linkedApps: [{ appKey: 'origin:https://thingtime.com', appName: 'thingtime.com', firstUsedAt: '2026-08-19T04:00:00.000Z', lastUsedAt: '2026-08-19T04:00:00.000Z', usageCount: 1 }]
            }
          ]
        }
      },
      { status: 401, description: 'Not signed in.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-register-options',
    group: 'auth',
    title: 'Start passkey registration',
    endpoint: '/api/v1/auth/passkeys/register-options',
    featureVersion: '1.0.1',
    summary: 'Password-confirmed WebAuthn creation options for adding a passkey to the session account.',
    detail:
      'POST { password } — re-confirms the current password (adding a passkey mints a durable credential), ' +
      'then returns navigator.credentials.create options and sets a signed 10-minute challenge cookie. ' +
      'Options request a DISCOVERABLE credential (residentKey required) with user verification required, matching ' +
      'the verification policy used when the response returns. Discoverability is what makes usernameless ' +
      'login and the browser\'s conditional-UI autofill (iCloud Keychain, 1Password) work. Existing ' +
      'credentials are excluded so the same authenticator can\'t double-register. The rpID is ' +
      'thingtime.com for every *.thingtime.com deployment, so one passkey works on production, dev, and ' +
      'previews alike.',
    auth: { mode: 'session', description: 'Requires a signed-in session; the body re-confirms the password.' },
    methods: ['POST'],
    steps: [
      'POST { password } with credentials.',
      'Pass the returned options to navigator.credentials.create (via @simplewebauthn/browser startRegistration).',
      'POST the attestation to /api/v1/auth/passkeys/register within 10 minutes.',
      'Wrong password → 403; 25-passkey cap → 409.'
    ],
    requestExamples: [{ name: 'Start registration', description: 'Confirm the password and mint options.', method: 'POST', body: { password: 'hunter22!' } }],
    responseExamples: [
      {
        status: 200,
        description: 'Creation options (challenge cookie set).',
        body: { ok: true, options: { challenge: 'sYm…', rp: { name: 'Thingtime', id: 'thingtime.com' }, user: { id: 'NjRm…', name: 'nik', displayName: 'Nik' }, authenticatorSelection: { residentKey: 'required', userVerification: 'required' } } }
      },
      { status: 403, description: 'Password mismatch.', body: { ok: false, error: 'Wrong password' } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-register',
    group: 'auth',
    title: 'Finish passkey registration',
    endpoint: '/api/v1/auth/passkeys/register',
    summary: 'Verify the attestation from the browser and store the new passkey.',
    detail:
      'POST { response, nickname?, description? } where response is the JSON result of ' +
      'navigator.credentials.create. Verified against the challenge cookie from /register-options ' +
      '(user verification required), then stored as a protected `passkey` thing: metadata in crystal, ' +
      'credential material in the secure blob, global credential-id uniqueness via uniqueKeys. The ' +
      'nickname defaults to the provider name derived from the authenticator\'s AAGUID (e.g. ' +
      '"1Password", "iCloud Keychain").',
    auth: { mode: 'session', description: 'Requires the same signed-in session that started the ceremony.' },
    methods: ['POST'],
    steps: [
      'Run startRegistration(options) in the browser (the platform sheet offers Save to iCloud Keychain / 1Password).',
      'POST { response, nickname?, description? } with credentials.',
      'Render the returned passkey in the manager; the challenge cookie is cleared.',
      'A credential registered anywhere on Thingtime already → 409.'
    ],
    requestExamples: [
      {
        name: 'Finish registration',
        description: 'Store the verified credential.',
        method: 'POST',
        body: { response: { id: 'B64URL…', rawId: 'B64URL…', type: 'public-key', response: { clientDataJSON: '…', attestationObject: '…' } }, nickname: 'MacBook Touch ID' }
      }
    ],
    responseExamples: [
      { status: 200, description: 'Passkey stored.', body: { ok: true, passkey: { id: 'a1b2c3d4-…', nickname: 'MacBook Touch ID', providerName: 'iCloud Keychain', revokedAt: null } } },
      { status: 400, description: 'Challenge expired.', body: { ok: false, error: 'This passkey setup expired — start again' } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-login-options',
    group: 'auth',
    title: 'Start passkey login',
    endpoint: '/api/v1/auth/passkeys/login-options',
    featureVersion: '1.0.1',
    summary: 'WebAuthn request options for a usernameless, discoverable-credential login.',
    detail:
      'POST (no body, no auth) — returns navigator.credentials.get options with EMPTY allowCredentials ' +
      'and sets a signed 10-minute challenge cookie. Empty allowCredentials means the authenticator lists ' +
      'whatever Thingtime passkeys it holds (no username, no enumeration surface). User verification is required ' +
      'in the browser because the assertion verifier requires it too. This is also the ' +
      'options payload for conditional-UI autofill: request it on login-form mount with ' +
      'mediation:"conditional" and Safari/Chrome surface the iCloud Keychain / 1Password passkey popup ' +
      'directly on the username field.',
    auth: { mode: 'none', description: 'Anonymous — this begins a login.' },
    methods: ['POST'],
    steps: [
      'POST once when the login surface mounts (conditional) or on "Sign in with a passkey" (modal).',
      'Pass options to startAuthentication (useBrowserAutofill for conditional UI).',
      'POST the assertion to /api/v1/auth/passkeys/login within 10 minutes.'
    ],
    requestExamples: [{ name: 'Mint options', description: 'Start a passkey login.', method: 'POST' }],
    responseExamples: [
      { status: 200, description: 'Request options (challenge cookie set).', body: { ok: true, options: { challenge: 'kJd…', rpId: 'thingtime.com', allowCredentials: [], userVerification: 'required' } } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-login',
    group: 'auth',
    title: 'Finish passkey login',
    endpoint: '/api/v1/auth/passkeys/login',
    summary: 'Verify a passkey assertion and sign in — cookies, switcher roster, and hints included.',
    detail:
      'POST { response, clientId? } where response is the JSON result of navigator.credentials.get. The ' +
      'credential is looked up by id, revocation is checked BEFORE any cryptography, the assertion is ' +
      'verified (user verification required) against the challenge cookie, and the login then finishes ' +
      'exactly like password login: httpOnly auth cookie, account merged into the switcher roster, ' +
      'cross-deployment hint updated. Passkeys bypass email-OTP 2FA by design (possession + on-device ' +
      'verification IS multi-factor). The optional clientId records which registered app the login served ' +
      'on the passkey\'s linkedApps. Sessions carry meta.method:"passkey" for auditability.',
    auth: { mode: 'none', description: 'Anonymous — the assertion is the credential.' },
    methods: ['POST'],
    steps: [
      'Run startAuthentication(options) in the browser.',
      'POST { response } with credentials; include clientId when the login serves an SSO/app flow.',
      'On 200 the session cookies are set — treat it like a successful /api/v1/login.',
      'Revoked or unknown credentials → 401 with a deliberately generic error.'
    ],
    requestExamples: [
      {
        name: 'Finish login',
        description: 'Present the assertion.',
        method: 'POST',
        body: { response: { id: 'B64URL…', rawId: 'B64URL…', type: 'public-key', response: { clientDataJSON: '…', authenticatorData: '…', signature: '…', userHandle: 'B64URL…' } } }
      }
    ],
    responseExamples: [
      { status: 200, description: 'Signed in.', body: { ok: true, user: { id: '64f000000000000000000002', username: 'nik' }, passkeyId: 'a1b2c3d4-…' } },
      { status: 401, description: 'Unknown, revoked, or unverifiable credential.', body: { ok: false, error: 'This passkey is not registered here' } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-update',
    group: 'auth',
    title: 'Rename / describe a passkey',
    endpoint: '/api/v1/auth/passkeys/update',
    summary: 'Update a passkey\'s nickname and/or description.',
    detail:
      'POST { id, nickname?, description? } — metadata only, so no password confirmation (nothing here ' +
      'changes what the credential can do). An empty description clears it; nicknames cannot be empty.',
    auth: { mode: 'session', description: 'Requires the passkey\'s owner session.' },
    methods: ['POST'],
    steps: ['POST { id, nickname?, description? } with credentials.', 'Render the returned passkey.'],
    requestExamples: [
      { name: 'Rename', description: 'Set a friendlier name.', method: 'POST', body: { id: 'a1b2c3d4-…', nickname: 'Work MacBook', description: 'Touch ID on the office laptop' } }
    ],
    responseExamples: [
      { status: 200, description: 'Updated.', body: { ok: true, passkey: { id: 'a1b2c3d4-…', nickname: 'Work MacBook' } } },
      { status: 404, description: 'Not yours / unknown id.', body: { ok: false, error: 'Passkey not found' } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-revoke',
    group: 'auth',
    title: 'Revoke a passkey',
    endpoint: '/api/v1/auth/passkeys/revoke',
    summary: 'Password-confirmed, immediate, permanent block on a passkey\'s ability to log in.',
    detail:
      'POST { id, password } — sets revokedAt; the login endpoint rejects revoked credentials before any ' +
      'signature work. The record stays listed (audit trail) until deleted via /delete. Password ' +
      'confirmation keeps a walk-up attacker with an unlocked session from silently disabling the ' +
      'owner\'s passkeys.',
    auth: { mode: 'session', description: 'Requires the passkey\'s owner session; the body re-confirms the password.' },
    methods: ['POST'],
    steps: [
      'POST { id, password } with credentials.',
      'The passkey shows as revoked in the manager immediately.',
      'Delete it via /api/v1/auth/passkeys/delete to free the authenticator for re-registration.'
    ],
    requestExamples: [{ name: 'Revoke', description: 'Block this passkey.', method: 'POST', body: { id: 'a1b2c3d4-…', password: 'hunter22!' } }],
    responseExamples: [
      { status: 200, description: 'Revoked.', body: { ok: true, passkey: { id: 'a1b2c3d4-…', revokedAt: '2026-08-19T05:00:00.000Z' } } },
      { status: 409, description: 'Already revoked.', body: { ok: false, error: 'This passkey is already revoked' } }
    ]
  }),
  endpoint({
    id: 'auth-passkeys-delete',
    group: 'auth',
    title: 'Delete a revoked passkey',
    endpoint: '/api/v1/auth/passkeys/delete',
    summary: 'Password-confirmed removal of a REVOKED passkey and its linked-app records.',
    detail:
      'POST { id, password } — refuses non-revoked passkeys (409), keeping "working credential" → "gone" ' +
      'a deliberate two-step path. Deletion also removes the passkey\'s linked-app records and frees the ' +
      'authenticator to register a fresh passkey.',
    auth: { mode: 'session', description: 'Requires the passkey\'s owner session; the body re-confirms the password.' },
    methods: ['POST'],
    steps: ['Revoke the passkey first.', 'POST { id, password } with credentials.', 'The passkey and its linked apps are gone.'],
    requestExamples: [{ name: 'Delete', description: 'Remove a revoked passkey.', method: 'POST', body: { id: 'a1b2c3d4-…', password: 'hunter22!' } }],
    responseExamples: [
      { status: 200, description: 'Deleted.', body: { ok: true } },
      { status: 409, description: 'Still active.', body: { ok: false, error: 'Revoke this passkey before deleting it' } }
    ]
  }),
  endpoint({
    id: 'admin-set-admin',
    group: 'admin',
    title: 'Promote / demote admin',
    endpoint: '/api/v1/admin/set-admin',
    summary: 'Set a user’s stored admin flag (admin only).',
    detail:
      'POST { userId, admin } to grant or revoke the meta.admin flag. Env-allowlist admins keep access regardless (the returned isAdmin may stay true after a demote).',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
    steps: [
      'POST userId + admin:true to promote, admin:false to demote.',
      'Read the returned user row (id, username, isAdmin, envAdmin) to update the UI.',
      'Demoting an env-allowlist admin only clears the DB flag; they stay admin via env.',
      'Non-admins receive 403; missing userId 400; unknown user 404.'
    ],
    requestExamples: [
      {
        name: 'Promote user',
        description: 'Grant admin.',
        method: 'POST',
        body: { userId: '64f000000000000000000002', admin: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Updated user row.',
        body: { ok: true, user: { id: '64f000000000000000000002', username: 'nik', isAdmin: true, envAdmin: false } }
      },
      { status: 400, description: 'Missing userId.', body: { ok: false, error: 'userId is required' } }
    ]
  }),
  endpoint({
    id: 'admin-users-public-uploads',
    group: 'admin',
    title: 'Approve uploads (public / private / all)',
    endpoint: '/api/v1/admin/users/public-uploads',
    summary: 'Grant or withhold a user’s file and media upload permissions, per scope or all at once (admin only).',
    detail:
      'POST { userId, enabled, scope } to set meta.publicUploads and/or meta.privateUploads. scope is ' +
      "'public' (post/comment/custom-emoji attachments — the default when omitted), 'private' (message attachments + " +
      "the user's own profile avatar/banner), or 'all' (both flags in one write). Accounts created after the " +
      'signup-permissions hotfix start with BOTH scopes withheld — verifying their email address does NOT grant ' +
      'uploads — so this endpoint is the manual approval step an admin performs after the “new user” notification ' +
      'email. While a scope is withheld, POST /api/v1/attachments/uploads returns 403 public_uploads_not_approved or ' +
      'private_uploads_not_approved for purposes in that scope and no upload can start. Accounts that predate the ' +
      'flags have no meta keys and remain enabled; admins are always allowed regardless of the flags.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['POST'],
    steps: [
      "POST userId + enabled:true + scope ('public' | 'private' | 'all') to approve that variation; enabled:false withholds it again.",
      'Read the returned user row (publicUploadsEnabled, privateUploadsEnabled, publicUploadsPending, privateUploadsPending) to update the UI.',
      'The /admin Users tab lists pending accounts — a *Pending flag is true while that scope’s approval is outstanding.',
      "Non-admins receive 403; missing userId, a non-boolean enabled, or an unknown scope 400; unknown user 404."
    ],
    requestExamples: [
      {
        name: 'Approve all uploads',
        description: 'Enable public AND private file and media uploads for a vetted new user.',
        method: 'POST',
        body: { userId: '64f000000000000000000002', enabled: true, scope: 'all' }
      },
      {
        name: 'Approve private only',
        description: 'Let the user set profile media and attach in DMs while public uploads stay withheld.',
        method: 'POST',
        body: { userId: '64f000000000000000000002', enabled: true, scope: 'private' }
      },
      {
        name: 'Withhold public uploads',
        description: 'Revoke the public variation again (scope defaults to public when omitted).',
        method: 'POST',
        body: { userId: '64f000000000000000000002', enabled: false }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Updated user row.',
        body: {
          ok: true,
          user: {
            id: '64f000000000000000000002',
            username: 'nik',
            emailVerified: true,
            publicUploadsEnabled: true,
            privateUploadsEnabled: true,
            publicUploadsPending: false,
            privateUploadsPending: false
          }
        }
      },
      { status: 400, description: 'Missing userId.', body: { ok: false, error: 'userId is required' } },
      { status: 404, description: 'Unknown user.', body: { ok: false, error: 'User not found' } }
    ]
  }),
  endpoint({
    id: 'admin-moderation',
    group: 'admin',
    title: 'Moderation review queue',
    endpoint: '/api/v1/admin/moderation',
    summary: 'Review NSFW/TOS moderation flags, override verdicts, and sweep unanalyzed media (admin only).',
    detail:
      'GET returns the moderationFlag review queue (newest unreviewed first; media AND post/comment-text flags, text rows carry a bounded excerpt), counts of flags and ready attachments still awaiting analysis, plus the Admin AI-moderation settings ({ settings, effective }). POST with { action: "review", attachmentId, verdict: "clear" | "nsfw" | "block", targetKind?: "attachment" | "text" } overrides the protected moderation stamp — blocked media/text stops being served immediately (admins can still open media for evidence), cleared content serves again. POST with { action: "sweep" } analyzes a bounded batch of ready attachments the async pipeline missed; run repeatedly to drain. POST with { action: "settings", settings: { mediaProvider, textProvider } } saves the per-surface AI provider choices (mediaProvider: default | openai+claude | openai | claude | off; textProvider: default | openai | off) — an admin choice overrides the THINGTIME_MODERATION_PROVIDER env default.',
    auth: { mode: 'session', description: 'Requires an admin session (isAdmin).' },
    methods: ['GET', 'POST'],
    steps: [
      'GET to load flags + counts for the /admin Moderation tab.',
      'POST { action: "review", attachmentId, verdict } to override a verdict; the flag records reviewedBy/reviewedAt.',
      'POST { action: "sweep" } after deploys or provider outages to analyze pending/unstamped ready attachments.',
      'POST { action: "settings", settings } to pick which AI runs media and text moderation; GET echoes the saved choices plus what each surface effectively runs.',
      'Non-admins receive 403; unknown attachmentId 404; invalid verdict/action/settings 400.'
    ],
    requestExamples: [
      {
        name: 'Load the review queue',
        description: 'Flags plus analysis backlog counts.',
        method: 'GET'
      },
      {
        name: 'Uphold a block',
        description: 'Confirm a TOS verdict after reviewing the media.',
        method: 'POST',
        body: { action: 'review', attachmentId: '64f000000000000000000031', verdict: 'block' }
      },
      {
        name: 'Run an analysis sweep',
        description: 'Analyze a bounded batch of unanalyzed ready attachments.',
        method: 'POST',
        body: { action: 'sweep' }
      },
      {
        name: 'Use free omni moderation everywhere',
        description: 'Point both surfaces at OpenAI omni-moderation.',
        method: 'POST',
        body: { action: 'settings', settings: { mediaProvider: 'openai', textProvider: 'openai' } }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Review queue.',
        body: {
          ok: true,
          flags: [
            {
              id: 'modflag-64f000000000000000000031',
              attachmentId: '64f000000000000000000031',
              status: 'nsfw',
              categories: ['explicit-nudity'],
              reason: 'Detected explicit nudity.',
              provider: 'claude',
              model: 'claude-opus-5',
              attachmentOwnerId: '64f000000000000000000002',
              attachmentName: 'photo.png',
              attachmentPurpose: 'post',
              reviewedBy: null,
              reviewedAt: null,
              createdAt: '2026-08-18T00:00:00.000Z',
              updatedAt: '2026-08-18T00:00:00.000Z'
            }
          ],
          counts: { flags: 1, unanalyzedReady: 0 }
        }
      },
      { status: 400, description: 'Bad action.', body: { ok: false, error: 'action must be review or sweep' } }
    ]
  }),
  endpoint({
    id: 'settings-pr-conflict-auto-resolver-model-waterfall',
    group: 'settings',
    title: 'AI workflow model waterfall',
    endpoint: '/api/v1/settings/pr-conflict-auto-resolver-model-waterfall',
    summary: 'Read or administratively reorder the model chain used by conflict, rebase, and semantic-refresh AI workflows.',
    detail:
      'GET publicly returns the ordered, non-secret model ids plus the base-model catalog. POST replaces the order for administrators only. The first entry is the preferred model for merge-conflict resolution, stacked-PR rebases, and their semantic Graphify refreshes; conflict-editing calls may use later entries for eligible availability failures. Direct Anthropic features use the first Anthropic-capable entry and OpenAI-backed features the first OpenAI entry, each stopping at the default sentinel. Entries compose a catalog base model with optional variant segments — `<model>[:<effort>][:fast]` (for example claude-opus-5:high:fast or gpt-5.6-sol:ultra) — where the effort must be one the model supports and fast requires the model to offer a fast lane (Anthropic fast mode or OpenAI priority processing). The list length is unlimited; ids must be unique and include default as the hard fallback. Missing or corrupt stored settings resolve safely, dropping unknown entries and collapsing to ["default"] when nothing usable remains.',
    auth: {
      mode: 'optional',
      description: 'GET is public. POST requires an authenticated administrator session.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET to read the current waterfall and the base-model catalog with per-model efforts and speeds.',
      'Administrators POST { waterfall: [modelId, ...] } to replace the priority order.',
      'Compose entries as <model>[:<effort>][:fast] from the catalog; ids must be unique.',
      'Always include default so the resolver has a final provider-selected fallback.'
    ],
    requestExamples: [
      {
        name: 'Read the AI workflow waterfall',
        description: 'Load the public model preference chain.',
        method: 'GET'
      },
      {
        name: 'Prefer fast high-effort Opus, then Fable, then GPT-5.6 Sol, then default',
        description: 'Replace the waterfall as an administrator; any number of unique entries is allowed.',
        method: 'POST',
        body: { waterfall: ['claude-opus-5:high:fast', 'claude-fable-5', 'gpt-5.6-sol:ultra', 'default'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Current public AI workflow settings. models lists every base model; the sample below is truncated.',
        body: {
          ok: true,
          key: 'Thingtime.PRConflictAutoResolverModelWaterfall',
          waterfall: ['default'],
          models: [
            { id: 'default', label: 'Default model', provider: 'default', efforts: [], speeds: ['normal'] },
            {
              id: 'claude-opus-5',
              label: 'Claude Opus 5',
              provider: 'anthropic',
              efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
              speeds: ['normal', 'fast']
            },
            {
              id: 'gpt-5.6-sol',
              label: 'GPT-5.6 Sol',
              provider: 'openai',
              efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
              speeds: ['normal', 'fast']
            }
          ]
        }
      },
      { status: 400, description: 'Invalid waterfall.', body: { ok: false, error: 'waterfall must include default as a hard fallback' } },
      { status: 403, description: 'POST caller is not an admin.', body: { ok: false, error: 'Admins only' } }
    ],
    notes: ['Responses set Cache-Control: no-store. Storage audit fields are never exposed by this endpoint.']
  }),
  endpoint({
    id: 'root-data',
    group: 'root',
    title: 'Root data',
    endpoint: '/api/root-data',
    summary: 'Returns the app shell configuration used by the React Router root loader.',
    detail:
      'Use this endpoint when a client needs the public Thingtime runtime flags, title prefix, deployment labels, and current user shape in one request.',
    auth: {
      mode: 'optional',
      description: 'Reads the httpOnly auth cookie or Bearer token when present; anonymous callers receive user: null.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials included when calling from a browser.',
      'Read envFromCookie for public THINGTIME_* values and devKitEnv for request query overrides.',
      'Use user to decide whether to render anonymous, login, or profile flows.',
      'Preserve Set-Cookie when proxying because the route increments the root session ping counter.'
    ],
    requestExamples: [
      {
        name: 'Load app shell data',
        description: 'Fetch root data for the current browser session.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Root configuration and current user state.',
        body: {
          envFromCookie: { THINGTIME_BRANCH_NAME: 'main' },
          devKitEnv: { NODE_ENV: 'development' },
          titlePrefix: '[LC]',
          user: null
        }
      }
    ]
  }),
  endpoint({
    id: 'auth-accounts',
    group: 'auth',
    title: 'Account switcher roster',
    endpoint: '/api/v1/auth/accounts',
    summary: 'Lists every account signed in to this browser, marking the active one.',
    detail:
      'The account switcher roster is a Mongo document (rosters collection) referenced by an opaque id in the httpOnly tt_accounts cookie; its entries reference sessions by id, so there is no account limit and raw JWTs are never stored or returned. This route resolves each entry to its public user, prunes dead entries (expired, revoked, deleted), and updates the roster + cookie when anything changed.',
    auth: {
      mode: 'optional',
      description:
        'Reads the tt_accounts roster-id and tt_auth cookies. Works without an active session so a signed-out browser can still offer "continue as" for roster accounts.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials included so the httpOnly cookies travel.',
      'Read accounts[] for each signed-in public user; active: true marks the tt_auth account.',
      'Preserve Set-Cookie on the response — pruning rewrites the roster-id cookie.',
      'Call /api/v1/auth/accounts/switch with a listed user id to change the active account.'
    ],
    requestExamples: [
      {
        name: 'List signed-in accounts',
        description: 'Read the switcher roster for this browser.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Two accounts signed in; the first is active.',
        body: {
          ok: true,
          accounts: [
            { user: { id: '64f000000000000000000001', username: 'lopu' }, active: true },
            { user: { id: '64f000000000000000000002', username: 'nik' }, active: false }
          ]
        }
      },
      {
        status: 200,
        description: 'No accounts signed in.',
        body: { ok: true, accounts: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-accounts-remove',
    group: 'auth',
    title: 'Remove account from switcher',
    endpoint: '/api/v1/auth/accounts/remove',
    summary: 'Signs one roster account out: revokes its session and drops it from the switcher.',
    detail:
      'Use this to remove a single account from the browser without touching the others. Removing the active account promotes the next roster account to active; removing the last account clears both auth cookies, signing the browser out entirely.',
    auth: {
      mode: 'optional',
      description: 'Operates on the browser roster named by the httpOnly tt_accounts cookie; possession of that roster id is the authorization.'
    },
    methods: ['POST'],
    steps: [
      'POST the user id of the roster account to remove.',
      'The account session jti is revoked in MongoDB — the removed token is dead everywhere, not just in this browser.',
      'Read user for the account that is active after the removal (null when none remain).',
      'Store the returned Set-Cookie headers so tt_auth and tt_accounts stay in sync.'
    ],
    requestExamples: [
      {
        name: 'Remove one account',
        description: 'Sign the account out of this browser and revoke its session.',
        method: 'POST',
        body: { userId: '64f000000000000000000002' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Account removed; another account remains active.',
        body: {
          ok: true,
          user: { id: '64f000000000000000000001', username: 'lopu' },
          accounts: [{ user: { id: '64f000000000000000000001', username: 'lopu' }, active: true }]
        }
      },
      {
        status: 400,
        description: 'Missing userId.',
        body: { ok: false, error: 'userId is required' }
      }
    ]
  }),
  endpoint({
    id: 'auth-accounts-switch',
    group: 'auth',
    title: 'Switch active account',
    endpoint: '/api/v1/auth/accounts/switch',
    summary: 'Makes a signed-in roster account the active one without re-entering a password.',
    detail:
      'Mints a fresh JWT for the chosen roster account live session into tt_auth. Authorization is possession of the httpOnly roster-id cookie, so switching never needs credentials.',
    auth: {
      mode: 'optional',
      description: 'Operates on the browser roster named by the httpOnly tt_accounts cookie; the target entry must still resolve to a live session.'
    },
    methods: ['POST'],
    steps: [
      'POST the user id of a roster account (from /api/v1/auth/accounts).',
      'Store the returned Set-Cookie headers — tt_auth now carries the chosen account token.',
      'Refresh user-scoped state client-side; the active user changed for every subsequent request.',
      'A 404 means that account is no longer signed in here (session expired or revoked) — refresh the roster and log in again.'
    ],
    requestExamples: [
      {
        name: 'Switch account',
        description: 'Activate another signed-in account.',
        method: 'POST',
        body: { userId: '64f000000000000000000002' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active account switched.',
        body: {
          ok: true,
          user: { id: '64f000000000000000000002', username: 'nik' },
          accounts: [
            { user: { id: '64f000000000000000000001', username: 'lopu' }, active: false },
            { user: { id: '64f000000000000000000002', username: 'nik' }, active: true }
          ]
        }
      },
      {
        status: 404,
        description: 'The account is not signed in to this browser (or its session died).',
        body: { ok: false, error: 'That account is no longer signed in here', accounts: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-jwks',
    group: 'auth',
    title: 'JWKS discovery',
    endpoint: '/api/v1/auth/jwks',
    summary: 'Returns public ES256 JWT verification keys for external token verifiers.',
    detail: 'Services can call this route to discover public keys for validating Thingtime bearer tokens without sharing private signing material.',
    auth: {
      mode: 'none',
      description: 'Public discovery endpoint. No cookie or bearer token is required.'
    },
    methods: ['GET'],
    steps: [
      'Fetch the JWKS URL before validating a Thingtime JWT.',
      'If the route returns 503 with an empty keys array, asymmetric signing keys are not configured in this runtime.',
      'Cache successful keys for the Cache-Control lifetime, then refresh before accepting new tokens.',
      'Match the token header kid to a key entry before verifying the signature.'
    ],
    requestExamples: [
      {
        name: 'Discover signing keys',
        description: 'Read the public key set.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Public key set is configured.',
        body: { keys: [{ kty: 'EC', crv: 'P-256', kid: 'thingtime-key-id', use: 'sig', alg: 'ES256' }] }
      },
      {
        status: 503,
        description: 'No asymmetric public key is configured in this environment.',
        body: { keys: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-introspect',
    group: 'auth',
    title: 'Token introspection',
    endpoint: '/api/v1/auth/introspect',
    summary: 'Reports whether a Thingtime token is still active (signed, unexpired, and not revoked server-side).',
    detail:
      'JWKS lets services verify a token signature, issuer, and expiry offline, but cannot see server-side revocation. POST the token here to check the live session record in Thingtime: active is true only while the session exists, is unexpired, and has not been revoked (for example by logout). Possession of the token is the authorization — you can only ask about tokens you already hold — and inactive tokens return a bare { "active": false } with no reason.',
    auth: {
      mode: 'none',
      description: 'No cookie or separate credential — the introspected token itself is the input, sent in the body or as a Bearer header.'
    },
    methods: ['POST'],
    steps: [
      'POST { "token": "<jwt>" } (or send the token as an Authorization: Bearer header with an empty JSON body).',
      'Call it from your server: introspection is a back-channel check, and unlike /api/v1/oauth/userinfo this route sends no CORS headers, so browser JavaScript on another origin cannot read the response.',
      'Thingtime verifies the signature, then checks the session record for revocation and expiry.',
      'active: true includes sub (user id), jti (session id), purpose, iat/exp (epoch seconds; exp null means non-expiring), and iss.',
      'active only means the session is live — it does not mean the credential is a full account session. Branch on purpose: browser and service are full account credentials; app, app-sandbox, pat, oauth-code, chatgpt-oauth-code, chatgpt-mcp, chatgpt-mcp-refresh, and chatgpt-mcp-connection are scoped credentials that other endpoints will still reject. Treat any purpose you do not recognise as scoped.',
      'Treat { "active": false } as terminal — re-authenticate to obtain a new token; the response never says why a token is inactive.',
      'Poll only when you need live revocation status; keep offline JWKS verification for routine signature checks.'
    ],
    requestExamples: [
      {
        name: 'Introspect a bearer token',
        description: 'Check whether a stored token is still usable.',
        method: 'POST',
        body: { token: '<jwt>' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'The token is signed, unexpired, and its session is still live.',
        body: {
          active: true,
          sub: '64f000000000000000000001',
          jti: '3f1c2a34-5678-4abc-9def-0123456789ab',
          purpose: 'browser',
          iat: 1767225600,
          exp: 1769817600,
          iss: 'https://thingtime.com'
        }
      },
      {
        status: 200,
        description: 'The token is invalid, expired, or its session was revoked.',
        body: { active: false }
      },
      {
        status: 400,
        description: 'No token was provided in the body or Bearer header.',
        body: { ok: false, error: 'Provide the token to introspect as { "token": "…" } or a Bearer header' }
      }
    ]
  }),
  endpoint({
    id: 'auth-logout',
    group: 'auth',
    title: 'Logout',
    endpoint: '/api/v1/auth/logout',
    summary: 'Signs the active account out; other switcher accounts stay signed in unless all: true.',
    detail:
      'Use this endpoint to end browser sessions or revoke a bearer token session server-side. The active account session is revoked and removed from the switcher roster; the next roster account becomes active and is returned as user. Pass all: true to revoke every roster session and clear both cookies. The route is idempotent and returns ok even without a token.',
    auth: {
      mode: 'optional',
      description: 'Uses the auth cookie or Authorization: Bearer token when one exists.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object, or { "all": true } to sign out every switcher account.',
      'If a token is present, Thingtime verifies it and revokes the session jti in MongoDB.',
      'Read user for the account active after logout — null means the browser is fully signed out.',
      'Store the returned Set-Cookie headers so tt_auth and the tt_accounts roster stay in sync.',
      'Treat repeated logout calls as success.'
    ],
    requestExamples: [
      {
        name: 'Logout current session',
        description: 'Sign out the active account; remaining switcher accounts stay signed in.',
        method: 'POST',
        body: {}
      },
      {
        name: 'Logout everywhere',
        description: 'Revoke every switcher account session in this browser.',
        method: 'POST',
        body: { all: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active account signed out; another switcher account took over.',
        body: {
          ok: true,
          user: { id: '64f000000000000000000001', username: 'lopu' },
          accounts: [{ user: { id: '64f000000000000000000001', username: 'lopu' }, active: true }]
        }
      },
      {
        status: 200,
        description: 'Fully signed out.',
        body: { ok: true, user: null, accounts: [] }
      }
    ]
  }),
  endpoint({
    id: 'auth-me',
    group: 'auth',
    title: 'Current user',
    endpoint: '/api/v1/auth/me',
    summary: 'Returns the authenticated public user or null.',
    detail: 'Use this route for lightweight auth checks. It supports the same httpOnly cookie and bearer token model as the rest of the API.',
    auth: {
      mode: 'optional',
      description: 'Cookie or Authorization: Bearer token optional. Anonymous callers receive user: null.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials or an Authorization bearer token.',
			'Read user.storage for the canonical exact account-byte usage, allowance, remaining/overage, and reconciliation status.',
			'Treat the legacy flat used/remaining aliases as nullable compatibility fields; they are populated only when user.storage.status is ready.',
      'If user is null, prompt for login or continue in anonymous mode.',
      'Do not expect password hashes, raw session documents, or JWTs in this response.'
    ],
    requestExamples: [
      {
        name: 'Read current user',
        description: 'Resolve the current account from cookie or bearer token.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Anonymous request.',
        body: { user: null }
      },
      {
        status: 200,
        description: 'Authenticated request.',
        body: {
          user: {
            id: '64f000000000000000000001',
            username: 'service-sync',
            email: 'service@example.com',
            emailVerified: true,
            accountKind: 'service',
						storageAllowanceBytes: 5368709120,
						storageUsedBytes: 2941120,
						storageRemainingBytes: 5365768000,
						storageAccountingReady: true,
						storage: {
							usedBytes: 2941120,
							allowanceBytes: 5368709120,
							remainingBytes: 5365768000,
							overageBytes: 0,
							status: 'ready',
							accountingVersion: 1,
							reconciledAt: '2026-08-07T00:00:00.000Z'
						}
          }
        }
      }
    ]
  }),
  endpoint({
    id: 'auth-temporary',
    group: 'auth',
    title: 'Temporary browser user',
    endpoint: '/api/v1/auth/temporary',
    summary: 'Creates or reuses a recoverable temporary browser session user.',
    detail:
      'This is the first-session bootstrap used by /things. A genuinely anonymous browser receives a normal, private user Thing, bounded storage subscription, browser session, and account-switcher roster entry. Repeating the request with that live session is idempotent and returns the same user; the endpoint never bypasses ordinary Thing ownership or ACL checks.',
    auth: {
      mode: 'optional',
      description: 'A live cookie session is reused. Without one, the same-origin POST may create a rate-limited temporary account.'
    },
    methods: ['POST'],
    steps: [
      'POST once from a same-origin first-page loader; no body is required.',
      'Keep the returned httpOnly auth and account-roster cookies so the temporary space survives reloads and later account additions.',
      'Treat user.temporary as the signal that this is a browser-scoped temporary identity.',
      'All Thing reads and writes continue through the ordinary authenticated API paths.'
    ],
    requestExamples: [
      {
        name: 'Start or recover a temporary space',
        description: 'Idempotently resolve the browser session used by /things.',
        method: 'POST'
      }
    ],
    responseExamples: [
      {
        status: 201,
        description: 'A temporary account and browser session were created.',
        body: {
          ok: true,
          user: {
            id: '64f000000000000000000003',
            username: 'guest-a1b2c3d4e5f6',
            displayName: 'Anonymous',
            temporary: true
          },
          reused: false
        }
      },
      {
        status: 200,
        description: 'The browser already had a live user session.',
        body: { ok: true, user: { id: '64f000000000000000000003', temporary: true }, reused: true }
      },
      {
        status: 429,
        description: 'The per-IP temporary-account creation budget was exhausted.',
        body: { ok: false, error: 'Could not start another temporary space yet — please try again later' }
      }
    ]
  }),
  endpoint({
    id: 'auth-password-reset',
    group: 'auth',
    title: 'Password reset request',
    endpoint: '/api/v1/auth/password-reset',
    summary: 'Emails a single-use password reset link to a registered address.',
    detail:
      'Use this to start a password reset. The route always returns ok so account existence cannot be probed; when the email matches an account, a one-hour single-use reset link is delivered through the Thingtime email service. Requests are rate-limited per IP — the neutral response would otherwise hide a mail bomb.',
    auth: {
      mode: 'none',
      description: 'Public request endpoint — identity is proven later by the emailed token.'
    },
    methods: ['POST'],
    steps: [
      'POST the account email address.',
      'Treat the ok response as neutral — it does not confirm the account exists.',
      'The user opens the emailed link (/reset-password?token=…), which carries a single-use token valid for one hour.',
      'Finish with /api/v1/auth/password-reset/confirm using that token and the new password.',
      'Handle 429 when the per-IP request window is exhausted.'
    ],
    requestExamples: [
      {
        name: 'Request a reset link',
        description: 'Ask for a password reset email.',
        method: 'POST',
        body: { email: 'ada@example.com' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Request accepted (whether or not the account exists). Local/preview runs also return resetLink.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'auth-password-reset-confirm',
    group: 'auth',
    title: 'Password reset confirm',
    endpoint: '/api/v1/auth/password-reset/confirm',
    summary: 'Burns a reset token, sets the new password, and revokes all sessions.',
    detail:
      'Use this with the token from the reset email. On success the password is replaced and every live session for the account is revoked, so stolen cookies or bearer tokens stop working immediately.',
    auth: {
      mode: 'none',
      description: 'The single-use emailed token is the credential.'
    },
    methods: ['POST'],
    steps: [
      'POST the reset token together with the new password (minimum 6 characters).',
      'Tokens are single-use and expire after one hour — expired/used tokens return 400.',
      'All existing sessions are revoked on success; the user logs in again with the new password.'
    ],
    requestExamples: [
      {
        name: 'Set a new password',
        description: 'Consume a reset token and rotate the password.',
        method: 'POST',
        body: { token: 'reset-token-from-the-email', password: 'a-new-password' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Password rotated and sessions revoked.',
        body: { ok: true }
      },
      {
        status: 400,
        description: 'Missing/expired/used token or invalid password.',
        body: { ok: false, error: 'This reset link has expired — request a new one' }
      }
    ]
  }),
  endpoint({
    id: 'auth-register',
    group: 'auth',
    title: 'Register user',
    endpoint: '/api/v1/auth/register',
    summary: 'Creates a user account, starts email verification, logs the browser in, and sets the auth cookie.',
    detail: 'This is the live user signup path. Tests and seed flows should call this endpoint instead of writing directly to MongoDB.',
    auth: {
      mode: 'none',
      description: 'Public signup endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST username, password, and email. displayName and meta are optional.',
      'Store the returned Set-Cookie header for browser clients.',
      'If verificationLink is present, it is a local/preview helper only; production sends email instead.',
      'Expect emailVerified to start false until the verification link is consumed.'
    ],
    requestExamples: [
      {
        name: 'Create user account',
        description: 'Register a standard browser/user account.',
        method: 'POST',
        body: {
          username: 'ada-lovelace',
          password: 'replace-with-a-long-password',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          meta: { source: 'external-app' }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'User created and auth cookie set.',
        body: {
          ok: true,
          user: {
            id: '64f000000000000000000002',
            username: 'ada-lovelace',
            email: 'ada@example.com',
            emailVerified: false
          }
        }
      },
      {
        status: 400,
        description: 'Validation failed.',
        body: { ok: false, error: 'A valid email is required' }
      }
    ]
  }),
  endpoint({
    id: 'auth-resend-verification',
    group: 'auth',
    title: 'Resend verification',
    endpoint: '/api/v1/auth/resend-verification',
    summary: 'Requests another verification email without revealing whether an account exists.',
    detail:
      'This route intentionally returns ok for empty, unknown, already verified, and valid unverified emails so callers cannot enumerate accounts.',
    auth: {
      mode: 'none',
      description: 'Public anti-enumeration endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST an email address when the user asks for a new verification email.',
      'The route creates and sends a token only if the email belongs to an existing unverified account.',
      'Always treat { ok: true } as a neutral accepted response, not proof that an account exists.',
      'In local/preview, verificationLink may be returned for development testing.'
    ],
    requestExamples: [
      {
        name: 'Resend verification email',
        description: 'Request a new verification email.',
        method: 'POST',
        body: { email: 'ada@example.com' }
      },
      {
        name: 'Empty anti-enumeration request',
        description: 'Empty requests also return ok and do not reveal account state.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Accepted without revealing account state.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'auth-service-account',
    group: 'auth',
    title: 'Service account provisioning',
    endpoint: '/api/v1/auth/service-account',
    summary: 'Creates a service-owned account with a non-expiring bearer token and 5 GiB storage allowance.',
    detail:
      'Use this endpoint to connect other apps to Thingtime backend data. The account is public self-service but must verify its email within seven days. Provisioning is rate limited per IP (each call mints a permanent token) and the request body is capped at 16 KiB.',
    auth: {
      mode: 'none',
      description: 'Public endpoint, rate limited per IP. Email verification is required after creation.'
    },
    methods: ['POST'],
    steps: [
      'POST a serviceName and valid email. username, displayName, and meta are optional.',
      'Store accessToken securely server-side; it has no exp claim and should be treated like an API key.',
      'Send Authorization: Bearer <accessToken> to authenticated Thingtime API routes.',
      'Complete email verification before verificationRequiredBy to keep the integration trustworthy.'
    ],
    requestExamples: [
      {
        name: 'Create service account',
        description: 'Provision an integration account for a backend service.',
        method: 'POST',
        body: {
          serviceName: 'My Sync Worker',
          username: 'my-sync-worker',
          email: 'sync@example.com',
          displayName: 'My Sync Worker',
          meta: { app: 'calendar-sync', environment: 'production' }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Service account created.',
        body: {
          ok: true,
          accessToken: 'eyJhbGciOiJFUzI1NiIsImtpZCI6InRoaW5ndGltZSJ9...',
          tokenType: 'Bearer',
          expiresAt: null,
          verificationRequiredBy: '2026-07-15T00:00:00.000Z',
          storageAllowanceBytes: 5368709120,
          user: {
            accountKind: 'service',
						emailVerified: false,
						storageAllowanceBytes: 5368709120,
						storageUsedBytes: 0,
						storageAccountingReady: true,
						storage: {
							usedBytes: 0,
							allowanceBytes: 5368709120,
							remainingBytes: 5368709120,
							overageBytes: 0,
							status: 'ready',
							accountingVersion: 1,
							reconciledAt: '2026-07-15T00:00:00.000Z'
						}
          }
        }
      },
      {
        status: 400,
        description: 'A valid email is required.',
        body: { ok: false, error: 'A valid email is required' }
      },
      {
        status: 429,
        description: 'Too many provisioning requests from this IP inside the window.',
        body: { ok: false, error: 'Too many service accounts from this address — please wait before provisioning more 🌸' }
      }
    ],
    notes: [
      'The bearer token is intentionally non-expiring; rotate it by creating a replacement service account when needed.',
      'Provisioning is rate limited per IP and fail-closed: if the limiter store is unreachable the route returns 503 rather than minting unmetered tokens.'
    ]
  }),
  endpoint({
    id: 'auth-two-factor',
    group: 'auth',
    title: 'Email 2FA settings',
    endpoint: '/api/v1/auth/two-factor',
    summary: 'Reads or toggles opt-in email 2FA for the current account.',
    detail:
      'When enabled, POST /api/v1/login stops minting sessions from a password alone: it returns { requiresOtp, challenge } and emails a security code that completes the login. Enabling requires a verified email address.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires the httpOnly session cookie or an Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET returns the current enabled state for the session user.',
      'POST { enabled: true } turns email 2FA on (requires a verified email).',
      'POST { enabled: false } turns it off.',
      'Subsequent logins follow the two-step challenge flow documented on /api/v1/login.'
    ],
    requestExamples: [
      {
        name: 'Enable email 2FA',
        description: 'Require an emailed security code on every login.',
        method: 'POST',
        body: { enabled: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Setting applied.',
        body: { ok: true, enabled: true }
      },
      {
        status: 400,
        description: 'Email not verified yet.',
        body: { ok: false, error: 'Verify your email before enabling email 2FA' }
      },
      {
        status: 401,
        description: 'No session or bearer token.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'auth-verify-email',
    group: 'auth',
    title: 'Verify email',
    endpoint: '/api/v1/auth/verify-email',
    summary: 'Consumes an email verification token and redirects to login with a status.',
    detail: 'This endpoint is designed for email links. API clients usually follow redirects or inspect the Location header.',
    auth: {
      mode: 'none',
      description: 'Public token consumption endpoint.'
    },
    methods: ['GET'],
    steps: [
      'Open the verification URL with token as a query parameter.',
      'Thingtime burns the token so it cannot be reused.',
      'Successful tokens mark the user emailVerified and redirect to /login?verify=success.',
      'Missing, expired, or invalid tokens redirect to /login with a reason in the verify query parameter.'
    ],
    requestExamples: [
      {
        name: 'Verify token',
        description: 'Consume an email verification token.',
        method: 'GET',
        query: { token: 'verification-token-from-email' }
      }
    ],
    responseExamples: [
      {
        status: 302,
        description: 'Token accepted.',
        headers: { Location: '/login?verify=success' }
      },
      {
        status: 302,
        description: 'Token missing.',
        headers: { Location: '/login?verify=missing' }
      }
    ]
  }),
  endpoint({
    id: 'crypto',
    group: 'crypto',
    title: 'Crypto tools',
    endpoint: '/api/v1/crypto',
		summary: 'Lists crypto standards and runs key generation, JWT verification, signature verification, key matching, and password hashing helpers.',
    detail:
      'Use this route for Thingtime-compatible ES256 key workflows and diagnostics. POST bodies are intent-driven. intent: hash-password additionally turns a password into the exact bcrypt hash Thingtime stores (cost 10, the auth/passwords.ts settings) and returns a paste-ready mongosh snippet that writes it into a user — the manual recovery path for a database you own when the emailed reset flow is not an option. It is a PURE computation: no database is read or written, no account is looked up, and nothing about who exists is revealed. Because bcrypt is deliberately CPU-heavy, this intent is rate-limited per IP (crypto.hashPassword).',
    auth: {
      mode: 'none',
      description:
        'Public helper endpoint. Do not post private production secrets from untrusted clients. hash-password is deliberately anonymous (being locked out is the reason to use it) and never touches the database — writing the hash is a manual step you run against your own db.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET the route to list supported standards and Thingtime auth compatibility.',
      'POST intent: generate-key-pair to create an ES256 key pair for development or integration setup.',
      'POST intent: verify-jwt, verify-signature, or match-key-pair with the required material for diagnostics.',
      'POST intent: hash-password with { password } (or { generate: true, length }) plus an optional username to template the snippet; the response hash is re-verified against its own input before it is returned.',
      'Run the returned mongosh snippet against your database: things-era users keep passwordHash INSIDE the secure BinData blob, so it unpacks, edits, repacks and bumps secureVersion — a plain $set of passwordHash would write a field nothing reads.',
      'Handle 400 responses for unsupported intents or invalid crypto input, and 429 when the hashing budget is exhausted.'
    ],
    requestExamples: [
      {
        name: 'List standards',
        description: 'Read supported crypto standards.',
        method: 'GET'
      },
      {
        name: 'Generate ES256 key pair',
        description: 'Generate a development key pair.',
        method: 'POST',
        body: { intent: 'generate-key-pair', standard: 'ES256' }
      },
      {
        name: 'Hash a password',
        description: 'Hash a chosen password and template the rotate snippet for a user.',
        method: 'POST',
        body: { intent: 'hash-password', password: 'correct-horse-battery', username: 'ada-lovelace' }
      },
      {
        name: 'Generate + hash',
        description: 'Have a strong password generated, hashed, and echoed back once.',
        method: 'POST',
        body: { intent: 'hash-password', generate: true, length: 32, username: 'ada-lovelace' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Supported standards.',
        body: { ok: true, standards: [{ value: 'ES256', label: 'ECDSA P-256 + SHA-256', thingtimeAuthCompatible: true }] }
      },
      {
        status: 200,
        description: 'Hashed password. `password` is echoed ONLY when the endpoint generated it.',
        body: {
          ok: true,
          result: {
            algorithm: 'bcrypt',
            cost: 10,
            hash: '$2b$10$…',
            verified: true,
            password: null,
            generated: false,
            meetsRegisterPolicy: true,
            collections: { things: 'things_v2', users: 'users_v2' },
            mongosh: '// Thingtime — set a user’s password hash by hand …'
          }
        }
      },
      {
        status: 400,
        description: 'Unknown intent, or hash-password called with no password and generate unset.',
        body: { ok: false, error: 'Unknown crypto action.' }
      },
      {
        status: 429,
        description: 'Hashing budget exhausted (bcrypt is CPU-heavy).',
        body: { ok: false, error: 'Hashing is CPU-heavy — take a breather 🌸' }
      }
    ],
    notes: [
      'The hash is self-verified before return: a value that would not authenticate can never be handed out.',
      'A manual rotation does NOT revoke existing sessions — clear them separately if that matters.',
      'Passwords are never logged or persisted by this endpoint; a supplied password is not echoed back.'
    ]
  }),
  endpoint({
    id: 'email-config',
    group: 'email',
    title: 'Email delivery config',
    endpoint: '/api/v1/email/config',
    summary: 'Returns the sanitized email delivery configuration for diagnostics.',
    detail:
      'Use this to check which provider (console or SES), region, sender addresses, and sandbox settings the runtime resolved — no credentials are ever included.',
    auth: {
      mode: 'none',
      description: 'Public diagnostic endpoint returning non-secret configuration only.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET the endpoint (POST behaves identically).',
      'Read provider to confirm whether real SES delivery or console logging is active.',
      'Use sesSandbox and testRecipient to plan /tests email checks.'
    ],
    requestExamples: [
      {
        name: 'Read email config',
        description: 'Inspect the resolved delivery configuration.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Sanitized email configuration.',
        body: {
          ok: true,
          email: {
            provider: 'console',
            region: 'us-east-1',
            configurationSetName: null,
            transactionalFrom: 'Thingtime <no-reply@thingtime.com>',
            newsletterFrom: 'Thingtime Updates <updates@thingtime.com>',
            sesSandbox: false,
            sandboxSendDelayMs: 0,
            testRecipient: 'support@thingtime.com',
            testRecipientDomain: 'thingtime.com'
          }
        }
      }
    ]
  }),
  endpoint({
    id: 'email-test-otp',
    group: 'email',
    title: 'Email OTP test send',
    endpoint: '/api/v1/email/test-otp',
    summary: 'Sends a test security-code email to the configured test recipient.',
    detail:
      'Dev/preview-only helper for the /tests page: it exercises the OTP template and delivery service end to end. Production environments return 403, and recipients are restricted to the configured test address (or a plus alias of it).',
    auth: {
      mode: 'none',
      description: 'Gated by environment (local development and Vercel previews), not by session.'
    },
    methods: ['POST'],
    steps: [
      'POST an email matching the configured test recipient or one of its plus aliases.',
      'Optionally pass code and expiresMinutes; a random six-digit code is generated otherwise.',
      'Inspect the returned delivery result and the email_messages record it created.'
    ],
    requestExamples: [
      {
        name: 'Send a test OTP',
        description: 'Deliver a security-code email to the test recipient.',
        method: 'POST',
        body: { email: 'support+otp-test@thingtime.com' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Test email queued/sent.',
        body: { ok: true, result: { delivered: false, via: 'console', status: 'logged' } }
      },
      {
        status: 403,
        description: 'Not a dev/preview environment.',
        body: { ok: false, error: 'Email OTP test sends are available only in local development and Vercel previews.' }
      }
    ]
  }),
  endpoint({
    id: 'health-frontend',
    group: 'health',
    title: 'Frontend health',
    endpoint: '/api/v1/health/frontend',
    summary: 'Checks whether a Thingtime frontend shell is reachable.',
    detail: 'Used by environment status UI to verify local, preview, or remote frontend availability.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters to check the current origin.',
      'Pass target or origin query parameters when checking another Thingtime environment.',
      'Read ok, state, statusCode, responseMs, and shellDetected for diagnostics.',
      'Treat ok false as a health signal, not a transport failure.'
    ],
    requestExamples: [
      {
        name: 'Check current frontend',
        description: 'Verify the frontend shell on the current origin.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Frontend status shape.',
        body: { ok: true, service: 'frontend', state: 'ready', shellDetected: true, statusCode: 200 }
      }
    ]
  }),
  endpoint({
    id: 'health-mongodb',
    group: 'health',
    title: 'MongoDB health',
    endpoint: '/api/v1/health/mongodb',
    summary: 'Returns MongoDB connectivity for the current or target environment.',
    detail: 'This route wraps the MongoDB status helper and can proxy remote health checks through the environment status resolver.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. Secrets are sanitized from responses.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters for current runtime MongoDB health.',
      'Pass target or origin query parameters to compare another deployment when supported.',
      'Read connected, host, dbName, pingMs, checkedAt, and error.',
      'Do not expect raw credentials in host; connection strings are sanitized.'
    ],
    requestExamples: [
      {
        name: 'Check MongoDB',
        description: 'Check current MongoDB connection state.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'MongoDB health shape.',
        body: { connected: true, host: 'mongodb://localhost:27017/thingtime', dbName: 'thingtime', pingMs: 4 }
      }
    ]
  }),
  endpoint({
    id: 'health-nitro',
    group: 'health',
    title: 'Nitro health',
    endpoint: '/api/v1/health/nitro',
    summary: 'Reports Nitro API runtime readiness.',
    detail: 'Use this endpoint to confirm the API server is alive and to compare local versus remote runtime status.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters for current runtime status.',
      'Pass target or origin query parameters to check a remote Thingtime runtime when supported.',
      'Read service, state, runtime, nodeEnv, and responseMs.',
      'Use this before deeper API tests to separate server availability from endpoint behavior.'
    ],
    requestExamples: [
      {
        name: 'Check Nitro',
        description: 'Confirm the Nitro API is ready.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Nitro is ready.',
        body: { ok: true, service: 'nitro', state: 'ready', runtime: 'nitro' }
      }
    ]
  }),
  endpoint({
    id: 'health-vercel',
    group: 'health',
    title: 'Vercel health',
    endpoint: '/api/v1/health/vercel',
    summary: 'Returns Vercel deployment status or a safe unavailable shape.',
    detail: 'This endpoint powers environment status displays and avoids leaking dashboard credentials.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. It only returns status data exposed by server-side configuration.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call without query parameters for current Vercel deployment status.',
      'Pass target or origin query parameters for remote environment checks when supported.',
      'Read configured, state, label, hasError, and error for UI diagnostics.',
      'Handle configured false as an expected state outside Vercel-enabled runtimes.'
    ],
    requestExamples: [
      {
        name: 'Check Vercel',
        description: 'Read deployment status for the current runtime.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Vercel status shape.',
        body: { configured: true, state: 'READY', label: 'Vercel: ready', hasError: false }
      }
    ]
  }),
  endpoint({
    id: 'login',
    group: 'auth',
    title: 'Login',
    endpoint: '/api/v1/login',
    summary: 'Validates username/password credentials and sets the auth cookie.',
    detail: 'Use this for browser login. API clients that need service integration should prefer the service-account endpoint and bearer token.',
    auth: {
      mode: 'none',
      description: 'Public credential exchange endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST username and password.',
      'If the account has email 2FA enabled, the response is { requiresOtp: true, challenge } and a code is emailed — POST { challenge, code } to this same endpoint to finish.',
      'Store the Set-Cookie response header for browser clients.',
      'Use /api/v1/auth/me after login to confirm the current user.',
      'Handle 401 for invalid credentials/codes, 429 for rate-limited attempts or exhausted OTP retries, and 500 for unavailable backing services.'
    ],
    requestExamples: [
      {
        name: 'Login user',
        description: 'Authenticate a username/password account.',
        method: 'POST',
        body: { username: 'ada-lovelace', password: 'replace-with-the-user-password' }
      },
      {
        name: 'Complete email 2FA login',
        description: 'Finish a login that returned requiresOtp using the emailed security code.',
        method: 'POST',
        body: { challenge: 'challenge-id-from-the-first-response', code: '123456' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Login succeeded and auth cookie was set.',
        body: { ok: true, user: { id: '64f000000000000000000002', username: 'ada-lovelace' } }
      },
      {
        status: 200,
        description: 'Email 2FA is enabled — a security code was emailed; no session yet.',
        body: { ok: true, requiresOtp: true, challenge: 'challenge-id', expiresAt: '2026-01-01T00:10:00.000Z' }
      },
      {
        status: 401,
        description: 'Invalid credentials.',
        body: { ok: false, error: 'Invalid username or password' }
      }
    ]
  }),
  endpoint({
    id: 'lopu-musing',
    group: 'lopu',
    title: 'Lopu musing stream',
    endpoint: '/api/v1/lopu/musing',
    summary: 'Streams a short Lopu musing as newline-delimited JSON.',
    detail:
      'The stream uses weather/time context from Vercel geo headers when present and falls back to a canned stream if no AI provider is configured or quota is exhausted.',
    auth: {
      mode: 'optional',
      description: 'Anonymous calls are allowed. Auth may affect rate-limit accounting when provider-backed output is enabled.'
    },
    methods: ['GET'],
    steps: [
      'Open a GET request with Accept: application/x-ndjson or Accept: */*.',
      'Read each newline as a JSON event.',
      'Append delta.text values until a done event arrives.',
      'Inspect X-Thingtime-Lopu-Rate-Limited to know whether the fallback path was used.'
    ],
    requestExamples: [
      {
        name: 'Stream musing',
        description: 'Read an NDJSON stream of Lopu events.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'NDJSON stream events.',
        body: [{ type: 'meta', source: 'fallback', mode: 'weather' }, { type: 'delta', text: 'Lopu is thinking...' }, { type: 'done' }]
      }
    ]
  }),
  endpoint({
    id: 'deployment-links',
    group: 'deployments',
    title: 'Linked deployments',
    endpoint: '/api/v1/deployment-links',
    summary: 'Lists, creates, updates, and removes links to the caller’s accounts on other Thingtime deployments.',
    detail:
      'A deployment link stores a bearer token for the caller’s account on another Thingtime deployment so the two can sync. The remote token lives only in the user thing’s encrypted secure blob (meta.deploymentLinks) and is never projected onto the wire — every response returns the sanitized link shape. POST accepts either a token pasted from the other deployment’s /api/v1/deployment-links/token, or a remote username + password (which may answer { requiresOtp, challenge } for an email-2FA account, completed by re-POSTing { challenge, code }). A password link is upgraded to a non-expiring deployment-link token when the remote supports it, and the login-derived session is then revoked. Base URLs are fenced against SSRF: https only (http for localhost), origin only — no path, query, or credentials — and IP literals plus internal-only names are refused. Link/unlink/mint ride the fail-closed deployments.link limit, because they dial a caller-supplied host; PATCH dials nothing and rides the roomier deployments.update limit so retuning a link never spends the linking budget.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token. Links are always scoped to the calling user.'
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    steps: [
      'GET to list the caller’s links (never includes a token).',
      'POST { baseUrl, token } to link with a token minted on the other deployment, or POST { baseUrl, username, password } to log in over there.',
      'When the remote account has email 2FA, the login answers { requiresOtp: true, challenge } — re-POST { baseUrl, challenge, code } to finish.',
      'PATCH { id, name?, syncMode?, pathRules? } to retune a link; path rules are profile, things, or things/<kind>, each with mode push/pull/two-way/off.',
      'DELETE { id } to unlink — the remote session is revoked best-effort so the stored token dies with the link.'
    ],
    requestExamples: [
      {
        name: 'Link with a pasted token',
        description: 'Link an account using a token minted by the other deployment.',
        method: 'POST',
        body: { baseUrl: 'https://other.thingtime.com', name: 'Other deployment', token: '<remote token>' }
      },
      {
        name: 'Retune a link',
        description: 'Switch a link to pull-only and suppress one kind.',
        method: 'PATCH',
        body: { id: 'link_123', syncMode: 'pull', pathRules: [{ path: 'things/chat-message', mode: 'off' }] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'The caller’s links, sanitized — no token field is ever present.',
        body: {
          ok: true,
          links: [
            {
              id: 'link_123',
              name: 'other.thingtime.com',
              baseUrl: 'https://other.thingtime.com',
              remoteUserId: '64f000000000000000000001',
              remoteUsername: 'rick.deckard',
              syncMode: 'two-way',
              pathRules: [],
              tokenExpiresAt: null,
              lastSyncAt: null,
              lastSyncSummary: null
            }
          ]
        }
      },
      {
        status: 400,
        description: 'The base URL failed the SSRF fence, or the body named neither a token nor a username + password.',
        body: { ok: false, error: 'Provide a token, or a username + password for that deployment' }
      },
      { status: 401, description: 'No signed-in user.', body: { ok: false, error: 'Unauthorized' } }
    ],
    notes: [
      'Remote tokens never leave api/utils — routes project links through toPublicLink before responding.',
      'At most 10 links per account, and at most 50 path rules per link.'
    ]
  }),
  endpoint({
    id: 'deployment-links-sync',
    group: 'deployments',
    title: 'Sync a linked deployment',
    endpoint: '/api/v1/deployment-links/sync',
    summary: 'Runs one bounded sync pass for a link, or previews it with dryRun.',
    detail:
      'Moves things and profile fields between this deployment and the linked one, keyed by shareId, honouring the link’s syncMode and path rules (first matching rule wins, then things, then the link mode). Dependencies are ordered so a comment never lands before its post and schemas land before the data things citing them. Content equality beats updatedAt, so re-running an unchanged sync plans zero operations instead of ping-ponging copies. A pass is bounded by both an operation count and a wall-clock budget, so a slow linked deployment ends the pass with a report instead of running until the function is killed — the report’s remaining count says whether another pass is needed — and per-thing errors (a shareId owned by a different account, a kind unknown to the destination registry) are reported rather than aborting the run. Rides the fail-closed deployments.sync limit.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token. Only the caller’s own links can be synced.'
    },
    methods: ['POST'],
    steps: [
      'POST { id, dryRun: true } to preview the planned operations without writing anything.',
      'POST { id } to run the pass; the link’s lastSyncAt and lastSyncSummary are updated on a real run.',
      'Re-run while report.remaining is greater than zero to continue a bounded pass.'
    ],
    requestExamples: [
      { name: 'Preview a sync', description: 'Plan the pass without writing.', method: 'POST', body: { id: 'link_123', dryRun: true } },
      { name: 'Run a sync', description: 'Execute one bounded pass.', method: 'POST', body: { id: 'link_123' } }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'The pass report plus the refreshed link projection.',
        body: {
          ok: true,
          report: { dryRun: false, planned: 12, applied: 12, conflictsResolved: 1, remaining: 0, errors: [], finishedAt: '2026-08-30T00:00:00.000Z' },
          link: { id: 'link_123', syncMode: 'two-way', lastSyncAt: '2026-08-30T00:00:00.000Z' }
        }
      },
      { status: 404, description: 'No link with that id belongs to the caller.', body: { ok: false, error: 'Link not found' } },
      { status: 401, description: 'No signed-in user.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'deployment-links-token',
    group: 'deployments',
    title: 'Mint a deployment link token',
    endpoint: '/api/v1/deployment-links/token',
    summary: 'Mints a non-expiring, revocable token for THIS deployment so another deployment can link to this account.',
    detail:
      'Returns a bearer token purpose-tagged deployment-link, backed by a null-expiry session document exactly like a service-account token — so it is revocable server-side at any time. Two callers use it: another deployment upgrading a login-derived link token, and a person copying a token to paste into another deployment’s link form. The token is returned exactly once and is never stored in readable form or shown again. Rides the fail-closed deployments.link limit.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token. The token is minted for the calling user only.'
    },
    methods: ['POST'],
    steps: [
      'POST with no body while signed in on the deployment you want to be linked TO.',
      'Copy the returned token once — it is never shown again.',
      'Paste it into the other deployment’s POST /api/v1/deployment-links as { baseUrl, token }.',
      'Revoke it later like any other session; unlinking also revokes it best-effort.'
    ],
    requestExamples: [
      { name: 'Mint a link token', description: 'Create a token to paste into another deployment.', method: 'POST', body: {} }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'The token, shown exactly once.',
        body: { ok: true, token: '<jwt>', tokenType: 'Bearer', expiresAt: null }
      },
      { status: 401, description: 'No signed-in user.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'mongodb-endpoint',
    group: 'mongodb',
    title: 'MongoDB data endpoint',
    endpoint: '/api/v1/mongodb/endpoint',
    summary: 'Read or change the MongoDB endpoint the data plane uses for this browser session.',
    detail:
      'Thin-frontend mode: the session can point the open data plane (things, feed, search, comments, reactions, schemas, app-data) at any reachable MongoDB. Identity, auth and the protected system kinds always stay on the home Thingtime DB. The override is an httpOnly session cookie (tt_mongo) — or send an x-tt-mongo-url header per request from API clients. Activation probes the endpoint (connect + ping) before accepting it. Responses never include the URL itself, only the credentials-stripped host and db name.',
    auth: {
      mode: 'optional',
			description: 'Works logged out for { url } and { reset }. Selecting a saved endpoint ({ savedId }) requires a signed-in session.'
    },
    methods: ['GET', 'POST', 'DELETE'],
    steps: [
      'GET to read the active endpoint: { endpoint: { custom, host, dbName, savedId }, defaultHost }.',
      'POST { url } with a mongodb:// or mongodb+srv:// URL to activate it for this browser session.',
      'POST { savedId } (signed in) to activate one of your saved endpoints.',
      'POST { reset: true } or send DELETE to return to the Thingtime default.',
      'A failed probe returns 422 with a safe error — the previous endpoint stays active.'
    ],
    requestExamples: [
      {
        name: 'Read active endpoint',
        description: 'Which MongoDB the data plane currently uses.',
        method: 'GET'
      },
      {
        name: 'Activate a custom endpoint',
        description: 'Point the data plane at a custom MongoDB for this session.',
        method: 'POST',
        body: { url: 'mongodb://localhost:27017/mydb' }
      },
      {
        name: 'Back to default',
        description: 'Clear the override.',
        method: 'POST',
        body: { reset: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Custom endpoint active.',
        body: {
          ok: true,
          endpoint: { custom: true, host: 'localhost:27017', dbName: 'mydb', savedId: null },
          defaultHost: 'cluster0.mongodb.net'
        }
      },
      {
        status: 422,
        description: 'Endpoint unreachable — nothing changed.',
        body: { ok: false, error: 'MongoServerSelectionError (ECONNREFUSED)' }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-endpoints',
    group: 'mongodb',
    title: 'Saved MongoDB endpoints',
    endpoint: '/api/v1/mongodb/endpoints',
    summary: 'Manage the signed-in user’s saved data-plane MongoDB endpoints.',
    detail:
      'Saved endpoints persist in the user’s private secure state on the home DB, with the Thingtime default always available. Saved URLs may embed credentials, so responses only ever return the sanitized host and db name. Activate a saved endpoint via POST /api/v1/mongodb/endpoint with { savedId }.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Session cookie or Bearer token. Endpoints belong to the signed-in account.'
    },
    methods: ['GET', 'POST', 'DELETE'],
    steps: [
      'GET to list saved endpoints; the one active for this session carries active: true.',
      'POST { name?, url } to save an endpoint (probed first; duplicates and >20 entries are rejected).',
      'DELETE { id } to remove one — if it is the session’s active endpoint the override is cleared too.',
      'Activate with POST /api/v1/mongodb/endpoint { savedId }.'
    ],
    requestExamples: [
      {
        name: 'List saved endpoints',
        description: 'All endpoints saved to this account.',
        method: 'GET'
      },
      {
        name: 'Save an endpoint',
        description: 'Persist a custom MongoDB endpoint.',
        method: 'POST',
        body: { name: 'Homelab', url: 'mongodb://user:pass@localhost:27017/mydb' }
      },
      {
        name: 'Remove an endpoint',
        description: 'Delete a saved endpoint by id.',
        method: 'DELETE',
        body: { id: '665f0c2ab1d2c300a1b2c3d4' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Saved endpoints.',
        body: {
          ok: true,
          endpoints: [
            {
              id: '665f0c2ab1d2c300a1b2c3d4',
              name: 'Homelab',
              host: 'localhost:27017',
              dbName: 'mydb',
              createdAt: '2026-07-19T00:00:00.000Z',
              active: true
            }
          ],
          activeSavedId: '665f0c2ab1d2c300a1b2c3d4'
        }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-get-connection',
    group: 'mongodb',
    title: 'MongoDB connection config',
    endpoint: '/api/v1/mongodb/get-connection',
    summary: 'Returns sanitized MongoDB host information for diagnostics.',
    detail: 'Use this endpoint to check which MongoDB host the runtime is configured to use without exposing credentials.',
    auth: {
      mode: 'none',
      description: 'Development diagnostic endpoint. Returned host is sanitized.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object.',
      'Read data.host to confirm the configured MongoDB target.',
      'Handle 500 if MONGODB_CONNECTION_STRING is missing or invalid.',
      'Never use this response as a credential source; passwords are stripped.'
    ],
    requestExamples: [
      {
        name: 'Read sanitized host',
        description: 'Check the configured MongoDB host.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Sanitized connection host.',
        body: {
          message: 'Early return triggered in API V1 MongoDB Get Connection action: successful',
          data: { host: 'mongodb://localhost:27017/thingtime' }
        }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-populate',
    group: 'mongodb',
    title: 'MongoDB populate',
    endpoint: '/api/v1/mongodb/populate',
    summary: 'Runs the MongoDB setup/populate script.',
    detail: 'This is a mutating development utility. Use it carefully because it initializes or updates local Thingtime MongoDB state.',
    auth: {
      mode: 'none',
      description: 'Development utility endpoint. Restrict exposure by environment and network controls.'
    },
    methods: ['POST'],
    steps: [
      'POST an empty JSON object from a trusted development environment.',
      'The route runs the shared MongoDB setup script.',
      'Read data.ret for setup output.',
      'Avoid calling this from production automation unless explicitly intended.'
    ],
    requestExamples: [
      {
        name: 'Populate MongoDB',
        description: 'Run setup/populate for a development database.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Populate script completed.',
        body: { message: 'Early return triggered in Populate action: successful', data: { ret: true } }
      }
    ],
    notes: ['This route mutates database state. It is present for local/dev workflows and test harness coverage.']
  }),
  endpoint({
    id: 'mongodb-raw-results',
    group: 'mongodb',
    title: 'MongoDB query workbench',
    endpoint: '/api/v1/mongodb/raw-results',
    summary: 'Advertises and runs bounded, read-only MongoDB queries for the no-code admin workbench.',
    detail:
      'GET returns the server-owned capability catalogue. POST accepts a structured query built from filters, typed Extended JSON values, projection, sort, collation, index hints, or a read-only aggregation pipeline. Results are capped by document count, response bytes, and execution time. Mutations, change streams, operational/session inspection, server-side JavaScript, arbitrary databases, and unknown collections are rejected recursively.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist). Every request is re-authorized and query execution is rate-limited.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET the endpoint as an admin to load the exact collections, operations, stages, blocked keys, and resource limits.',
      'Choose one allowlisted Thingtime collection and a read operation: find, findOne, exact/estimated count, distinct, aggregate, indexes, or collection stats.',
      'POST the structured request. Use canonical MongoDB Extended JSON wrappers such as $oid, $date, $numberLong, and $regularExpression for typed values.',
      'Read results, resultCount, durationMs, truncated, redactedFields, and explain from the response.',
      'Handle 400 for invalid/unsafe queries, 401/403 for non-admin callers, 413 for oversized bodies, 429 for rate limiting, and 503 when MongoDB is unavailable.'
    ],
    requestExamples: [
      {
        name: 'Find recent posts',
        description: 'Run a bounded, sorted query from the no-code builder.',
        method: 'POST',
        body: {
          collection: 'things',
          operation: 'find',
          filter: { thingtime: { $all: ['post'] } },
          projection: { shareId: 1, thingtime: 1, crystal: 1, createdAt: 1, _id: 0 },
          sort: { createdAt: -1 },
          limit: 25,
          skip: 0,
          maxTimeMS: 5000,
          explain: false
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'A successful bounded query.',
        body: {
          ok: true,
          operation: 'find',
          collection: 'things',
          results: [],
          resultCount: 0,
          durationMs: 4.2,
          truncated: false,
          redactedFields: 0,
          explain: false
        }
      }
    ],
    notes: [
      'This endpoint is an admin diagnostic surface, not an integration API. App data flows should use the higher-level Thingtime endpoints.',
      'Passwords, credentials, secrets, tokens, JWTs, session/roster identifiers, private keys, and credentialed MongoDB URLs are always redacted.',
      'Aggregation and computed projections are disabled for authentication/config collections so a user expression cannot rename a secret before redaction.',
      '$out, $merge, $where, $function, $accumulator, change streams, session inspection, and raw database commands are deliberately unavailable.'
    ]
  }),
  endpoint({
    id: 'mongodb-status',
    group: 'mongodb',
    title: 'MongoDB status',
    endpoint: '/api/v1/mongodb/status',
    summary: 'Returns MongoDB connection status for UI status checks and API tests.',
    detail: 'This route responds with HTTP 200 even when MongoDB is down; the body connected field carries the health state.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. Credentials are sanitized.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Send GET for normal status checks or POST for API tester parity.',
      'Read connected, host, dbName, pingMs, collections, checkedAt, and error.',
      'Treat connected false as a service-health result rather than a failed HTTP request.',
      'Use /api/v1/mongodb/status-data when you need a resource-only JSON endpoint.'
    ],
    requestExamples: [
      {
        name: 'Check MongoDB status',
        description: 'Read connection status.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Connection status.',
        body: { connected: true, host: 'mongodb://localhost:27017/thingtime', dbName: 'thingtime', pingMs: 4 }
      }
    ]
  }),
  endpoint({
    id: 'mongodb-status-data',
    group: 'mongodb',
    title: 'MongoDB status data',
    endpoint: '/api/v1/mongodb/status-data',
    summary: 'Resource-only JSON version of MongoDB status.',
    detail: 'Use this route for plain fetch calls that should never render the in-app API tester component.',
    auth: {
      mode: 'none',
      description: 'Public health endpoint. Credentials are sanitized.'
    },
    methods: ['GET'],
    steps: [
      'Send GET from dashboards, status widgets, or health checks.',
      'Read the same MongoDB connection shape returned by /api/v1/mongodb/status.',
      'Use connected false and error fields for diagnostics.',
      'Prefer this endpoint over /status when a JSON-only resource is required.'
    ],
    requestExamples: [
      {
        name: 'Read MongoDB JSON status',
        description: 'Fetch status data only.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Connection status.',
        body: { connected: false, host: null, dbName: null, pingMs: null, error: 'connect ECONNREFUSED' }
      }
    ]
  }),
  endpoint({
    id: 'template',
    group: 'template',
    title: 'Template action',
    endpoint: '/api/v1/template',
    summary: 'Legacy test/template API action.',
    detail: 'This route is retained as a simple API action harness and returns a predictable JSON message.',
    auth: {
      mode: 'none',
      description: 'Public development/test endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST any JSON object.',
      'Use the response to verify the catch-all route/action plumbing.',
      'Do not build production integrations on this placeholder route.',
      'Use specific API endpoints for real Thingtime operations.'
    ],
    requestExamples: [
      {
        name: 'Call template action',
        description: 'Exercise a simple POST action.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Template response.',
        body: { message: 'Early return triggered in login action: Template API' }
      }
    ]
  }),
	endpoint({
		id: 'attachment-uploads',
		group: 'attachments',
		title: 'Start attachment upload',
		endpoint: '/api/v1/attachments/uploads',
		summary: 'Reserves account storage and starts a private, checksummed S3 multipart upload.',
		detail:
			'Creates a billable pending attachment before S3 accepts any bytes, preventing concurrent uploads from oversubscribing the account storage tier. ' +
			'A client-generated requestId makes ambiguous starts idempotent for the same owner, exact metadata, and purpose. The server derives an owner-scoped opaque attachment id, so another account using the same requestId neither collides nor learns that it exists. The object key and multipart id remain private. Request presigned URLs in bounded batches from /uploads/parts.',
		auth: {
			mode: 'session-or-bearer',
			description:
				'Requires a full revocable user session (httpOnly cookie or its Bearer session JWT); PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'POST a stable random requestId, filename, browser-reported contentType, exact sizeBytes, and the surface purpose: post, comment, message, profile-avatar, profile-banner, or custom-emoji.',
			'Split the file using partSizeBytes; the final part may be smaller.',
			'Compute base64 SHA-256 for each part and request its signed PUT URL.',
			'Abort unused uploads and honor deferred/retryAt while the conservative storage reservation settles.'
		],
		requestExamples: [
			{
				name: 'Reserve a video upload',
				description: 'The MIME value is advisory; final type comes from server-side magic-byte detection.',
				method: 'POST',
				body: {
					requestId: '3bda8208-625c-4f5d-941f-348020021848',
					filename: 'launch.mp4',
					contentType: 'video/mp4',
					sizeBytes: 18874368
				}
			},
			{
				name: 'Reserve a profile avatar',
				description: 'Profile media is limited to a supported raster image of at most 64 MiB.',
				method: 'POST',
				body: {
					requestId: '8de83d1a-898b-45ad-b9a2-caf2a99b27e3',
					filename: 'avatar.webp',
					contentType: 'image/webp',
					sizeBytes: 524288,
					purpose: 'profile-avatar'
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Quota reserved and MPU created.',
				body: {
					ok: true,
					upload: {
						id: 'att_3f9a7d2c5b1e8046a39f12dc7b5e90186d437be2a059c8f1467e3b9d1c4a502e',
						partSizeBytes: 8388608,
						partCount: 3,
						expiresAt: '2026-08-10T00:00:00.000Z'
					}
				}
			},
			{ status: 507, description: 'Storage tier allowance exceeded.', body: { ok: false, error: 'This would exceed the account storage allowance' } }
		],
		notes: [
			'The bucket remains private. Browser uploads use short-lived presigned UploadPart URLs, not public object access.',
			'Post, comment, message, and custom-emoji attachments are unavailable while a custom MongoDB data endpoint is active. Profile media remains home-pinned identity data and may still use the private profile purposes.',
			'Custom emojis accept one GIF, PNG, JPEG, or WebP image up to 512 KiB. Profile media accepts one supported raster image up to 64 MiB.'
		]
	}),
	endpoint({
		id: 'attachment-upload-parts',
		group: 'attachments',
		title: 'Sign attachment parts',
		endpoint: '/api/v1/attachments/uploads/parts',
		summary: 'Issues checksum-locked presigned UploadPart URLs in bounded batches.',
		detail:
			'Each returned URL is short-lived and signs the exact server-derived Content-Length plus x-amz-checksum-sha256 header. The browser uploads the raw slice directly to S3, lets the browser set Content-Length, and must send the returned checksum header unchanged. The server never proxies large file bodies.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires the owning full user session; PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'Compute SHA-256 over each raw file slice and base64-encode the 32-byte digest.',
			'Request at most 20 unique part numbers per call.',
			'PUT each slice to its URL with only the returned checksum header; use a Blob with an empty MIME type.',
			'Retry a failed part by requesting a fresh URL before the upload expires.'
		],
		requestExamples: [
			{
				name: 'Sign two parts',
				description: 'Checksums are illustrative base64 SHA-256 values.',
				method: 'POST',
				body: {
					uploadId: '3bda8208-625c-4f5d-941f-348020021848',
					parts: [
						{ partNumber: 1, checksumSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
						{ partNumber: 2, checksumSha256: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=' }
					]
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Signed part URLs.',
				body: {
					ok: true,
					parts: [
						{
							partNumber: 1,
							url: 'https://example-private-bucket.s3.ap-southeast-2.amazonaws.com/objects/example?...',
							expiresAt: '2026-08-09T00:10:00.000Z',
							headers: { 'x-amz-checksum-sha256': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }
						}
					]
				}
			}
		]
	}),
	endpoint({
		id: 'attachment-upload-complete',
		group: 'attachments',
		title: 'Complete attachment upload',
		endpoint: '/api/v1/attachments/uploads/complete',
		summary: 'Verifies every S3 part and publishes canonical attachment metadata idempotently.',
		detail:
			'The server lists parts itself, requires consecutive numbers, exact expected sizes, ETags, and SHA-256 checksums, then completes and HEAD-verifies the object. ' +
			'It reads only a small prefix to detect an inline-safe raster/video type (AVIF/GIF/JPEG/PNG/WebP images; MP4, WebM, QuickTime, M4V, Ogg, 3GPP, 3GPP2, and Matroska video). ' +
			'Active and generic formats stay application/octet-stream downloads, with the sniffed container preserved as detectedContentType display metadata when one was recognized. Repeating a successful request is safe.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires the owning full user session; PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'Wait for every direct S3 PUT to succeed.',
			'POST the uploadId; do not send browser-trusted ETags or sizes.',
			'Store the returned canonical {id,name,size,contentType,mediaKind} metadata (plus detectedContentType when the object stays a generic download).',
			'Pass the attachment id in attachmentIds when creating its purpose-matched post, comment, message, or custom emoji; profile slots use their dedicated attachment-id fields. The attachmentIds order IS the display order, and PATCH /api/v1/things { id, attachmentIds } later re-sorts a post’s bound set and binds newly uploaded ready drafts appended to it.'
		],
		requestExamples: [
			{
				name: 'Finalize upload',
				description: 'The server derives the part manifest from S3.',
				method: 'POST',
				body: { uploadId: 'att_3f9a7d2c5b1e8046a39f12dc7b5e90186d437be2a059c8f1467e3b9d1c4a502e' }
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Ready attachment metadata.',
				body: {
					ok: true,
					attachment: {
						id: '3bda8208-625c-4f5d-941f-348020021848',
						name: 'launch.mp4',
						size: 18874368,
						contentType: 'video/mp4',
						mediaKind: 'video'
					}
				}
			},
			{
				status: 409,
				description: 'Parts are incomplete; the same MPU can be retried.',
				body: {
					ok: false,
					error: 'Upload parts are incomplete',
					code: 'upload_parts_retryable',
					retryable: true
				}
			}
		]
	}),
	endpoint({
		id: 'attachment-upload-abort',
		group: 'attachments',
		title: 'Cancel attachment upload',
		endpoint: '/api/v1/attachments/uploads/abort',
		summary: 'Cancels an unattached upload and safely schedules its reserved-storage refund.',
		detail:
			'Aborts any open MPU and deletes a completed draft object before removing the billable source record. Because a signed UploadPart may finish after Abort, an MPU that issued a part URL stays billed through a lifecycle-backed settlement window and two separated empty checks; deferred and retryAt report that honestly. An MPU that never issued a part URL can refund promptly after one empty Abort/ListParts/HEAD verification. Missing uploads are an idempotent success. Bound files must be removed through their owning post, comment, message, profile, or custom-emoji lifecycle.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires the owning full user session; PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'POST either the returned upload id or the original requestId when the user removes a draft file or abandons composition; lookup remains owner-scoped.',
			'Treat ok:true as idempotent.',
			'When deferred is true, quota remains reserved until the cleanup job passes retryAt and completes its separated verification.'
		],
		requestExamples: [
			{
				name: 'Cancel draft',
				description: 'Make object bytes inaccessible before refund.',
				method: 'POST',
				body: { uploadId: '3bda8208-625c-4f5d-941f-348020021848' }
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Cancellation recorded; quota remains reserved during safe MPU settlement.',
				body: { ok: true, deferred: true, retryAt: '2026-08-17T00:00:00.000Z' }
			},
			{ status: 200, description: 'Already absent or fully refunded.', body: { ok: true, deferred: false } }
		]
	}),
	endpoint({
		id: 'attachment-annotate',
		featureVersion: '1.1.0',
		group: 'attachments',
		title: 'Annotate attachment',
		endpoint: '/api/v1/attachments/annotate',
		summary: 'Sets or clears an owned ready attachment’s display filename, title, and description.',
		detail:
			'Every attachment is a searchable Thing with its own /media/:id page, comments, and reactions. This owner route edits the presentation metadata that page, post cards, and lightbox render: filenamePreview up to 255 single-line characters, title up to 200, and description up to 2000 characters (newlines allowed). The original filename remains immutable and is still used for downloads. Blank or null clears a field; binding, audience, file bytes, and the parent post are untouched.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires the owning full user session; PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'POST the canonical attachment id with filenamePreview, title, and/or description.',
			'Omit a field to leave it unchanged; send null or an empty string to clear it.',
			'Store the returned attachment metadata (it includes the updated title/description).',
			'Retry a 409 after refreshing — the attachment changed or is still uploading.'
		],
		requestExamples: [
			{
				name: 'Title a photo',
				description: 'Set presentation text on an owned ready attachment.',
				method: 'POST',
				body: {
					id: '3bda8208-625c-4f5d-941f-348020021848',
					filenamePreview: 'Bay sunset.jpg',
					title: 'Sunset over the bay',
					description: 'Shot on the evening walk — the sky went full watermelon. 🍉'
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Updated public metadata.',
				body: {
					ok: true,
					attachment: {
						id: '3bda8208-625c-4f5d-941f-348020021848',
						name: 'sunset.jpg',
						size: 482133,
						contentType: 'image/jpeg',
						mediaKind: 'image',
						title: 'Sunset over the bay',
						description: 'Shot on the evening walk — the sky went full watermelon. 🍉'
					}
				}
			}
		]
	}),
	endpoint({
		id: 'attachment-link',
		group: 'attachments',
		title: 'Link external media',
		endpoint: '/api/v1/attachments/link',
		summary: 'Mints a ready linked-attachment draft from an external media URL.',
		detail:
			'A linked attachment is a first-class attachment Thing whose bytes stay on the original site: the crystal carries the external http(s) URL and clients render it directly (image tile, video player, or file row with an outbound download link). It binds into posts and rich comments through the same attachmentIds flows as uploads, reorders and annotates identically, and never touches Thingtime object storage or the upload-approval gate — only the metadata document counts toward the owner’s quota. The server derives contentType and a render hint from the URL’s file extension; a client may demote the hint to a plain file after a failed load probe, but can never promote a file extension to a visual kind. Duplicate URLs are allowed — each mint is its own attachment. Unbound mints expire on the standard 24-hour draft TTL. The server never fetches the URL.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires the owning full user session; PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'POST the external http(s) media URL (up to 2048 characters).',
			'Optionally send purpose ("post" default, or "comment") so the draft binds to the right surface, and mediaKind to demote an extensionless URL to "file".',
			'Store the returned attachment id and url — the id goes into attachmentIds on post create or edit exactly like an uploaded attachment.',
			'Remove an unwanted mint with /api/v1/attachments/delete; unbound mints expire on their own after 24 hours.'
		],
		requestExamples: [
			{
				name: 'Link a photo by URL',
				description: 'Mint a ready linked attachment for an external image.',
				method: 'POST',
				body: {
					url: 'https://example.com/photos/sunset.jpg'
				}
			},
			{
				name: 'Link a document for a comment',
				description: 'A file-extension URL lands in the file row UI with an outbound download link.',
				method: 'POST',
				body: {
					url: 'https://example.com/papers/spec.pdf',
					purpose: 'comment'
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'The minted linked attachment’s public metadata.',
				body: {
					ok: true,
					attachment: {
						id: '9c1f5f68-3f0a-45f2-8f60-6f4a70b1a001',
						name: 'sunset.jpg',
						size: 0,
						contentType: 'image/jpeg',
						mediaKind: 'image',
						url: 'https://example.com/photos/sunset.jpg'
					}
				}
			}
		]
	}),
	endpoint({
		id: 'attachment-delete',
		featureVersion: '1.1.0',
		group: 'attachments',
		title: 'Delete attachment',
		endpoint: '/api/v1/attachments/delete',
		summary: 'Deletes an owned attachment object before refunding its storage.',
		detail:
			'This explicit owner route is idempotent. Unbound drafts accept id alone. An already-bound post or comment attachment requires its exact targetId, preventing an ambiguous cleanup retry from deleting media after a lost successful post response. Completed objects persist their opaque S3 VersionId, and deletion removes that exact version before refunding quota.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires the owning full user session; PAT, app, and service-account tokens are rejected.'
		},
		methods: ['POST'],
		steps: [
			'POST the canonical attachment id; include the exact targetId when deleting from an existing post or comment.',
			'On success, remove it from local draft state.',
			'Retry a temporary 503; the source row stays charged until S3 deletion succeeds.'
		],
		requestExamples: [
			{
				name: 'Delete file',
				description: 'Delete one owned attachment.',
				method: 'POST',
				body: { id: '3bda8208-625c-4f5d-941f-348020021848', targetId: 'post_123' }
			}
		],
		responseExamples: [{ status: 200, description: 'Attachment absent.', body: { ok: true } }]
	}),
	endpoint({
		id: 'attachment-content',
		group: 'attachments',
		title: 'Read attachment content',
		endpoint: '/api/v1/attachments/content',
		summary: 'Authorizes a stable same-origin attachment URL and redirects to short-lived private S3 content.',
		detail:
			'Owners may read live unattached drafts. Bound content is purpose-authorized against the exact target: post/comment ACL inheritance, active or pending chat membership, the current public profile slot, or the current personal/community emoji reference. The bucket never becomes public. ' +
			'Only magic-byte-verified inline-safe types may render inline: AVIF/GIF/JPEG/PNG/WebP images and MP4/WebM/QuickTime/M4V/Ogg/3GPP/3GPP2/Matroska video. Add download=1 to force attachment/octet-stream for every type.',
		auth: {
			mode: 'optional',
			description:
				'Anonymous access works only for a publicly viewable post/comment or public profile slot. Messages and custom emojis require an authenticated eligible viewer.'
		},
		methods: ['GET'],
		steps: [
			'GET with id; optionally add download=1.',
			'Follow the 302 to the short-lived private object URL.',
			'Use the same stable endpoint again after expiry; never persist the presigned target.',
			'Treat 404 uniformly for missing and unauthorized attachments.'
		],
		requestExamples: [
			{
				name: 'Inline-safe content',
				description: 'Render only if the server-vetted mediaKind is image/video.',
				method: 'GET',
				query: { id: '3bda8208-625c-4f5d-941f-348020021848' }
			},
			{
				name: 'Force download',
				description: 'Download any file as opaque bytes.',
				method: 'GET',
				query: { id: '3bda8208-625c-4f5d-941f-348020021848', download: 1 }
			}
		],
		responseExamples: [
			{
				status: 302,
				description: 'Authorized short-lived S3 redirect.',
				headers: {
					'Cache-Control': 'private, no-store, max-age=0',
					Location: 'https://example-private-bucket.s3.ap-southeast-2.amazonaws.com/objects/example?...'
				}
			},
			{ status: 404, description: 'Missing or unauthorized.', body: { ok: false, error: 'Attachment not found' } }
		]
	}),
	endpoint({
		id: 'attachment-cleanup',
		group: 'attachments',
		title: 'Reap expired attachment drafts',
		endpoint: '/api/v1/attachments/cleanup',
		summary: 'Internal hourly job that deletes expired private objects before refunding reserved storage.',
		detail:
			'Vercel Cron calls this bounded, idempotent GET at minute 17 each hour. It scans at most 1,000 cleanup intents in expiry order with five workers and a 25-second wall-clock budget. Pending multipart cancellations that issued a part URL stay billed through an eight-day lifecycle-backed settlement window, then require two empty Abort/ListParts checks at least one hour apart before HEAD verification, exact-version deletion, and refund. MPUs with no issued part URL can refund after one empty verification. Deleting tombstones remain sweepable even after a post cascade crash. ' +
			'There is no session, PAT, app-token, or service-account fallback.',
		auth: {
			mode: 'bearer',
			description: 'Requires the exact Vercel cron Authorization header derived from the private CRON_SECRET deployment variable.'
		},
		methods: ['GET'],
		steps: [
			'Configure CRON_SECRET only in the deployment environment.',
			'Let the hourly Vercel schedule invoke this endpoint; clients do not call it.',
			'Monitor failed; a later invocation safely retries rows that remain conservatively charged.'
		],
		requestExamples: [
			{
				name: 'Scheduled cleanup',
				description: 'Vercel supplies the private Authorization header automatically.',
				method: 'GET'
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'One bounded cleanup pass.',
				body: {
					ok: true,
					scanned: 12,
					deleted: 9,
					deferred: 1,
					skipped: 1,
					failed: 1,
					hasMore: false,
					stoppedForTimeBudget: false
				}
			},
			{ status: 401, description: 'Missing or inexact cron authorization.', body: { ok: false, error: 'Unauthorized' } }
		],
		notes: ['No response or log contains the cron secret. Mongo TTL deletion is intentionally disabled.']
	}),
	endpoint({
		id: 'attachment-detection-backfill',
		group: 'attachments',
		title: 'Backfill sniffed attachment types',
		endpoint: '/api/v1/attachments/backfill-detected-types',
		summary: 'Admin-only sweep that re-runs magic-byte detection for ready attachments finalized before detection existed.',
		detail:
			'Ready attachments completed before server-side magic-byte sniffing keep crystal contentType application/octet-stream with no detectedContentType, so browser-playable uploads still render as opaque file cards. Each pass scans those legacy rows in shareId order and publishes exactly what completion would have: browser-playable containers flip to their inline contentType and mediaKind, other canonical sniffed types gain detectedContentType display metadata, and undetectable bytes stay untouched so a later pass under a wider detector can still claim them. Names, byte sizes, object keys, and object versions never change. ' +
			'Every pass is bounded (at most 200 rows, five workers, a 25-second wall-clock budget) and idempotent — upgraded rows leave the candidate set, so repeated real passes converge. Follow nextCursor while hasMore is true to walk the full backlog; the cursor is required for dry runs, which write nothing and would otherwise rescan the same rows.',
		auth: {
			mode: 'session-or-bearer',
			description:
				'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403. Same-origin JSON requests only.'
		},
		methods: ['POST'],
		steps: [
			'POST { dryRun: true } first to count what one pass would change without writing.',
			'POST {} (or { dryRun: false }) to apply one bounded pass for real.',
			'While hasMore is true, POST again with the returned nextCursor.',
			'Watch upgradedInline and labeledOpaque against undetected, missingObject, conflicts, and failed in each report.'
		],
		requestExamples: [
			{
				name: 'Dry-run one pass',
				description: 'Counts the legacy rows one pass would upgrade, writing nothing.',
				method: 'POST',
				body: { dryRun: true }
			},
			{
				name: 'Apply with a cursor',
				description: 'Continues the sweep after a previous pass reported hasMore.',
				method: 'POST',
				body: { cursor: 'att_2f6b0c1d', limit: 200 }
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'One bounded backfill pass.',
				body: {
					ok: true,
					dryRun: false,
					scanned: 42,
					upgradedInline: 17,
					labeledOpaque: 3,
					undetected: 21,
					missingObject: 0,
					conflicts: 1,
					failed: 0,
					hasMore: false,
					stoppedForTimeBudget: false
				}
			},
			{ status: 403, description: 'Signed-in non-admin.', body: { ok: false, error: 'Admins only' } }
		],
		notes: [
			'Detection reads only the first 8 KiB of each object from private S3; nothing is re-uploaded and object-byte storage accounting is unchanged.',
			'Unavailable while a custom MongoDB data endpoint is active — run it on the canonical deployment.'
		]
	}),
	endpoint({
		id: 'moderation-sweep',
		group: 'admin',
		title: 'Scheduled moderation sweep',
		endpoint: '/api/v1/moderation/sweep',
		featureVersion: '1.1.0',
		summary: 'Internal hourly starter that retries moderation the async kickoffs lost, then self-drains remaining successful batches.',
		detail:
			'Vercel Cron calls this bounded, idempotent GET at minute 29 each hour. The text pass analyzes a batch of post-family things that carry real text but no moderation stamp (the fire-and-forget kickoff died mid-flight, the provider was down, or the doc predates text moderation being enabled) — it no-ops when the text surface is off, because in off mode an absent stamp is deliberate. The attachment pass runs the same bounded sweep as the admin Moderation tab. When either surface completes a full failure-free batch, the route starts a durable Vercel Workflow that continues one bounded batch at a time immediately; the workflow stops at a short batch or any failure. Failures stay unstamped and retry on the next hourly cron. There is no session, PAT, app-token, or service-account fallback.',
		auth: {
			mode: 'bearer',
			description: 'Requires the exact Vercel cron Authorization header derived from the private CRON_SECRET deployment variable.'
		},
		methods: ['GET'],
		steps: [
			'Configure CRON_SECRET only in the deployment environment.',
			'Let the hourly Vercel schedule invoke this endpoint; clients do not call it.',
			'Monitor failed counts; a full failure-free batch immediately starts a durable continuation, while later hourly invocations safely retry anything still unstamped.'
		],
		requestExamples: [
			{
				name: 'Scheduled sweep',
				description: 'Vercel supplies the private Authorization header automatically.',
				method: 'GET'
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'One bounded sweep pass; continuationRunId is set when a durable self-draining workflow was started.',
				body: {
					ok: true,
					text: { scanned: 3, analyzed: 3, flagged: 1, failed: 0, skippedOff: false },
					attachments: { scanned: 2, analyzed: 1, flagged: 0, skipped: 1, failed: 0 },
					continuationRunId: 'wrun_01moderationsweepexample'
				}
			},
			{ status: 401, description: 'Missing or inexact cron authorization.', body: { ok: false, error: 'Unauthorized' } }
		],
		notes: ['No response or log contains the cron secret. Free omni text screening makes draining the off-era backlog costless.']
	}),
  endpoint({
    id: 'themes',
    group: 'themes',
    title: 'Themes',
    endpoint: '/api/v1/themes',
    summary: 'Lists or saves themes for the authenticated user.',
    detail: 'Theme records let Thingtime users save and share visual configurations. Reads and writes require an authenticated user.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with credentials to list themes owned by the current user.',
      'POST name, theme, and optional visibility to create or update a theme.',
      'Include id in POST only when updating one of the caller-owned themes.',
      'Keep theme payloads below 64 KiB.'
    ],
    requestExamples: [
      {
        name: 'List themes',
        description: 'Read saved themes for the current account.',
        method: 'GET'
      },
      {
        name: 'Save private theme',
        description: 'Create a theme owned by the current account.',
        method: 'POST',
        body: {
          name: 'Launch dark',
          visibility: 'private',
          theme: { colors: { accent: '#008060', background: '#0f172a' } }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Themes listed.',
        body: { ok: true, themes: [] }
      },
      {
        status: 401,
        description: 'No authenticated user.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'themes-active',
    group: 'themes',
    title: 'Active theme',
    endpoint: '/api/v1/themes/active',
    summary: 'Sets or clears the current user active theme.',
    detail: 'Use this endpoint to make a saved or shared theme follow the user across browsers and devices.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST themeId as a string to set an active theme, or null to clear it.',
      'The theme must be owned by the user or publicly shared.',
      'Read activeThemeId from the response and update the local theme state.',
      'Handle 401 unauthenticated, 400 invalid themeId, and 404 missing theme.'
    ],
    requestExamples: [
      {
        name: 'Set active theme',
        description: 'Activate a saved or shared theme.',
        method: 'POST',
        body: { themeId: 'theme_123' }
      },
      {
        name: 'Clear active theme',
        description: 'Return the user to default theme resolution.',
        method: 'POST',
        body: { themeId: null }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active theme updated.',
        body: { ok: true, activeThemeId: 'theme_123' }
      }
    ]
  }),
  endpoint({
    id: 'themes-delete',
    group: 'themes',
    title: 'Delete theme',
    endpoint: '/api/v1/themes/delete',
    summary: 'Deletes a theme owned by the current user.',
    detail: 'Use this route for explicit user deletion actions. It does not delete themes owned by other users.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the theme id to delete.',
      'The current user must own the theme.',
      'On success, remove the theme from local UI state.',
      'Handle 401 unauthenticated and 404 not found or not owned.'
    ],
    requestExamples: [
      {
        name: 'Delete theme',
        description: 'Delete a caller-owned theme.',
        method: 'POST',
        body: { id: 'theme_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Theme deleted.',
        body: { ok: true }
      },
      {
        status: 404,
        description: 'Theme not found for this user.',
        body: { ok: false, error: 'Theme not found' }
      }
    ]
  }),
  endpoint({
    id: 'themes-shared',
    group: 'themes',
    title: 'Shared theme',
    endpoint: '/api/v1/themes/shared',
    summary: 'Reads a shared theme by id, or lists the public theme gallery without one.',
    detail:
      'Anonymous callers can read public shared themes. Authenticated owners can also read their own private themes by id. Omitting id returns the public gallery: every public theme, newest-updated first, capped at 60 (optional limit query lowers it).',
    auth: {
      mode: 'optional',
      description: 'Anonymous public reads are allowed; auth cookie or bearer token can reveal caller-owned private themes.'
    },
    methods: ['GET'],
    steps: [
      'Send id as a query parameter for a single theme, or omit it to list the public gallery.',
      'Use the returned theme(s) to preview or apply a shared visual configuration.',
      'Treat 404 as not found without assuming whether a private theme exists.',
      'Authenticate only when reading one of your own private themes by id.'
    ],
    requestExamples: [
      {
        name: 'Read shared theme',
        description: 'Fetch a public shared theme.',
        method: 'GET',
        query: { id: 'theme_123' }
      },
      {
        name: 'List the public gallery',
        description: 'Fetch every public theme, newest first.',
        method: 'GET',
        query: { limit: '24' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Theme found.',
        body: { ok: true, theme: { id: 'theme_123', name: 'Launch dark', visibility: 'public' } }
      },
      {
        status: 404,
        description: 'No public or caller-owned theme found.',
        body: { ok: false, error: 'Theme not found' }
      }
    ]
  }),
  endpoint({
    id: 'ai-connections',
    group: 'messenger',
    title: 'AI desktop connections',
    endpoint: '/api/v1/ai/connections',
    summary: 'Lists linked ChatGPT/Claude sources or imports one idempotent Messenger sync batch.',
    detail:
      'GET lists the authenticated account’s consented AI desktop sources and latest completed counts. POST ' +
      'accepts one bounded application/json batch from the Thingtime desktop bridge. External projects or ' +
      'workspaces become private communities, their conversations become private channels, ungrouped ' +
      'conversations become named group chats, and messages become relational chat-message Things. Provider ' +
      'credentials, cookies, raw local paths, hidden reasoning and tool traffic are never accepted. Stable ' +
      'server-hashed source keys make every batch safe to retry. Provider history is read-only; replies stay ' +
      'inside Thingtime.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires a full Thingtime user account via auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Discover and approve a source in the signed Thingtime desktop app.',
      'Send project records before their conversations and conversation records before their messages.',
      'Keep each batch within 80 projects, 120 conversations, 240 messages and the 768 KiB body cap.',
      'Set final true and include source totals on the last batch.',
      'Retry an interrupted batch unchanged; source hashes prevent duplicate communities, chats, or messages.'
    ],
    requestExamples: [
      {
        name: 'Import one Claude batch',
        description: 'Creates a project channel and its first imported message.',
        method: 'POST',
        body: {
          source: {
            provider: 'claude',
            sourceId: 'claude-thingtime',
            label: 'Claude Thingtime',
            connector: 'claude-code-local',
            mode: 'local'
          },
          groups: [{ id: 'project_01', name: 'Thingtime', kind: 'project' }],
          conversations: [{ id: 'conversation_01', title: 'Messenger bridge', groupId: 'project_01' }],
          messages: [
            {
              id: 'message_01',
              conversationId: 'conversation_01',
              role: 'assistant',
              authorName: 'Claude',
              text: 'The bridge is ready.'
            }
          ],
          final: true,
          totals: { groups: 1, conversations: 1, messages: 1 }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Batch accepted and connection status updated.',
        body: {
          ok: true,
          connection: {
            provider: 'claude',
            sourceId: 'claude-thingtime',
            label: 'Claude Thingtime',
            status: 'connected',
            readOnly: true,
            groups: 1,
            conversations: 1,
            messages: 1
          },
          accepted: { groups: 1, conversations: 1, messages: 1, messageSegments: 1 }
        }
      },
      {
        status: 409,
        description: 'A batch arrived before a referenced parent record.',
        body: { ok: false, error: 'An imported message arrived before its conversation; retry the sync batch' }
      }
    ],
    notes: [
      'POST requires application/json and draws from the ai.sync rate-limit bucket (600 batches per hour).',
      'Message text over the native chat cap is split into ordered, idempotent segments.'
    ]
  }),
  endpoint({
    id: 'chats',
    group: 'messenger',
    title: 'Chats',
    endpoint: '/api/v1/chats',
    summary: 'Lists every conversation the caller is in, or creates a channel, group, or DM.',
    detail:
      'GET returns every conversation the caller belongs to — community channels, groups, and DMs — each with an ' +
      'unread count, a lastMessage preview, and the caller membership entry (role, nickname, state, muted, read ' +
      'receipt), plus totalUnread (muted chats excluded), requestsCount, and serverTime. POST creates a chat: ' +
      'channels live inside a community, groups are free-floating, and DMs take exactly one memberId and are ' +
      'deduped per pair, so re-opening an existing DM returns it with existing: true. A fresh DM — and every ' +
      'group invite — lands as a message request for the recipient unless they already follow the creator; ' +
      'pending requests are bucketed follower when the creator follows them and unknown otherwise. Channel ' +
      'invitees must already be community members.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with credentials to list chats, unread counts, and lastMessage previews.',
      'POST chatType channel, group, or dm, with name, topic, communityId, sectionId, channelVisibility, or memberIds as needed.',
      'For a DM send exactly one memberId and check existing: true before treating the chat as new.',
      'Use totalUnread and requestsCount from GET to drive badges without extra requests.',
      'Poll /api/v1/chats/updates for the same payload when watching for new messages.'
    ],
    requestExamples: [
      {
        name: 'List chats',
        description: 'Read every conversation for the current account.',
        method: 'GET'
      },
      {
        name: 'Create a group',
        description: 'Start a named group chat with two other members.',
        method: 'POST',
        body: {
          chatType: 'group',
          name: 'Weekend plans',
          memberIds: ['c0ffee12-cccc-4ccc-8ccc-000000000003', 'c0ffee12-cccc-4ccc-8ccc-000000000004']
        }
      },
      {
        name: 'Start a DM',
        description: 'Open (or reuse) the direct conversation with one user.',
        method: 'POST',
        body: { chatType: 'dm', memberIds: ['c0ffee12-cccc-4ccc-8ccc-000000000003'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Chats listed.',
        body: {
          ok: true,
          chats: [
            {
              id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
              chatType: 'group',
              name: 'Weekend plans',
              unreadCount: 2,
              lastMessage: {
                id: 'c0ffee12-bbbb-4bbb-8bbb-000000000002',
                text: 'See you there',
                senderId: 'c0ffee12-cccc-4ccc-8ccc-000000000003'
              },
              myMember: { role: 'member', nickname: null, state: 'active', muted: false }
            }
          ],
          totalUnread: 2,
          requestsCount: 1,
          serverTime: '2026-08-03T10:15:00.000Z'
        }
      },
      {
        status: 400,
        description: 'DM created without exactly one memberId.',
        body: { ok: false, error: 'A DM needs exactly one memberId' }
      }
    ],
    notes: ['Chat creation draws from the chats.write rate-limit bucket (60 requests per minute).']
  }),
  endpoint({
    id: 'chats-get',
    group: 'messenger',
    title: 'Chat detail',
    endpoint: '/api/v1/chats/get',
    summary: 'Reads one chat with its full member list.',
    detail:
      'Returns a single chat by id along with every member — profile, role, nickname, and per-member read ' +
      'receipt — plus communityName for channels. Read receipts follow the privacy parity rule: a member who ' +
      'turned receipts off neither shares a reading position nor sees the positions of others. Only members of ' +
      'the chat can read it; everyone else gets a 403.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET'],
    steps: [
      'Send the chat id as a query parameter.',
      'Render members with their roles, nicknames, and read receipts.',
      'Use communityName to label channels with their parent community.',
      'Handle 403 when the caller is not a member of the chat.'
    ],
    requestExamples: [
      {
        name: 'Read a chat',
        description: 'Fetch one chat and its member list.',
        method: 'GET',
        query: { id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Chat found.',
        body: {
          ok: true,
          chat: {
            id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
            chatType: 'channel',
            name: 'general',
            communityName: 'Thingtime HQ'
          },
          members: [
            {
              user: { id: 'c0ffee12-cccc-4ccc-8ccc-000000000003', username: 'ada-lovelace' },
              role: 'owner',
              nickname: null,
              lastReadMessageId: 'c0ffee12-bbbb-4bbb-8bbb-000000000002'
            }
          ]
        }
      },
      {
        status: 403,
        description: 'Caller is not a member of this chat.',
        body: { ok: false, error: 'Not a member of this chat' }
      }
    ]
  }),
  endpoint({
    id: 'chats-update',
    group: 'messenger',
    title: 'Update chat',
    endpoint: '/api/v1/chats/update',
    summary: 'Renames a chat or updates its topic, section, or channel visibility.',
    detail:
      'Groups follow the Messenger convention: any member may rename them. Channels are stricter — only chat or ' +
      'community admins may change them, and channel names are slugged to lowercase. DMs have nothing to rename ' +
      'and return 400. Renames and topic changes insert a system message into the chat so the history explains ' +
      'itself.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the chat id with any of name, topic, sectionId, or channelVisibility.',
      'Expect channel names to come back slugged to lowercase.',
      'Let the inserted system message tell the room what changed — no extra announcement needed.',
      'Handle 400 for DMs and 403 when a non-admin edits a channel.'
    ],
    requestExamples: [
      {
        name: 'Rename a group',
        description: 'Any member may rename a group chat.',
        method: 'POST',
        body: { id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001', name: 'Weekend plans v2' }
      },
      {
        name: 'Move a channel into a section',
        description: 'Admins file a channel under a community section.',
        method: 'POST',
        body: { id: 'c0ffee12-aaaa-4aaa-8aaa-000000000002', sectionId: 'c0ffee12-eeee-4eee-8eee-000000000005' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Chat updated.',
        body: { ok: true, chat: { id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001', name: 'Weekend plans v2' } }
      },
      {
        status: 400,
        description: 'DMs cannot be renamed.',
        body: { ok: false, error: 'DMs cannot be updated' }
      }
    ],
    notes: ['Shares the chats.write rate-limit bucket (60 requests per minute).']
  }),
  endpoint({
    id: 'chats-members',
    group: 'messenger',
    title: 'Chat members',
    endpoint: '/api/v1/chats/members',
    summary: 'Manages chat membership with one verb per call: join, add, remove, role, nickname, or mute.',
    detail:
      'POST the chatId plus exactly one verb. join: true joins a public channel of a community you belong to. ' +
      'add lists user ids to bring in (any member may add to a group; private channels need an admin, and everyone ' +
      'added to a channel must already be a community member — channel access never outruns the invite gate). ' +
      'remove takes one userId (admins only; the owner cannot be removed; DMs refuse remove and role outright). ' +
      'role promotes or demotes between admin and member (admins only). nickname sets a Messenger-style nickname ' +
      'for yourself or another member (any member; null clears it). mute toggles your own notifications for the ' +
      'chat. Rejoining after leaving always lands as a plain member. Every verb returns the refreshed member list.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST chatId plus exactly one verb — join, add, remove, role, nickname, or mute.',
      'Use join: true for public channels in communities you belong to.',
      'Use add for groups and private channels, respecting the admin rules.',
      'Read the returned members array as the new source of truth.',
      'Handle 403 when the verb needs a role the caller does not have.'
    ],
    requestExamples: [
      {
        name: 'Join a public channel',
        description: 'Join a public channel of a community you are in.',
        method: 'POST',
        body: { chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000002', join: true }
      },
      {
        name: 'Add members',
        description: 'Bring more users into a group.',
        method: 'POST',
        body: { chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001', add: ['c0ffee12-cccc-4ccc-8ccc-000000000004'] }
      },
      {
        name: 'Set a nickname',
        description: 'Give a member a Messenger-style nickname.',
        method: 'POST',
        body: {
          chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
          nickname: { userId: 'c0ffee12-cccc-4ccc-8ccc-000000000003', nickname: 'Captain' }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Membership updated.',
        body: {
          ok: true,
          members: [
            {
              user: { id: 'c0ffee12-cccc-4ccc-8ccc-000000000003', username: 'ada-lovelace' },
              role: 'admin',
              nickname: 'Captain'
            }
          ]
        }
      },
      {
        status: 403,
        description: 'Verb requires a role the caller does not have.',
        body: { ok: false, error: 'Only admins can remove members' }
      }
    ],
    notes: ['Shares the chats.write rate-limit bucket (60 requests per minute).']
  }),
  endpoint({
    id: 'chats-leave',
    group: 'messenger',
    title: 'Leave chat',
    endpoint: '/api/v1/chats/leave',
    summary: 'Leaves a group or channel.',
    detail:
      'Removes the caller from a group or channel; DMs cannot be left. When the departing member is the owner, ' +
      'ownership auto-promotes the earliest admin, or the earliest remaining member when no admin exists, so a ' +
      'chat never ends up ownerless.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the chatId to leave.',
      'Expect ownership to pass automatically when the owner departs.',
      'Rejoin public channels at any time via /api/v1/chats/members with join: true.',
      'Handle 400 when trying to leave a DM.'
    ],
    requestExamples: [
      {
        name: 'Leave a chat',
        description: 'Depart a group or channel.',
        method: 'POST',
        body: { chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Left the chat.',
        body: { ok: true }
      },
      {
        status: 400,
        description: 'DMs cannot be left.',
        body: { ok: false, error: 'You cannot leave a DM' }
      }
    ]
  }),
  endpoint({
    id: 'chats-messages',
    group: 'messenger',
    title: 'Chat messages',
    endpoint: '/api/v1/chats/messages',
    summary: 'Reads a page of messages or sends a new one, including Slack-style thread replies.',
    detail:
      'GET pages a chat newest-first with cursor and limit (max 100, default 40); pass threadRootId to scope the ' +
      'page to one thread. The response bundles customEmojis (a map of id to name, image, and animated for any ' +
      'custom reaction tokens on the page), nextCursor, threadRoot, members, chat, and myMember so one request ' +
			'can paint a conversation. POST sends optional text up to 4000 characters plus as many as 25 purpose-matched private attachments, with optional threadRootId or replyToId. ' +
			'Attachment messages require a stable client requestId; message insertion, exact attachment binding, pending-request acceptance, preview, and read receipt commit in one home transaction. ' +
			'Replies and thread messages use the same contract. Every projected attachment contains stable metadata and a same-origin content path, never an S3 key or presigned URL.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with chatId, plus cursor and limit to page older messages newest-first.',
      'Pass threadRootId to read or post inside a single thread.',
			'POST chatId and optional text (4000 characters max), with replyToId for inline replies.',
			'For files, first finish purpose=message uploads, then POST their attachmentIds plus one stable requestId. An attachment-only message is valid.',
      'Resolve custom:<emojiId> reaction tokens through the returned customEmojis map.',
      'Follow nextCursor until it is null to reach the start of history.'
    ],
    requestExamples: [
      {
        name: 'Read messages',
        description: 'First page of a conversation, newest first.',
        method: 'GET',
        query: { chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001', limit: 40 }
      },
      {
        name: 'Send a message',
        description: 'Post a message to the chat.',
        method: 'POST',
				body: {
					chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
					text: 'Shipping the messenger docs today.',
					requestId: '9f59e32b-9509-43ef-9a0f-abde27b6d79c',
					attachmentIds: ['att_3f9a7d2c5b1e8046a39f12dc7b5e90186d437be2a059c8f1467e3b9d1c4a502e']
				}
      },
      {
        name: 'Reply in a thread',
        description: 'Post into a Slack-style thread under one root message.',
        method: 'POST',
        body: {
          chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
          text: 'Continuing this in the thread.',
          threadRootId: 'c0ffee12-bbbb-4bbb-8bbb-000000000002'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Messages listed.',
        body: {
          ok: true,
          messages: [
            {
              id: 'c0ffee12-bbbb-4bbb-8bbb-000000000002',
              senderId: 'c0ffee12-cccc-4ccc-8ccc-000000000003',
              text: 'See you there',
							attachments: [],
              createdAt: '2026-08-03T10:14:00.000Z'
            }
          ],
          customEmojis: {},
          nextCursor: null,
          threadRoot: null,
					members: [{ user: { id: 'c0ffee12-cccc-4ccc-8ccc-000000000003', username: 'ada-lovelace' }, role: 'member' }],
          chat: { id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001', chatType: 'group', name: 'Weekend plans' },
          myMember: { role: 'member', muted: false }
        }
      },
      {
        status: 403,
        description: 'Caller is not a member of this chat.',
        body: { ok: false, error: 'Not a member of this chat' }
      }
    ],
		notes: [
			'Sending draws from the chats.message rate-limit bucket (120 messages per minute).',
			'Message rows are server-managed conversation plumbing; uploaded object bytes are billed exactly once through their attachment Things and refunded only after exact-version S3 deletion.',
			'Browser attachment sends require same-origin JSON and a full user account. Text-only session/Bearer clients retain the existing contract.'
		]
  }),
  endpoint({
    id: 'chats-messages-edit',
    group: 'messenger',
    title: 'Edit message',
    endpoint: '/api/v1/chats/messages/edit',
    summary: 'Edits the text of a message the caller sent.',
    detail:
      'Only the author can edit a message. The new text replaces the old and the message is stamped with ' +
			'editedAt so clients can show an edited marker. The 4000-character limit applies just as it does on send. Text may be empty only while at least one existing attachment remains.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the message id and the replacement text.',
      'Only the author of the message may edit it.',
      'Show the editedAt stamp so readers know the message changed.',
      'Handle 403 when editing a message someone else sent.'
    ],
    requestExamples: [
      {
        name: 'Edit a message',
        description: 'Replace the text of an own message.',
        method: 'POST',
        body: { id: 'c0ffee12-bbbb-4bbb-8bbb-000000000002', text: 'See you there at 7pm' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Message edited.',
        body: {
          ok: true,
          message: {
            id: 'c0ffee12-bbbb-4bbb-8bbb-000000000002',
            text: 'See you there at 7pm',
            editedAt: '2026-08-03T10:20:00.000Z'
          }
        }
      },
      {
        status: 403,
        description: 'Only the author can edit a message.',
        body: { ok: false, error: 'Only the author can edit this message' }
      }
    ]
  }),
  endpoint({
    id: 'chats-messages-delete',
    group: 'messenger',
    title: 'Delete message',
    endpoint: '/api/v1/chats/messages/delete',
    summary: 'Soft-deletes a message, leaving a placeholder in the history.',
    detail:
      'The author or a chat admin can delete a message. Deletion is soft: the row stays as a placeholder, its ' +
			'text is cleared, and its reactions are removed, so conversation flow and reply anchors survive. Every bound object version is permanently deleted before its attachment row is removed and account quota is refunded.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the message id to delete.',
      'The author or a chat admin may delete; anyone else gets a 403.',
			'Wait for exact-version attachment cleanup and quota refund before the placeholder is committed.',
      'Render the surviving placeholder row as a deleted-message marker.',
      'Expect reactions on the message to be removed with it.'
    ],
    requestExamples: [
      {
        name: 'Delete a message',
        description: 'Soft-delete one message.',
        method: 'POST',
        body: { id: 'c0ffee12-bbbb-4bbb-8bbb-000000000002' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Message soft-deleted.',
        body: { ok: true }
      },
      {
        status: 403,
        description: 'Caller is neither the author nor a chat admin.',
        body: { ok: false, error: 'Not allowed to delete this message' }
      }
    ]
  }),
  endpoint({
    id: 'chats-react',
    group: 'messenger',
    title: 'React to message',
    endpoint: '/api/v1/chats/react',
    summary: 'Toggles an emoji reaction on a message.',
    detail:
      'POST a messageId and an emoji token to add the reaction, or again to remove it. The token is either a ' +
      'unicode emoji (the same grammar post reactions use) or custom:<emojiId> referencing an uploaded custom ' +
      'emoji from the community this chat belongs to or from your personal set. The response returns the ' +
      'refreshed reactionCounts, your own viewerReactions, and a customEmojis map for rendering custom tokens.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST messageId and an emoji token to toggle a reaction.',
      'Use a unicode emoji or custom:<emojiId> for uploaded custom emojis.',
      'Render counts from reactionCounts and highlight viewerReactions.',
      'Resolve custom tokens through the returned customEmojis map.'
    ],
    requestExamples: [
      {
        name: 'React with unicode',
        description: 'Toggle a plain emoji reaction.',
        method: 'POST',
        body: { messageId: 'c0ffee12-bbbb-4bbb-8bbb-000000000002', emoji: '🎉' }
      },
      {
        name: 'React with a custom emoji',
        description: 'Toggle an uploaded custom emoji by id.',
        method: 'POST',
        body: {
          messageId: 'c0ffee12-bbbb-4bbb-8bbb-000000000002',
          emoji: 'custom:c0ffee12-ffff-4fff-8fff-000000000006'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Reaction toggled.',
        body: {
          ok: true,
          reactionCounts: { '🎉': 3, 'custom:c0ffee12-ffff-4fff-8fff-000000000006': 1 },
          viewerReactions: ['🎉'],
          customEmojis: {
            'c0ffee12-ffff-4fff-8fff-000000000006': {
              name: 'party-blob',
              image: 'data:image/gif;base64,R0lGODlh...',
              animated: true
            }
          }
        }
      },
      {
        status: 404,
        description: 'Message not found or not visible to the caller.',
        body: { ok: false, error: 'Message not found' }
      }
    ],
    notes: ['Reactions draw from the chats.react rate-limit bucket (120 requests per minute).']
  }),
  endpoint({
    id: 'chats-read',
    group: 'messenger',
    title: 'Read receipt',
    endpoint: '/api/v1/chats/read',
    summary: 'Advances the current user read receipt in a chat.',
    detail:
      'POST chatId and the newest messageId you have displayed. The receipt is a forward-only high-water mark: ' +
      'attempts to move it backwards are ignored. It drives unread counts everywhere and the seen-by indicators ' +
      'other members see, subject to the read-receipt privacy setting.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST chatId and the id of the newest message on screen.',
      'Call as the user scrolls; the mark only ever moves forward.',
      'Expect unread counts in /api/v1/chats to drop accordingly.',
      'Handle 403 when the caller is not a member of the chat.'
    ],
    requestExamples: [
      {
        name: 'Mark read',
        description: 'Advance the read receipt in one chat.',
        method: 'POST',
        body: {
          chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
          messageId: 'c0ffee12-bbbb-4bbb-8bbb-000000000002'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Receipt advanced.',
        body: {
          ok: true,
          lastReadMessageId: 'c0ffee12-bbbb-4bbb-8bbb-000000000002',
          lastReadAt: '2026-08-03T10:21:00.000Z'
        }
      },
      {
        status: 403,
        description: 'Caller is not a member of this chat.',
        body: { ok: false, error: 'Not a member of this chat' }
      }
    ],
    notes: ['Read marks draw from the chats.read rate-limit bucket (240 requests per minute).']
  }),
  endpoint({
    id: 'chats-requests',
    group: 'messenger',
    title: 'Message requests',
    endpoint: '/api/v1/chats/requests',
    summary: 'Lists pending DM requests, or accepts and declines them.',
    detail:
      'GET returns pending DM requests in two buckets: follower for senders who follow you, and unknown for ' +
      'everyone else. POST chatId with accept: true opens the conversation and moves it into the normal inbox; ' +
      'accept: false declines and hides it, and the sender is not told either way. Replying to a pending request ' +
      'from /api/v1/chats/messages also accepts it.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET to list pending requests in the follower and unknown buckets.',
      'POST chatId and accept: true to open the conversation.',
      'POST accept: false to quietly decline; the sender is not notified.',
      'Use requestsCount from /api/v1/chats for the badge instead of polling this route.'
    ],
    requestExamples: [
      {
        name: 'List requests',
        description: 'Read pending DM requests by bucket.',
        method: 'GET'
      },
      {
        name: 'Accept a request',
        description: 'Open a pending DM.',
        method: 'POST',
        body: { chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000009', accept: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Requests listed.',
        body: {
          ok: true,
          requests: {
            follower: [
              {
                id: 'c0ffee12-aaaa-4aaa-8aaa-000000000009',
                chatType: 'dm',
                lastMessage: { text: 'Hey! Loved your post.' }
              }
            ],
            unknown: []
          }
        }
      },
      {
        status: 200,
        description: 'Request accepted.',
        body: { ok: true, state: 'active' }
      },
      {
        status: 404,
        description: 'No pending request for that chat.',
        body: { ok: false, error: 'Request not found' }
      }
    ]
  }),
  endpoint({
    id: 'chats-updates',
    group: 'messenger',
    title: 'Chat updates poll',
    endpoint: '/api/v1/chats/updates',
    summary: 'Polling endpoint behind the unread badge and new-message toasts.',
    detail:
      'Returns the same payload as GET /api/v1/chats — chats with lastMessage previews, unread counts, ' +
      'totalUnread, requestsCount, and serverTime. Clients poll it on an interval and diff lastMessage ids ' +
      'between polls to decide when to toast a new message. Keeping it identical to the list endpoint means one ' +
      'renderer handles both.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET'],
    steps: [
      'GET on a polling interval while the app is open.',
      'Diff lastMessage ids against the previous poll to detect new messages.',
      'Update the unread badge from totalUnread and requestsCount.',
      'Use serverTime as the clock reference instead of the local clock.'
    ],
    requestExamples: [
      {
        name: 'Poll for updates',
        description: 'Fetch the latest chat list snapshot.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Snapshot returned.',
        body: {
          ok: true,
          chats: [
            {
              id: 'c0ffee12-aaaa-4aaa-8aaa-000000000001',
              unreadCount: 1,
              lastMessage: { id: 'c0ffee12-bbbb-4bbb-8bbb-000000000012', text: 'New message' }
            }
          ],
          totalUnread: 1,
          requestsCount: 0,
          serverTime: '2026-08-03T10:22:00.000Z'
        }
      },
      {
        status: 401,
        description: 'No authenticated user.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'chats-settings',
    group: 'messenger',
    title: 'Messenger settings',
    endpoint: '/api/v1/chats/settings',
    summary: 'Reads or updates the current user read-receipt setting.',
    detail:
      'GET returns the current readReceipts flag. POST readReceipts: false turns receipts off under the parity ' +
      'rule: you stop sharing your reading position and stop seeing the positions of others, in both directions ' +
      'at once. Unread counts are unaffected either way — they are private bookkeeping, not sharing.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET to read the current readReceipts flag.',
      'POST readReceipts: true or false to change it.',
      'Remember parity: turning receipts off also hides everyone else from you.',
      'Unread counts keep working regardless of this setting.'
    ],
    requestExamples: [
      {
        name: 'Read settings',
        description: 'Fetch the read-receipt flag.',
        method: 'GET'
      },
      {
        name: 'Turn receipts off',
        description: 'Stop sharing and seeing read receipts.',
        method: 'POST',
        body: { readReceipts: false }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Settings returned.',
        body: { ok: true, readReceipts: true }
      },
      {
        status: 400,
        description: 'readReceipts must be a boolean.',
        body: { ok: false, error: 'readReceipts must be a boolean' }
      }
    ]
  }),
  endpoint({
    id: 'communities',
    group: 'messenger',
    title: 'Communities',
    endpoint: '/api/v1/communities',
    summary: 'Lists the caller communities or creates a new one.',
    detail:
      'GET returns every community the caller belongs to, with the caller role, memberCount, and the ordered ' +
      'sections that file its channels. POST creates a community from a name and optional description, and the ' +
      'creator becomes its owner.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with credentials to list communities, roles, and sections.',
      'POST name and optional description to create a community.',
      'The creator is the owner; add admins via /api/v1/communities/members.',
      'Create channels inside the community via POST /api/v1/chats with chatType channel.'
    ],
    requestExamples: [
      {
        name: 'List communities',
        description: 'Read the communities for the current account.',
        method: 'GET'
      },
      {
        name: 'Create a community',
        description: 'Found a new community owned by the caller.',
        method: 'POST',
        body: { name: 'Thingtime HQ', description: 'Where Thingtime gets built.' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Communities listed.',
        body: {
          ok: true,
          communities: [
            {
              id: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
              name: 'Thingtime HQ',
              role: 'owner',
              memberCount: 12,
              sections: [{ id: 'c0ffee12-eeee-4eee-8eee-000000000005', name: 'Announcements' }]
            }
          ]
        }
      },
      {
        status: 400,
        description: 'Community name missing.',
        body: { ok: false, error: 'name is required' }
      }
    ]
  }),
  endpoint({
    id: 'communities-get',
    group: 'messenger',
    title: 'Community detail',
    endpoint: '/api/v1/communities/get',
    summary: 'Reads one community with members, sections, and its channel directory.',
    detail:
      'Returns the community (including its sections), the first 100 members with roles, the full memberCount, ' +
      'and the channel directory: every channel you have joined plus the joinable public ones, each with ' +
      'memberCount and a joined flag. It is the one call a community screen needs.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET'],
    steps: [
      'Send the community id as a query parameter.',
      'Render sections and file the returned channels under them.',
      'Offer join buttons on public channels where joined is false.',
      'Handle 403 when the caller is not a member of the community.'
    ],
    requestExamples: [
      {
        name: 'Read a community',
        description: 'Fetch one community with members and channels.',
        method: 'GET',
        query: { id: 'c0ffee12-dddd-4ddd-8ddd-000000000004' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Community found.',
        body: {
          ok: true,
          community: {
            id: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
            name: 'Thingtime HQ',
            sections: [{ id: 'c0ffee12-eeee-4eee-8eee-000000000005', name: 'Announcements' }]
          },
					members: [{ user: { id: 'c0ffee12-cccc-4ccc-8ccc-000000000003', username: 'ada-lovelace' }, role: 'owner' }],
          memberCount: 12,
					channels: [{ id: 'c0ffee12-aaaa-4aaa-8aaa-000000000002', name: 'general', memberCount: 12, joined: true }]
        }
      },
      {
        status: 403,
        description: 'Caller is not a member of this community.',
        body: { ok: false, error: 'Not a member of this community' }
      }
    ]
  }),
  endpoint({
    id: 'communities-update',
    group: 'messenger',
    title: 'Update community',
    endpoint: '/api/v1/communities/update',
    summary: 'Updates a community name or description.',
    detail:
      'Community admins can rename the community or rewrite its description. Sections and channels have their ' +
      'own routes; this one only touches the community record itself.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the community id with a new name, description, or both.',
      'Only community admins may update it.',
      'Leave a field out to keep its current value.',
      'Handle 403 for non-admin callers.'
    ],
    requestExamples: [
      {
        name: 'Update a community',
        description: 'Rename and re-describe a community.',
        method: 'POST',
        body: {
          id: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
          name: 'Thingtime HQ',
          description: 'Design, build, ship.'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Community updated.',
        body: {
          ok: true,
          community: {
            id: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
            name: 'Thingtime HQ',
            description: 'Design, build, ship.'
          }
        }
      },
      {
        status: 403,
        description: 'Only admins can update a community.',
        body: { ok: false, error: 'Only admins can update this community' }
      }
    ]
  }),
  endpoint({
    id: 'communities-members',
    group: 'messenger',
    title: 'Community members',
    endpoint: '/api/v1/communities/members',
    summary: 'Changes a community member role, removes a member, or leaves.',
    detail:
      'POST the communityId plus exactly one operation. userId with role promotes or demotes between admin and ' +
      'member (admins only). userId with remove: true removes a member (admins only; the owner is untouchable). ' +
      'leave: true removes the caller — anyone but the owner may leave, since a community must keep its owner.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST communityId plus exactly one of the role, remove, or leave operations.',
      'Use userId and role to promote or demote members (admins only).',
      'Use userId and remove: true to remove someone; the owner cannot be removed.',
      'Use leave: true to depart yourself; the owner cannot leave.'
    ],
    requestExamples: [
      {
        name: 'Promote to admin',
        description: 'Give a member the admin role.',
        method: 'POST',
        body: {
          communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
          userId: 'c0ffee12-cccc-4ccc-8ccc-000000000004',
          role: 'admin'
        }
      },
      {
        name: 'Leave a community',
        description: 'Depart a community you belong to.',
        method: 'POST',
        body: { communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004', leave: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Membership updated.',
        body: { ok: true }
      },
      {
        status: 403,
        description: 'Operation requires a role the caller does not have.',
        body: { ok: false, error: 'Only admins can change member roles' }
      }
    ]
  }),
  endpoint({
    id: 'communities-invites',
    group: 'messenger',
    title: 'Community invites',
    endpoint: '/api/v1/communities/invites',
    summary: 'Lists, mints, or revokes community invite codes.',
    detail:
      'GET with communityId lists the community invites (admins only). POST with communityId mints a new invite ' +
      '— optionally bounded by expiresInDays and maxUses — and returns its code; POST with communityId and ' +
      'revokeId revokes an existing invite. Codes are redeemed through /api/v1/communities/join.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with communityId to list invites (admins only).',
      'POST communityId with optional expiresInDays and maxUses to mint a code.',
      'POST communityId and revokeId to revoke an invite.',
      'Share the code out of band; redemption happens at /api/v1/communities/join.'
    ],
    requestExamples: [
      {
        name: 'List invites',
        description: 'Read the invites for a community.',
        method: 'GET',
        query: { communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004' }
      },
      {
        name: 'Mint an invite',
        description: 'Create a 7-day, 10-use invite code.',
        method: 'POST',
        body: { communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004', expiresInDays: 7, maxUses: 10 }
      },
      {
        name: 'Revoke an invite',
        description: 'Kill an existing invite code.',
        method: 'POST',
        body: {
          communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
          revokeId: 'c0ffee12-abab-4abc-8abc-000000000007'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Invite minted.',
        body: {
          ok: true,
          invite: {
            id: 'c0ffee12-abab-4abc-8abc-000000000007',
            code: 'TT-9f3kq2',
            expiresAt: '2026-08-10T10:00:00.000Z',
            maxUses: 10,
            uses: 0
          }
        }
      },
      {
        status: 403,
        description: 'Only admins can manage invites.',
        body: { ok: false, error: 'Only admins can manage invites' }
      }
    ]
  }),
  endpoint({
    id: 'communities-join',
    group: 'messenger',
    title: 'Join community',
    endpoint: '/api/v1/communities/join',
    summary: 'Joins a community by redeeming an invite code.',
    detail:
      'POST a code to join the community it belongs to. Redemption is atomic — expiry, revocation, and use caps ' +
      'are all checked inside the update filter, so an invite can never be over-redeemed in a race. Re-joining a ' +
      'community you are already in is a friendly no-op success.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the invite code exactly as it was shared.',
      'On success the caller becomes a member of the returned community.',
      'Re-joining an existing membership succeeds without side effects.',
      'Handle 404 for expired, revoked, exhausted, or unknown codes.'
    ],
    requestExamples: [
      {
        name: 'Redeem an invite',
        description: 'Join a community with a code.',
        method: 'POST',
        body: { code: 'TT-9f3kq2' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Joined the community.',
        body: { ok: true, community: { id: 'c0ffee12-dddd-4ddd-8ddd-000000000004', name: 'Thingtime HQ' } }
      },
      {
        status: 404,
        description: 'Code invalid, expired, revoked, or used up.',
        body: { ok: false, error: 'Invite not found' }
      }
    ]
  }),
  endpoint({
    id: 'communities-sections',
    group: 'messenger',
    title: 'Community sections',
    endpoint: '/api/v1/communities/sections',
    summary: 'Creates, renames, removes, or reorders community sections.',
    detail:
      'Sections are the folders channels are filed under. POST the communityId plus exactly one operation: ' +
      'create with a name, rename with an id and name, remove with an id, or reorder with the full ordered id ' +
      'list. All four are admin-only and return the refreshed sections. Removing a section un-files its channels ' +
      'rather than deleting them.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST communityId plus exactly one of create, rename, remove, or reorder.',
      'Send reorder as the complete ordered list of section ids.',
      'Removing a section leaves its channels intact but unfiled.',
      'Read the returned sections array as the new order.'
    ],
    requestExamples: [
      {
        name: 'Create a section',
        description: 'Add a section to file channels under.',
        method: 'POST',
        body: { communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004', create: { name: 'Announcements' } }
      },
      {
        name: 'Reorder sections',
        description: 'Set the full section order.',
        method: 'POST',
        body: {
          communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004',
          reorder: ['c0ffee12-eeee-4eee-8eee-000000000005', 'c0ffee12-eeee-4eee-8eee-000000000006']
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Sections updated.',
        body: {
          ok: true,
          sections: [
            { id: 'c0ffee12-eeee-4eee-8eee-000000000005', name: 'Announcements' },
            { id: 'c0ffee12-eeee-4eee-8eee-000000000006', name: 'Projects' }
          ]
        }
      },
      {
        status: 403,
        description: 'Only admins can manage sections.',
        body: { ok: false, error: 'Only admins can manage sections' }
      }
    ]
  }),
  endpoint({
    id: 'emojis',
    group: 'messenger',
    title: 'Custom emojis',
    endpoint: '/api/v1/emojis',
    summary: 'Lists or uploads custom emojis for a community or the personal set.',
    detail:
      'GET with chatId or communityId returns the emojis usable in that scope — the community set plus your ' +
      'personal set — and requires membership for community scopes. GET with ids (comma-separated emoji ids) ' +
			'resolves specific emoji metadata with a stable same-origin content URL: message payloads reference reacted emojis as ' +
			'{ name, animated } only, and clients fetch authorized images once by id and cache them. POST atomically binds one completed purpose=custom-emoji attachment to a name of ' +
			'2-32 characters matching [a-z0-9_-] and an optional communityId. Images are private, quota-accounted GIF, PNG, JPEG, or WebP files up to 512 KiB; S3 identifiers never enter the emoji crystal or response. ' +
			'Names are unique per scope, and messages react with the custom:<emoji id> token. Legacy inline data-URI rows remain read-compatible but cannot be created.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with chatId or communityId to list the emojis usable there.',
			'Complete one purpose=custom-emoji upload, then POST name, attachmentId, and optional communityId to bind it.',
      'Keep names 2-32 characters of lowercase letters, digits, underscores, and hyphens.',
			'Use one GIF, PNG, JPEG, or WebP image no larger than 512 KiB.',
      'React with custom:<emoji id> once the upload lands.'
    ],
    requestExamples: [
      {
        name: 'List emojis for a chat',
        description: 'Emojis usable in one chat scope.',
        method: 'GET',
        query: { chatId: 'c0ffee12-aaaa-4aaa-8aaa-000000000001' }
      },
      {
        name: 'Upload a community emoji',
        description: 'Add an animated emoji to a community set.',
        method: 'POST',
        body: {
          name: 'party-blob',
					attachmentId: 'att_8d9a7d2c5b1e8046a39f12dc7b5e90186d437be2a059c8f1467e3b9d1c4a502e',
          communityId: 'c0ffee12-dddd-4ddd-8ddd-000000000004'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Emoji uploaded.',
        body: {
          ok: true,
          emoji: { id: 'c0ffee12-ffff-4fff-8fff-000000000006', name: 'party-blob', animated: true }
        }
      },
      {
        status: 400,
        description: 'Name already used in this scope.',
        body: { ok: false, error: 'An emoji with that name already exists here' }
      }
    ],
		notes: [
			'Uploads draw from the emojis.write rate-limit bucket (30 uploads per hour).',
			'The attachment reservation uses the account storage tier and is refunded only after exact-version deletion.',
			'POST requires same-origin JSON and a full user account; custom Mongo data planes cannot bind home S3 objects.'
		]
  }),
  endpoint({
    id: 'emojis-delete',
    group: 'messenger',
    title: 'Delete custom emoji',
    endpoint: '/api/v1/emojis/delete',
    summary: 'Deletes a custom emoji.',
    detail:
      'The uploader can always delete their own emoji, and community admins can delete any emoji in their ' +
			'community set. The exact S3 object version is deleted before its quota reservation is refunded and the emoji row is retired. Existing custom:<emoji id> reaction tokens simply stop resolving once the emoji is gone.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the emoji id to delete.',
      'The uploader or a community admin may delete it.',
      'Expect old reactions using the token to stop resolving.',
      'Handle 403 when the caller is neither uploader nor admin.'
    ],
    requestExamples: [
      {
        name: 'Delete an emoji',
        description: 'Remove one custom emoji.',
        method: 'POST',
        body: { id: 'c0ffee12-ffff-4fff-8fff-000000000006' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Emoji deleted.',
        body: { ok: true }
      },
      {
        status: 403,
        description: 'Caller is neither the uploader nor a community admin.',
        body: { ok: false, error: 'Not allowed to delete this emoji' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms',
    group: 'algorithms',
    title: 'Feed algorithms',
    endpoint: '/api/v1/algorithms',
    summary: 'Lists or creates the current user feed-ranking algorithms.',
    detail:
      'Feed algorithms store per-user ranking weights trained from dwell, expand, reaction, comment, and share events. Users can keep multiple named algorithms and switch the active one.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with credentials to list the caller algorithms and active id.',
      'POST a name, optional emoji, optional branchFrom id, and optional events to create an algorithm.',
      'Use branchFrom to copy an existing algorithm weight profile before further training.',
      'branchFrom also accepts the share-link id of an algorithm someone else turned sharing on for — the weights are copied into your own private algorithm, which starts unshared. A 404 means the id is neither yours nor shared.',
      'Handle 401 for anonymous callers and 400 for invalid creation payloads.'
    ],
    requestExamples: [
      {
        name: 'List algorithms',
        description: 'Read the caller feed algorithms.',
        method: 'GET'
      },
      {
        name: 'Create algorithm',
        description: 'Create a named algorithm for the caller.',
        method: 'POST',
        body: { name: 'Quiet marketplace', emoji: 'compass' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Algorithms listed.',
        body: { ok: true, algorithms: [], activeAlgorithmId: null }
      },
      {
        status: 401,
        description: 'No authenticated user.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-active',
    group: 'algorithms',
    title: 'Active feed algorithm',
    endpoint: '/api/v1/algorithms/active',
    summary: 'Sets or clears the current user active feed algorithm.',
    detail: 'Use this endpoint when the feed algorithm picker changes. A null algorithmId returns the feed to latest-first chronological ranking.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST algorithmId as a string to activate a saved algorithm, or null for Latest.',
      'The algorithm must belong to the current user.',
      'Persist activeAlgorithmId from the response in local UI state.',
      'Handle 401 unauthenticated and 404 for unknown or unowned algorithms.'
    ],
    requestExamples: [
      {
        name: 'Set active algorithm',
        description: 'Switch the caller feed to a saved algorithm.',
        method: 'POST',
        body: { algorithmId: 'algorithm_123' }
      },
      {
        name: 'Use latest feed',
        description: 'Clear the active algorithm.',
        method: 'POST',
        body: { algorithmId: null }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Active algorithm updated.',
        body: { ok: true, activeAlgorithmId: 'algorithm_123' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-delete',
    group: 'algorithms',
    title: 'Delete feed algorithm',
    endpoint: '/api/v1/algorithms/delete',
    summary: 'Deletes one of the current user feed algorithms.',
    detail: 'This route removes a user-owned algorithm and clears the active algorithm pointer when it pointed at the deleted algorithm.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the algorithm id to delete.',
      'The current user must own the algorithm.',
      'On success, remove it from the settings algorithm manager.',
      'Handle 401 unauthenticated and 404 for unknown or unowned algorithms.'
    ],
    requestExamples: [
      {
        name: 'Delete algorithm',
        description: 'Delete a caller-owned algorithm.',
        method: 'POST',
        body: { id: 'algorithm_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Algorithm deleted.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-track',
    group: 'algorithms',
    title: 'Track feed engagement',
    endpoint: '/api/v1/algorithms/track',
    summary: 'Trains the current or selected feed algorithm from engagement events.',
    detail:
      'The feed sends bounded batches of dwell, expand, reaction, comment, and share events so the active algorithm can update deterministic interest weights.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST events and optionally algorithmId.',
      'If algorithmId is omitted, the caller active feed algorithm is trained.',
      'Keep batches small; the route enforces a 128 KiB payload cap.',
      'Handle 400 for empty or malformed event batches.'
    ],
    requestExamples: [
      {
        name: 'Track engagement',
        description: 'Train from a small event batch.',
        method: 'POST',
        body: {
          algorithmId: 'algorithm_123',
          events: [{ type: 'dwell', postId: 'post_123', tags: ['tools'], value: 3 }]
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description:
          'Events were applied. eventCount is the authoritative post-flush signal total for the trained algorithm, so a client can detect growth-stage crossings from (eventCount - applied) to eventCount.',
        body: { ok: true, trained: true, applied: 1, eventCount: 101 }
      },
      {
        status: 400,
        description: 'No valid events were provided.',
        body: { ok: false, error: 'events are required' }
      }
    ]
  }),
  endpoint({
    id: 'algorithms-update',
    group: 'algorithms',
    title: 'Update feed algorithm',
    endpoint: '/api/v1/algorithms/update',
    summary: 'Renames, restyles, or toggles sharing on one of the current user feed algorithms.',
    detail:
      'Use this endpoint from the settings algorithm manager to update algorithm display metadata without changing its learned weights. shared (strict boolean) turns the "try my feed brain" branch invitation on or off: while true, anyone with the /feed?algorithm=<id> link can read the tiny preview and branch a private copy; the algorithm itself stays private either way.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST id plus name and/or emoji.',
      'The current user must own the algorithm.',
      'Use the returned algorithm to refresh local state.',
      'Handle 401 unauthenticated, 400 invalid input, and 404 missing algorithm.'
    ],
    requestExamples: [
      {
        name: 'Rename algorithm',
        description: 'Update display fields.',
        method: 'POST',
        body: { id: 'algorithm_123', name: 'Home projects', emoji: 'house' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Algorithm updated.',
        body: { ok: true, algorithm: { id: 'algorithm_123', name: 'Home projects' } }
      }
    ]
  }),
  endpoint({
    id: 'embed-things',
    group: 'embed',
    title: 'Embedded things',
    endpoint: '/api/v1/embed/things',
    summary: 'Reads, lists, creates, and version-safely updates Thingtime data embedded on other websites.',
    detail:
      'Public embedded things can be read cross-origin. Creating, listing, or updating uses the normal Thingtime session-or-bearer authentication path and stores JSON-safe values as kind: embed documents in the things collection.',
    auth: {
      mode: 'optional',
      description:
        'Public GET by id is anonymous. Private reads, owner lists, creates, and updates require an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with id to load a public embedded thing, or authenticate to load a caller-owned private thing.',
      'GET without id while authenticated to list the caller embedded things.',
      'POST name, value, and visibility without id to create a thing.',
      'POST id, the last-seen version, value, and optional metadata to update; reload after a 409 conflict.'
    ],
    requestExamples: [
      {
        name: 'Load a public thing',
        description: 'Fetch a thing for a script-tag embed.',
        method: 'GET',
        query: { id: '0df8c965-48a5-4a39-bc47-43c04d404615' }
      },
      {
        name: 'Create an embedded thing',
        description: 'Create an owner-controlled public thing.',
        method: 'POST',
        body: {
          name: 'Website capability card',
          visibility: 'public',
          value: { title: 'Hello from Thingtime', enabled: true }
        }
      },
      {
        name: 'Update an embedded thing',
        description: 'Save edits against the version that was loaded.',
        method: 'POST',
        body: {
          id: '0df8c965-48a5-4a39-bc47-43c04d404615',
          version: 1,
          value: { title: 'Hello, world', enabled: true }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Thing loaded or saved.',
        body: {
          ok: true,
          thing: {
            id: '0df8c965-48a5-4a39-bc47-43c04d404615',
            name: 'Website capability card',
            value: { title: 'Hello from Thingtime', enabled: true },
            visibility: 'public',
            version: 1
          }
        }
      },
      {
        status: 409,
        description: 'Another client saved a newer version.',
        body: { ok: false, error: 'Thing changed somewhere else. Load it before saving again.' }
      },
      {
        status: 429,
        description: 'Read budget exhausted (anonymous cross-origin callers are counted per IP).',
        body: { ok: false, error: 'Too many embed reads — take a breather 🌸' }
      },
      {
        status: 429,
        description: 'Save budget exhausted for this account.',
        body: { ok: false, error: 'Saving embeds very enthusiastically — take a breather 🌸' }
      }
    ],
    notes: [
      'Cross-origin public reads use CORS. Do not put a full-account bearer token in publicly served browser source.',
      'Values are bounded JSON data; functions, non-finite numbers, unsafe object keys, and oversized payloads are rejected.',
      'Both verbs are rate limited (embed.read / embed.write). A 429 sends Retry-After, and the read 429 keeps its CORS headers so a host page can read the status instead of seeing an opaque network error.'
    ]
  }),
  endpoint({
    id: 'algorithms-shared',
    group: 'algorithms',
    title: 'Shared feed algorithm preview',
    endpoint: '/api/v1/algorithms/shared',
    summary: 'Reads the public preview of an explicitly shared feed algorithm ("try my feed brain").',
    detail:
      'Resolves only algorithms whose owner turned sharing on. Returns identity and training size (name, emoji, eventCount, ownerUsername) — this preview never exposes weights or interests, and the algorithm doc itself is never readable. Branching is the disclosure: POST /api/v1/algorithms with branchFrom set to this id copies the owner’s learned weights into your own algorithm, where they surface as its topInterests, and that copy is independent of any later unshare. Unknown, unshared, and private ids all 404 identically.',
    auth: {
      mode: 'none',
      description: 'Public and anonymous — possession of the share link plus the owner sharing flag is the gate.'
    },
    methods: ['GET'],
    steps: [
      'Send id (the share link id from /feed?algorithm=<id>) as a query parameter.',
      'Show the preview and offer to branch a copy.',
      'POST /api/v1/algorithms with { name, emoji, branchFrom: id } while authenticated to branch.',
      'Treat 404 as not shared without assuming whether the algorithm exists.'
    ],
    requestExamples: [
      {
        name: 'Read shared algorithm preview',
        description: 'Fetch the branch-invitation preview.',
        method: 'GET',
        query: { id: 'algorithm_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Shared algorithm preview.',
        body: { ok: true, algorithm: { id: 'algorithm_123', name: 'Night Owl', emoji: '🦉', eventCount: 1234, ownerUsername: 'rick' } }
      }
    ]
  }),
  endpoint({
    id: 'apps',
    group: 'embed',
    title: 'Embed apps',
    endpoint: '/api/v1/apps',
    summary: 'Register and list the apps that can embed "Login with Thingtime" on other websites.',
    detail:
      'An app is what an external website registers before it can show a "Login with Thingtime" button ' +
      '(via the embed SDK at /sdk/thingtime-login.js). POST { name, origins } registers one: the server ' +
      'mints the clientId (ttapp_<uuid>) and validates origins — bare https origins like ' +
      'https://example.com, with http allowed only for localhost dev. Only those exact origins can open ' +
      'the authorize popup and receive tokens. Each app starts on a 5 GiB aggregate free plan and a 50 MiB ' +
      'default cap for each app user; GET lists live usage, remaining aggregate bytes, and both allowances. ' +
      'Owners and linked co-managers change plans/defaults/user sub-tiers through /api/v1/apps/storage.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session (cookie or full-account Bearer). App-scoped tokens are rejected.' },
    methods: ['GET', 'POST'],
    steps: [
      'POST { name, origins } to register an app and receive its clientId.',
      'Drop the SDK + clientId into the external site (see /sdk/thingtime-login.js).',
      'GET to list your apps; update or delete them via /api/v1/apps/update and /api/v1/apps/delete.'
    ],
    requestExamples: [
      { name: 'List apps', description: 'Your registered apps.', method: 'GET' },
      {
        name: 'Register an app',
        description: 'Create an app locked to one origin.',
        method: 'POST',
        body: { name: 'Rainbow Notes', origins: ['https://rainbownotes.example'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'App registered.',
        body: {
          ok: true,
          app: {
            clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
            name: 'Rainbow Notes',
            origins: ['https://rainbownotes.example'],
            storageAllowanceBytes: 5368709120,
            storageUsedBytes: 0,
            storageRemainingBytes: 5368709120,
            userStorageAllowanceBytes: 52428800,
            storageAccountingReady: true,
            subscriptionTier: 'free',
            subscriptionMetered: false,
            subscriptionCustom: false
          }
        }
      },
      {
        status: 400,
        description: 'Bad origin.',
        body: { ok: false, error: 'Origins must be bare https origins like https://example.com (http is allowed for localhost only)' }
      }
    ],
    notes: ['Apps are things (thingtime ["app"]) owned by you; the clientId is public, but tokens only ever reach allowlisted origins.']
  }),
  endpoint({
    id: 'apps-storage',
    group: 'embed',
    title: 'Manage app storage',
    endpoint: '/api/v1/apps/storage',
    summary: 'Manage a registered app’s aggregate plan, default app-user cap, and individual/bulk user sub-tiers.',
    detail:
      'GET ?clientId= returns the app’s aggregate byte usage/allowance, exact pinned subscription revision, ' +
      'live rich tier cards (plus an archived current revision when needed), 50 MiB-by-default app-user ' +
      'policy, and up to 200 recent app users with effective usage/caps. POST set-tier requires the selected ' +
      'stable tier id and exact live tierVersionId; its quota snapshot changes the whole-app ceiling. ' +
      'set-default-user-cap changes the inherited cap; set-user-cap assigns or clears one relational override ' +
      'for up to 200 selected users. Every per-user value is bounded by the whole-app allowance, and the ' +
      'aggregate ledger still wins when the sum of user caps is larger than the plan.',
    auth: {
      mode: 'session-or-bearer',
      description: 'The registering owner or an app co-manager linked by an administrator. App-scoped tokens are rejected.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with clientId to render the app manager and user storage table.',
      'POST { clientId, action: "set-tier", tier, tierVersionId } to select an exact live aggregate plan revision.',
      'POST { clientId, action: "set-default-user-cap", allowanceBytes } to change the inherited user cap.',
      'POST { clientId, action: "set-user-cap", userIds, allowanceBytes } for individual/bulk sub-tiers; null clears to the default.'
    ],
    requestExamples: [
      {
        name: 'Upgrade the whole app',
        description: 'Move the app to the 25 GiB Plus aggregate tier.',
        method: 'POST',
        body: {
          clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
          action: 'set-tier',
          tier: 'plus',
          tierVersionId: 'subscription-tier-plus-v1'
        }
      },
      {
        name: 'Raise selected users',
        description: 'Give two app users a 200 MiB sub-tier.',
        method: 'POST',
        body: {
          clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
          action: 'set-user-cap',
          userIds: ['664f1c2a9d3e5b0012345678', '664f1c2a9d3e5b0087654321'],
          allowanceBytes: 209715200
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Updated plan and app-user policy.',
        body: {
          ok: true,
          storage: {
            clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
            storageAllowanceBytes: 26843545600,
            storageUsedBytes: 1048576,
						storageAccountingReady: true,
            defaultUserStorageAllowanceBytes: 52428800,
            subscription: {
              tier: 'plus',
              tierVersionId: 'subscription-tier-plus-v1',
              tierVersion: 1,
              tierName: 'Plus'
            },
            tiers: [
              {
                id: 'plus',
                versionId: 'subscription-tier-plus-v1',
                status: 'live',
                title: 'Plus',
                selectable: true
              }
            ],
						users: [
							{
								userId: '664f1c2a9d3e5b0012345678',
								usedBytes: 1024,
								storageAllowanceBytes: 209715200,
								storageAccountingStatus: 'ready',
								storageAccountingVersion: 1,
								storageReconciledAt: '2026-08-07T00:00:00.000Z'
							}
						]
          }
        }
      },
      { status: 404, description: 'Unknown or not managed by this account.', body: { ok: false, error: 'App not found' } }
    ]
  }),
  endpoint({
    id: 'apps-update',
    group: 'embed',
    title: 'Update an embed app',
    endpoint: '/api/v1/apps/update',
    summary: 'Rename one of your embed apps or change its origin allowlist.',
    detail:
      'POST { clientId, name?, origins? }. Origins are re-validated like registration. Removing an origin ' +
      'takes effect on the next request from any token bound to it — the app-token resolver re-checks the ' +
      'allowlist every time. Storage allowance and usage fields are server-owned and ignored here, so an ' +
      'app developer cannot raise either quota through this identity/origin route. Use /api/v1/apps/storage ' +
      'for authorized plan and app-user policy changes.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session (cookie or full-account Bearer); you can only update apps you own.' },
    methods: ['POST'],
    steps: ['POST the clientId plus the fields to change.', 'Tokens bound to removed origins stop working immediately.'],
    requestExamples: [
      {
        name: 'Change origins',
        description: 'Swap the allowlist to a new domain.',
        method: 'POST',
        body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', origins: ['https://new.example'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Updated; server-owned quota fields are returned unchanged.',
        body: {
          ok: true,
          app: {
            clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
            name: 'Rainbow Notes',
            origins: ['https://new.example'],
            storageAllowanceBytes: 5368709120,
            storageUsedBytes: 183204,
            storageRemainingBytes: 5368525916,
            userStorageAllowanceBytes: 52428800,
            storageAccountingReady: true
          }
        }
      },
      { status: 404, description: 'Not yours / unknown.', body: { ok: false, error: 'App not found' } }
    ]
  }),
  endpoint({
    id: 'apps-delete',
    group: 'embed',
    title: 'Delete an embed app',
    endpoint: '/api/v1/apps/delete',
    summary: 'Delete one of your embed apps and revoke every token it ever minted.',
    detail:
      'POST { clientId }. Every app-scoped session for the app is revoked, so tokens held by embedding ' +
      'sites die immediately. End users KEEP their app-data things — that data belongs to them, not the ' +
      'app developer.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session (cookie or full-account Bearer); you can only delete apps you own.' },
    methods: ['POST'],
    steps: ['POST the clientId.', 'All app tokens are revoked; user data stays with its users.'],
    requestExamples: [
      { name: 'Delete', description: 'Remove the app.', method: 'POST', body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f' } }
    ],
    responseExamples: [
      { status: 200, description: 'Deleted.', body: { ok: true } },
      { status: 404, description: 'Not yours / unknown.', body: { ok: false, error: 'App not found' } }
    ]
  }),
  endpoint({
    id: 'apps-public',
    group: 'embed',
    title: 'Public app lookup',
    endpoint: '/api/v1/apps/public',
    summary: 'Anonymous lookup the authorize popup uses to validate a clientId + origin pair.',
    detail:
      "GET ?clientId=…&origin=…&scope=…&optional_scope=…. Returns the app's public face (clientId + " +
      'name) plus the REQUIRED (`scope`) and OPTIONAL (`optional_scope`) permission sets as descriptor ' +
      "entries ({ id, title, description, kind, baseline }) for the consent screen's permissions " +
      'selector — only when the app exists AND the origin is on its allowlist, so the popup can refuse ' +
      'unregistered embedders before any login UI renders. Scope paths are hierarchical dot paths from ' +
      '/api/v1/oauth/scopes (unknown names 400; empty scope → profile + app-data). 404 for unknown ' +
      'apps, 403 for origins not on the allowlist. EXCEPTION: add sandbox=1 and the lookup answers for ' +
      'ANY clientId with a mock app payload (flagged sandbox: true, no allowlist check) so integrators ' +
      'can build the consent flow before registering — pair with POST /api/v1/oauth/sandbox for a ' +
      'working pretend token.',
    auth: { mode: 'none', description: 'Anonymous — returns only the app name + scope descriptors.' },
    methods: ['GET'],
    steps: [
      'GET with clientId, the embedding page origin, and the requested scope set.',
      'Render the consent screen from the returned name + scope descriptors.'
    ],
    requestExamples: [
      {
        name: 'Lookup',
        description: 'Validate a clientId for an origin: require app-data, offer email + avatar.',
        method: 'GET',
        query: {
          clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
          origin: 'https://rainbownotes.example',
          scope: 'profile.username app-data',
          optional_scope: 'email profile.avatar'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Allowed.',
        body: {
          ok: true,
          app: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', name: 'Rainbow Notes' },
          origin: 'https://rainbownotes.example',
          requiredScopes: [
            { id: 'profile.username', title: 'Username', description: 'Your @username — the login identity itself.', kind: 'field', baseline: true },
            {
              id: 'app-data',
              title: 'App storage',
              description: 'Store its own data for you in your Thingtime account — only its own, nothing else.',
              kind: 'capability'
            }
          ],
          optionalScopes: [
            { id: 'email', title: 'Email address', description: 'The email address on your Thingtime account.', kind: 'field' },
            { id: 'profile.avatar', title: 'Avatar', description: 'Your profile picture.', kind: 'field' }
          ]
        }
      },
      { status: 403, description: 'Origin not allowlisted.', body: { ok: false, error: 'This origin is not on the app’s allowlist' } }
    ]
  }),
  endpoint({
    id: 'oauth-authorize',
    group: 'embed',
    title: 'Authorize (mint app token)',
    endpoint: '/api/v1/oauth/authorize',
    summary: 'The consent step of the "Login with Thingtime" popup — mints an app-scoped Bearer token.',
    detail:
      'POST { clientId, origin, scope?, optionalScope?, extra?, scopes?, sharedThings? } with the ' +
      "user's real session cookie (the popup runs on the Thingtime origin). `scope` is the REQUIRED " +
      "floor the platform declared (the grant must cover all of it — the user's alternative is " +
      'Cancel); `optionalScope` its nice-to-haves; `scopes` the paths the user approved, which may — ' +
      'unless extra=\'0\' — include ANY known scope the user volunteered beyond the request ("auto" ' +
      'sharing). `sharedThings` carries the shareIds hand-picked for the things scope (each must be ' +
      'owned by the user, max 100). Mints a revocable app-scoped session (purpose "app", 30 days, ' +
      'meta { scopes, sharedThings }) and returns its Bearer token, the granted scopes, and a user ' +
      'object shaped by the grant (id + username always; displayName/avatarUrl only when granted). ' +
      'Blast radius of a leaked token: it reaches the embed surface (/api/v1/app-data*, ' +
      '/api/v1/oauth/userinfo, /api/v1/oauth/shared) and the full things API (/api/v1/things plus ' +
      'its search/update/delete/react/comment sub-routes) — but every things read and write is ' +
      "fenced to the app's own namespace (the server-stamped root appId), so it can never touch " +
      "the user's feed or social surfaces, their non-app things, or another app's data, and it " +
      'cannot mint further tokens. It stays origin-bound (browser calls must come from the granted ' +
      'origin) and revocable — the token dies instantly when the user disconnects the app.',
    auth: { mode: 'session', description: "The end user's Thingtime session cookie (popup is same-origin)." },
    methods: ['POST'],
    steps: [
      'The SDK opens /authorize?client_id=…&origin=…&state=…&scope=… in a popup.',
      'The popup validates via /api/v1/apps/public, has the user log in if needed, and shows the consent + permissions selector.',
      "On approve it POSTs here with the user's selection, then hands the token to the opener via postMessage (targetOrigin = the validated origin)."
    ],
    requestExamples: [
      {
        name: 'Authorize',
        description: 'Grant the required floor + email, declining the avatar the app offered.',
        method: 'POST',
        body: {
          clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
          origin: 'https://rainbownotes.example',
          scope: 'profile.username app-data',
          optionalScope: 'email profile.avatar',
          scopes: ['profile.username', 'app-data', 'email']
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Token minted (the grant covers the required floor; avatar declined).',
        body: {
          ok: true,
          token: '<app-scoped-jwt>',
          tokenType: 'Bearer',
          expiresAt: '2026-08-11T00:00:00.000Z',
          scopes: ['profile.username', 'app-data', 'email'],
          sharedThings: 0,
          user: { id: '664f1c2a9d3e5b0012345678', username: 'lopu' }
        }
      },
      {
        status: 400,
        description: 'Grant missed a required scope.',
        body: { ok: false, error: 'The app requires the app-data permission — cancel instead if you’d rather not share it' }
      },
      { status: 403, description: 'Origin not allowlisted.', body: { ok: false, error: 'This origin is not on the app’s allowlist' } }
    ],
    notes: [
      'Revocable from both sides: the developer deletes the app (/api/v1/apps/delete), or the user disconnects it (/api/v1/oauth/grants/revoke) — the token dies before its exp like every Thingtime JWT.'
    ]
  }),
  endpoint({
    id: 'oauth-desktop-authorize',
    group: 'embed',
    title: 'Desktop authorize (issue PKCE code)',
    endpoint: '/api/v1/oauth/desktop/authorize',
    summary: 'Turn installed-app consent into a short-lived one-time code for an exact loopback callback.',
    detail:
      'POST from the first-party consent page with clientId, redirectUri, S256 codeChallenge, state, and approved scopes. The callback must be plain HTTP on 127.0.0.1 or [::1] with an explicit unprivileged port and an allowlisted exact origin. The response contains a five-minute code and echoed state; it cannot authenticate a normal Thingtime endpoint and is consumed once at /api/v1/oauth/token.',
    auth: { mode: 'session', description: "The end user's Thingtime browser session after explicit consent." },
    methods: ['POST'],
    steps: [
      'Bind the loopback listener before opening the system browser.',
      'Open /authorize with client_id, redirect_uri, code_challenge, code_challenge_method=S256, and state.',
      'Verify the callback state before exchanging its code.'
    ],
    requestExamples: [
      {
        name: 'Issue one-time code',
        description: 'Commander consent with private cloud settings storage.',
        method: 'POST',
        body: {
          clientId: 'ttapp_example',
          redirectUri: 'http://127.0.0.1:45432/oauth/callback',
          codeChallenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          codeChallengeMethod: 'S256',
          state: 'opaque-request-state',
          scope: 'profile.username app-data',
          scopes: ['profile.username', 'app-data']
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Code issued; the consent page navigates to the local callback.',
        body: { ok: true, redirectTo: 'http://127.0.0.1:45432/oauth/callback?code=<one-time-code>&state=opaque-request-state' }
      }
    ]
  }),
  endpoint({
    id: 'oauth-token',
    group: 'embed',
    title: 'Desktop token exchange',
    endpoint: '/api/v1/oauth/token',
    summary: 'Exchange a one-time desktop authorization code with its S256 verifier.',
    detail:
      'POST { grantType: "authorization_code", clientId, redirectUri, code, codeVerifier }. Native apps are public clients: an exact callback, five-minute one-time code, and PKCE verifier replace a client secret. Success returns the existing revocable, origin-bound app token.',
    auth: { mode: 'none', description: 'The one-time code plus S256 verifier are the public client proof.' },
    methods: ['POST'],
    steps: [
      'Verify callback state.',
      'Exchange the code with the original verifier and exact callback URI.',
      'Store accessToken in the OS credential vault.'
    ],
    requestExamples: [
      {
        name: 'Exchange',
        description: 'Consume the loopback code once.',
        method: 'POST',
        body: {
          grantType: 'authorization_code',
          clientId: 'ttapp_example',
          redirectUri: 'http://127.0.0.1:45432/oauth/callback',
          code: '<one-time-code>',
          codeVerifier: '<43-to-128-character-pkce-verifier>'
        }
      }
    ],
    responseExamples: [
      { status: 200, description: 'App token minted.', body: { ok: true, accessToken: '<app-scoped-jwt>', tokenType: 'Bearer' } },
      {
        status: 400,
        description: 'Wrong verifier, mismatch, expiry, or replay.',
        body: { ok: false, error: 'Authorization code is invalid, expired, already used, or does not match this request' }
      }
    ]
  }),
  endpoint({
    id: 'oauth-sandbox',
    group: 'embed',
    title: 'Sandbox token (build before registering)',
    endpoint: '/api/v1/oauth/sandbox',
    summary: 'Mint a real, working sandbox token for ANY clientId — no registration, no account, no browser.',
    detail:
      'POST { clientId?, origin?, scope?, scopes?, space?, username? } (all optional; anonymous, ' +
      'per-IP rate-limited). ' +
      'Returns the same handoff shape as /oauth/authorize plus sandbox: true — a signed Bearer token ' +
      'that WORKS for one hour against /api/v1/app-data (read/write/delete, including visibility ' +
      "'app'), /api/v1/app-data/shared, /api/v1/app-data/usage, /api/v1/oauth/userinfo, and the " +
      'full things API (/api/v1/things CRUD plus /things/search, /things/update, /things/delete, ' +
      '/things/react, /things/comment) — namespace-fenced exactly like a real app token, ' +
      'byte-budgeted at 5 MiB per sandbox namespace, and subject to an app-wide sandbox byte brake ' +
      '(default 512MB/hour across ALL sandboxes). It resolves to a synthetic ' +
      "pretend user (username 'sandbox-<name>', default sandbox-you), every byte written under it is " +
      'namespaced to that one token and TTL-reaped within the hour, and the token can never act as an ' +
      'account credential. By default two sandboxes are fully isolated; to rehearse the MULTI-USER ' +
      'shared feed, mint several tokens with the same `space` (an 8-64 char pool secret you choose — ' +
      "use a uuid) and distinct `username`s: same-space tokens see each other's visibility-'app' " +
      'entries via /app-data/shared, each entry authored by its own pretend user gated by that ' +
      "token's scopes — private entries stay per-token even inside a space. This is the headless " +
      "counterpart of the consent popup's ?sandbox=1 mode (which accepts sandbox_space / " +
      'sandbox_username URL params, or SDK options sandboxSpace / sandboxUsername): integration code ' +
      'written against it works unchanged when you register a real app and switch to ' +
      'Thingtime.login().',
    auth: { mode: 'none', description: 'Anonymous — the whole point is testing before you have anything.' },
    methods: ['POST'],
    steps: [
      'POST with the clientId + scopes you PLAN to use (e.g. scope: "profile.username app-data app-data.shared").',
      "Use the returned Bearer token against /app-data*, /oauth/userinfo, and the whole things API (/api/v1/things, /things/search, /things/update, /things/delete, /things/react, /things/comment) exactly like a real grant — every call fenced to the token's own namespace.",
      'Data and token evaporate within an hour — mint another whenever you need one.',
      'When ready: register the app (POST /api/v1/apps) and swap in Thingtime.login() — no other code changes.'
    ],
    requestExamples: [
      {
        name: 'Mint',
        description: 'A sandbox token for an app that does not exist yet.',
        method: 'POST',
        body: { clientId: 'macrobiotica-dev', origin: 'http://localhost:5599', scope: 'profile.username app-data app-data.shared' }
      },
      {
        name: 'Mint into a pool',
        description: 'Two mints with the same space = two pretend users sharing one feed.',
        method: 'POST',
        body: {
          clientId: 'macrobiotica-dev',
          scope: 'profile.username app-data app-data.shared',
          space: 'f6b2c1e8-demo-pool-2a1f0c9d8e7f',
          username: 'ada'
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'A working pretend session.',
        body: {
          ok: true,
          sandbox: true,
          token: 'eyJhbGciOi…',
          tokenType: 'Bearer',
          expiresAt: '2026-07-27T09:00:00.000Z',
          scopes: ['profile.username', 'app-data', 'app-data.shared'],
          sharedThings: 0,
          user: { id: 'sandbox', username: 'sandbox-you' }
        }
      }
    ]
  }),
  endpoint({
    id: 'oauth-scopes',
    group: 'embed',
    title: 'Scope catalog',
    endpoint: '/api/v1/oauth/scopes',
    summary: 'The public catalog of permission-scope paths platforms can request.',
    detail:
      'Anonymous, CORS-open (platforms feature-detect scopes here before opening the popup). Scopes ' +
      'are hierarchical dot paths — granting an ancestor (profile) covers every descendant ' +
      '(profile.avatar); profile.username is the always-granted baseline identity. Privacy-expanding ' +
      'leaves are marked exact: true (profile.birthday, app-data.shared) — an ancestor grant never ' +
      'covers them, the user must approve the literal path. Each entry carries the consent-screen ' +
      'wording ({ id, title, description, kind, baseline, exact }); kinds: namespace, field, ' +
      'capability, picker. The authorize popup renders its permissions selector and "share more" ' +
      'section from this catalog, so new scopes added here appear everywhere at once.',
    auth: { mode: 'none', description: 'Anonymous — documentation data.' },
    methods: ['GET'],
    steps: ['GET the catalog.', 'Request paths via the SDK scopes/optionalScopes options.'],
    requestExamples: [{ name: 'Catalog', description: 'Every scope path.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'The catalog (abridged).',
        body: {
          ok: true,
          scopes: [
            { id: 'profile.username', title: 'Username', description: 'Your @username — the login identity itself.', kind: 'field', baseline: true },
            { id: 'profile.avatar', title: 'Avatar', description: 'Your profile picture.', kind: 'field' },
            { id: 'things', title: 'Things you choose', description: 'Read-only access to specific things you hand-pick…', kind: 'picker' }
          ],
          defaults: ['profile', 'app-data']
        }
      }
    ]
  }),
  endpoint({
    id: 'oauth-shared',
    group: 'embed',
    title: 'Shared things (picker grant)',
    endpoint: '/api/v1/oauth/shared',
    summary: 'Read the things the user hand-picked to share with your app.',
    detail:
      'GET with the app-scoped Bearer token; requires the things scope. Returns exactly the set the ' +
      'user ticked on the consent screen — read-only, ownership re-checked at read time (things the ' +
      'user has since deleted drop out), projected to content fields only ({ shareId, thingtime, ' +
      'crystal, tags, createdAt, updatedAt }) — never acl/owner internals or the extended sidecar. ' +
      'Same CORS + origin binding as /api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the things scope.' },
    methods: ['GET'],
    steps: [
      'Request the things scope (SDK scopes/optionalScopes).',
      'The user picks items on the consent screen.',
      'GET here to read exactly those.'
    ],
    requestExamples: [{ name: 'Read', description: 'The shared set.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'The user shared one thing.',
        body: {
          ok: true,
          things: [
            {
              shareId: '4f6b2c1e-…',
              thingtime: ['post'],
              crystal: { type: 'text', text: 'Sunset over the bay 🌅' },
              tags: [],
              createdAt: '2026-07-10T00:00:00.000Z',
              updatedAt: '2026-07-10T00:00:00.000Z'
            }
          ]
        }
      },
      { status: 403, description: 'Token lacks the things scope.', body: { ok: false, error: 'This token was not granted the things scope' } }
    ]
  }),
  endpoint({
    id: 'oauth-grants',
    group: 'embed',
    title: 'Connected apps (grants)',
    endpoint: '/api/v1/oauth/grants',
    summary: 'List the apps connected to YOUR account via "Login with Thingtime".',
    detail:
      'GET with your own session. One entry per connected app, aggregated over your live app sessions: ' +
      'the app name (null if it was since deleted), the union of scopes you granted, how many live ' +
      'sessions it holds, first/last grant times, and the latest expiry. Disconnect one with ' +
      '/api/v1/oauth/grants/revoke.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['GET'],
    steps: ['GET to see every app connected to your account.', 'POST the clientId to /api/v1/oauth/grants/revoke to disconnect one.'],
    requestExamples: [{ name: 'List', description: 'Apps connected to your account.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Connected apps.',
        body: {
          ok: true,
          grants: [
            {
              clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
              appName: 'Rainbow Notes',
              scopes: ['profile', 'app-data'],
              sessions: 1,
              firstGrantedAt: '2026-07-12T00:00:00.000Z',
              lastGrantedAt: '2026-07-12T00:00:00.000Z',
              expiresAt: '2026-08-11T00:00:00.000Z'
            }
          ]
        }
      }
    ]
  }),
  endpoint({
    id: 'oauth-grants-revoke',
    group: 'embed',
    title: 'Disconnect an app',
    endpoint: '/api/v1/oauth/grants/revoke',
    summary: 'Revoke every app session YOU granted to one app — its tokens stop working immediately.',
    detail:
      'POST { clientId } with your own session. Revokes all of your live app-scoped sessions for that ' +
      'clientId (other users are unaffected); the app-token resolver checks session liveness on every ' +
      'request, so any token the app still holds for you dies instantly. This is the end-user ' +
      'counterpart to the developer-side /api/v1/apps/delete.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['POST'],
    steps: ['Find the clientId via /api/v1/oauth/grants.', 'POST it here; revoked reports how many sessions died.'],
    requestExamples: [
      {
        name: 'Disconnect',
        description: 'Cut an app off from your account.',
        method: 'POST',
        body: { clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f' }
      }
    ],
    responseExamples: [{ status: 200, description: 'Revoked.', body: { ok: true, revoked: 1 } }]
  }),
  endpoint({
    id: 'apps-data-summary',
    group: 'embed',
    title: 'App storage summary (your data)',
    endpoint: '/api/v1/apps/data-summary',
    summary: 'What every app has stored in YOUR account — entry counts, bytes used, budgets.',
    detail:
      'GET with your own session. One row per app namespace holding data for you, enumerated from ' +
      'the things themselves — never from grants — so an app you disconnected (or one its developer ' +
      'deleted) still shows up and its data stays deletable: appId, appName (null when the app was ' +
      "deleted), entryCount, usedBytes, budgetBytes, lastUpdatedAt. Browse a namespace's entries via " +
      "GET /api/v1/things?appId=<clientId>, see the app's own view via /api/v1/apps/data/shared, and " +
      'wipe a namespace via POST /api/v1/apps/data/delete-all.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['GET'],
    steps: [
      'GET to see every app namespace holding data for you, most recently active first.',
      'appName null means the app was deleted — the data is yours and remains browsable/deletable.',
      'Follow up with GET /api/v1/things?appId=<clientId> to read the entries, or POST /api/v1/apps/data/delete-all to remove them.'
    ],
    requestExamples: [{ name: 'Summarize', description: 'Every app namespace in your account.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Two namespaces — one app since deleted.',
        body: {
          ok: true,
          apps: [
            {
              appId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
              appName: 'Rainbow Notes',
              entryCount: 42,
              usedBytes: 183204,
              budgetBytes: 52428800,
              lastUpdatedAt: '2026-07-28T00:00:00.000Z'
            },
            {
              appId: 'ttapp_9e5b2a1f-0c9d-8e7f-4f6b-2c1e8f2a4c3d',
              appName: null,
              entryCount: 3,
              usedBytes: 1024,
              budgetBytes: 52428800,
              lastUpdatedAt: '2026-06-01T00:00:00.000Z'
            }
          ]
        }
      }
    ]
  }),
  endpoint({
    id: 'apps-data-delete-all',
    group: 'embed',
    title: "Delete an app's data (all of it)",
    endpoint: '/api/v1/apps/data/delete-all',
    summary: 'Delete EVERYTHING one app stored for you — namespace docs, cascading children, ledger.',
    detail:
      "POST { appId } with your own session. Removes every thing in that app's namespace you own " +
      'plus the comments/reactions cascading under them, refunds every affected storage ledger, and ' +
      'zeroes yours. You own every namespace doc, so this needs no live grant — it works on orphaned ' +
      'data (disconnected or deleted apps) too. Returns deleted: the number of docs removed, ' +
      'cascades included.',
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['POST'],
    steps: [
      'Find the appId via /api/v1/apps/data-summary.',
      'POST it here; deleted reports how many docs (entries + cascaded children) were removed.',
      'Handle 400 for a missing appId.'
    ],
    requestExamples: [
      {
        name: 'Wipe a namespace',
        description: 'Remove everything one app stored for you.',
        method: 'POST',
        body: { appId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f' }
      }
    ],
    responseExamples: [
      { status: 200, description: 'Namespace wiped.', body: { ok: true, deleted: 45 } },
      { status: 400, description: 'No appId.', body: { ok: false, error: 'appId is required' } }
    ]
  }),
  endpoint({
    id: 'apps-data-shared',
    group: 'embed',
    title: 'App shared slice (your lens)',
    endpoint: '/api/v1/apps/data/shared',
    summary: "See an app's data exactly as the app would show it to YOU — same read path, same fences.",
    detail:
      'GET ?appId=<clientId> (optional thingtime=, target=, cursor=, limit=) with your own session. ' +
      'Builds a lens from your OWN live grant for that app and runs it through the SAME read path ' +
      'app tokens use, so "what would I see in this app" can never drift from what the app sees: ' +
      "your entries, plus — when your grant covers app-data.shared — other users' app-audience " +
      'entries, author-liveness gated. 403 with a plain explanation when you hold no live grant ' +
      '(your own data stays browsable via /api/v1/things?appId= — ownership never expires). The ' +
      "response carries sharedRead and the grant's scopes so UIs can explain the quiet state.",
    auth: { mode: 'session-or-bearer', description: 'Your own Thingtime session. App-scoped tokens are rejected.' },
    methods: ['GET'],
    steps: [
      'Find the appId via /api/v1/apps/data-summary or /api/v1/oauth/grants.',
      'GET with appId; page with nextCursor like any things listing.',
      'sharedRead false means your grant does not cover app-data.shared — you see only your own entries, exactly as the app would show you.',
      'Handle 403 (no live grant) by pointing at /api/v1/things?appId= for the raw browse instead.'
    ],
    requestExamples: [
      {
        name: "The app's view",
        description: 'What this app would show you.',
        method: 'GET',
        query: { appId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'The lens — your entries plus the shared slice your grant covers.',
        body: {
          ok: true,
          things: [
            {
              id: 'thing_123',
              thingtime: ['data'],
              crystal: { text: 'Miso soup 🍲' },
              visibility: 'app'
            }
          ],
          nextCursor: null,
          sharedRead: true,
          scopes: ['profile.username', 'app-data', 'app-data.shared']
        }
      },
      {
        status: 403,
        description: 'No live grant (revoked or expired).',
        body: { ok: false, error: 'No live grant for this app — sign in to it with Thingtime first (your data stays either way)', sharedRead: false }
      }
    ]
  }),
  endpoint({
    id: 'oauth-userinfo',
    group: 'embed',
    title: 'Userinfo (SSO identity)',
    endpoint: '/api/v1/oauth/userinfo',
    summary: 'Resolve the user an app-scoped token was granted for — the SSO identity endpoint.',
    detail:
      'GET with the app-scoped Bearer token. Returns the granted scopes plus a user object shaped ' +
      'field-by-field by the grant: id, username, and a profileUrl Thingtime link always ' +
      '(profile.username baseline); displayName, avatarUrl, bio, bannerUrl each under their ' +
      'profile.<field> path (a granted profile namespace covers them all); birthday (YYYY-MM-DD) ' +
      'under profile.birthday ONLY — an exact scope a plain profile grant never covers; email under ' +
      'the email scope; sharedThings reports the picker count. Platforms call this to sync the ' +
      'account on their side and light up features for whatever the user shared. Same CORS + origin ' +
      'binding as /api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token only.' },
    methods: ['GET'],
    steps: ['GET with the token from Thingtime.login(…).', 'Read user + scopes; email appears only under the email scope.'],
    requestExamples: [{ name: 'Lookup', description: 'Who is this token?', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Identity — avatar + email granted, bio/banner/displayName were not.',
        body: {
          ok: true,
          scopes: ['profile.username', 'app-data', 'profile.avatar', 'email'],
          sharedThings: 0,
          user: {
            id: '664f1c2a9d3e5b0012345678',
            username: 'lopu',
            profileUrl: 'https://thingtime.com/profile/lopu',
            avatarUrl: null,
            email: 'lopu@example.com'
          }
        }
      },
      { status: 401, description: 'Missing/expired/revoked token.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'app-data',
    group: 'embed',
    title: 'App data (read/write)',
    endpoint: '/api/v1/app-data',
    summary: "Key/value storage an embedded app keeps in its user's Thingtime account.",
    detail:
      'Authenticated by an app-scoped Bearer token from /api/v1/oauth/authorize. GET ?key=… returns one ' +
      "entry ({ entry: null } when unset); GET without key lists this (user, app)'s entries — " +
      'key=post:* or prefix= filters by prefix, limit= (1-200, default 200) and cursor= page, and the ' +
      'listing returns nextCursor (the same grammar as /app-data/shared). ' +
      'POST { key, value, visibility?, acl? } inserts or updates one entry — keys are [A-Za-z0-9._:-] up to 128 chars ' +
      '(first char must be a letter or digit), values ' +
      'any JSON up to 32 KiB. There is NO key-count cap: registered-app storage is bounded by BOTH a ' +
      '50 MiB allowance per (user, app) and a 5 GiB aggregate allowance across every user of the app ' +
      '(sandbox namespaces get 5 MiB plus the separate global burn window) — every write charges its ' +
      'serialized size, updates charge only the delta, deletes refund, and an over-budget write ' +
      'fails with 507 (read GET /api/v1/app-data/usage to pace yourself). Entries are things owned by the END USER, ' +
      'and their audience IS the acl array: ["tt:user"] (private, the default) or ' +
      '["tt:user", "tt:app/<clientId>"] (readable by other users of this one app via /api/v1/app-data/shared). ' +
      "visibility: 'private' | 'app' is accepted sugar for those two acls and derived back on the wire; " +
      "marking an entry 'app' requires the app-data.shared scope, and a write that omits visibility/acl " +
      "never changes an existing entry's audience. Users can always see and delete what an app stored. " +
      'Every entry carries the namespace stamps (root appId + sizeBytes), so KV entries and things ' +
      'written through the app-token things routes are ONE namespace — the same entries appear via ' +
      'GET /api/v1/things?thingtime=app-data with this token. ' +
      'CORS: browser calls must ' +
      "come from the token's own bound origin. Requires the app-data scope — 403 when the user declined " +
      'it on the consent screen.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the app-data scope — cookies never authenticate this route.' },
    methods: ['GET', 'POST'],
    steps: [
      'Take the token from Thingtime.login(…) in the SDK.',
      'GET to read (with ?key for one entry), POST { key, value } to write.',
      'List with key=<prefix>* or prefix= and page with limit/cursor until nextCursor is null.',
      'Values round-trip as JSON; delete keys via /api/v1/app-data/delete. Watch the byte budget via /api/v1/app-data/usage — a 507 means the namespace is full (delete entries or store less).'
    ],
    requestExamples: [
      { name: 'Read one', description: 'One key.', method: 'GET', query: { key: 'preferences' } },
      { name: 'List all', description: 'Everything this app stored for this user (paged).', method: 'GET' },
      { name: 'List a prefix', description: 'Only post:* keys, 50 at a time.', method: 'GET', query: { key: 'post:*', limit: 50 } },
      { name: 'Write', description: 'Upsert a key.', method: 'POST', body: { key: 'preferences', value: { theme: 'rainbow' } } },
      {
        name: 'Write shared',
        description: 'Upsert a key other users of this app may read (needs the app-data.shared scope).',
        method: 'POST',
        body: { key: 'post:2026-07-27', value: { text: 'Miso soup 🍲' }, visibility: 'app' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Entry written.',
        body: {
          ok: true,
          entry: { key: 'preferences', value: { theme: 'rainbow' }, visibility: 'private', acl: ['tt:user'], updatedAt: '2026-07-12T00:00:00.000Z' }
        }
      },
      { status: 401, description: 'Missing/expired/revoked token.', body: { ok: false, error: 'Unauthorized' } },
      { status: 403, description: 'Browser origin ≠ token origin.', body: { ok: false, error: 'Origin does not match this token' } },
      {
        status: 507,
        description: "The write would exceed this app user's allowance.",
        body: {
          ok: false,
          error: "This would exceed the app's storage allowance for this user (52428712 of 52428800 bytes used — delete entries or store less)"
        }
      },
      {
        status: 507,
        description: 'The write would exceed the whole app allowance.',
        body: { ok: false, error: "This would exceed the app's aggregate storage allowance (5368709000 of 5368709120 bytes used across all users)" }
      }
    ]
  }),
  endpoint({
    id: 'app-data-delete',
    group: 'embed',
    title: 'App data (delete)',
    endpoint: '/api/v1/app-data/delete',
    summary: 'Delete one key/value entry the app stored for this user.',
    detail:
      'POST { key } with the app-scoped Bearer token. Returns deleted: false when the key was already ' +
      'absent. Same CORS + origin binding as /api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token only.' },
    methods: ['POST'],
    steps: ['POST the key to remove.'],
    requestExamples: [{ name: 'Delete', description: 'Remove a key.', method: 'POST', body: { key: 'preferences' } }],
    responseExamples: [{ status: 200, description: 'Removed (or already absent).', body: { ok: true, deleted: true } }]
  }),
  endpoint({
    id: 'app-data-shared',
    group: 'embed',
    title: 'App data (shared pool)',
    endpoint: '/api/v1/app-data/shared',
    summary: 'Read the entries every user of this app opted into sharing — the app-scoped social read.',
    detail:
      'GET ?key=&prefix=&limit=&cursor= returns entries from ALL users of the calling app whose acl carries ' +
      "tt:app/<clientId> (written via POST /api/v1/app-data with visibility 'app'), newest first with a " +
      'cursor — never entries from other apps, never private entries. key= matches exactly, key=post:* or ' +
      'prefix= matches a prefix; limit clamps to 1–50 (default 20). Requires the app-data.shared scope on ' +
      "the calling token, and each entry's author must still hold a live grant covering that scope — a user " +
      'who disconnects the app (or whose grant expires) drops out of this feed instantly while keeping ' +
      "their data. Each entry's author is shaped by that AUTHOR's own grant, exactly like /oauth/userinfo: " +
      'id + username always, displayName/avatarUrl only when that author granted profile.displayName / ' +
      'profile.avatar. Same CORS + origin binding as /api/v1/app-data. Note the scope is EXACT consent: ' +
      'granting app-data does NOT imply app-data.shared — apps must request it and users see its own line ' +
      'on the consent screen.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the app-data.shared scope.' },
    methods: ['GET'],
    steps: [
      'Request the app-data.shared scope in Thingtime.login({ scopes: [...] }).',
      "Write shared entries with POST /api/v1/app-data { key, value, visibility: 'app' }.",
      'GET this route (e.g. ?key=post:*) and page with nextCursor until it returns null.',
      "Render authors from each entry's author object — fields mirror what each author consented to."
    ],
    requestExamples: [{ name: 'App feed', description: 'Newest shared post entries.', method: 'GET', query: { key: 'post:*', limit: 20 } }],
    responseExamples: [
      {
        status: 200,
        description: 'One page, newest first.',
        body: {
          ok: true,
          entries: [
            {
              key: 'post:2026-07-27',
              value: { text: 'Miso soup 🍲' },
              visibility: 'app',
              updatedAt: '2026-07-27T00:00:00.000Z',
              createdAt: '2026-07-27T00:00:00.000Z',
              author: { id: '64f000000000000000000002', username: 'ada-lovelace', avatarUrl: null }
            }
          ],
          nextCursor: 'eyJ1IjoxNzAwMDAwMDAwMDAwLCJzIjoi…'
        }
      },
      { status: 403, description: 'Token lacks the scope.', body: { ok: false, error: 'This token was not granted the app-data.shared scope' } }
    ]
  }),
  endpoint({
    id: 'app-data-usage',
    group: 'embed',
    title: 'App data (storage usage)',
    endpoint: '/api/v1/app-data/usage',
    summary: 'Both storage ledgers: this app user and the whole registered app.',
    detail:
      'GET with the app-scoped Bearer token. Storage is byte-budgeted, never entry-counted: every ' +
      'write through this app — KV entries and generic things alike — charges its serialized size ' +
      '(the root sizeBytes stamp) against both the 50 MiB per-app-user allowance and the registered ' +
      "app's 5 GiB aggregate allowance. Updates charge only the delta and deletes refund, so both " +
      'ledgers track what is actually stored. Legacy usedBytes/budgetBytes remain aliases for the ' +
      'current user ledger; userStorage and appStorage add explicit used, allowance, and remaining ' +
			'bytes. accountStorage is the authoritative whole-Thingtime-account ledger; the same payload bytes ' +
			'also participate in the overlapping userStorage and appStorage sub-limits, but are never added twice ' +
			'to accountStorage. storageAccountingReady is true only when all applicable ledgers are exact and ready. ' +
			'Sandboxes return appStorage/accountStorage null because their aggregate protection is windowed. ' +
      'Over-allowance writes fail with 507; poll this to pace the app ' +
      'instead of discovering the ceiling. Same CORS + origin binding as /api/v1/app-data.',
    auth: { mode: 'bearer', description: 'App-scoped Bearer token with the app-data scope.' },
    methods: ['GET'],
    steps: [
      'GET with the token from Thingtime.login(…).',
      'Compare both userStorage.remainingBytes and appStorage.remainingBytes before large writes; a 507 identifies which allowance is spent.',
			'Use accountStorage.status and storageAccountingReady before presenting any value as exact.',
      'Deleting entries (or shrinking values) refunds bytes immediately.'
    ],
    requestExamples: [{ name: 'Read usage', description: 'Bytes used and the budget.', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'Both registered-app ledgers (with backward-compatible user aliases).',
        body: {
          ok: true,
          usedBytes: 183204,
          budgetBytes: 52428800,
          remainingBytes: 52245596,
          userStorage: { usedBytes: 183204, allowanceBytes: 52428800, remainingBytes: 52245596 },
          appStorage: { usedBytes: 12345678, allowanceBytes: 5368709120, remainingBytes: 5356363442 },
					accountStorage: {
						usedBytes: 2941120,
						allowanceBytes: 5368709120,
						remainingBytes: 5365768000,
						overageBytes: 0,
						status: 'ready',
						accountingVersion: 1,
						reconciledAt: '2026-08-07T00:00:00.000Z'
					},
          storageAccountingReady: true
        }
      },
      { status: 401, description: 'Missing/expired/revoked token.', body: { ok: false, error: 'Unauthorized' } }
    ]
  }),
  endpoint({
    id: 'things',
    featureVersion: '1.1.0',
    group: 'things',
    title: 'Things (full CRUD)',
    endpoint: '/api/v1/things',
    summary: 'One endpoint for every thing: create, read, update/upsert, and delete posts, comments, reactions, and shares.',
    detail:
      'Everything is a thing: one root Thing schema per doc, sub-schemas applied via the thingtime array of schema ids (see /schemas), the payload under crystal, and the audience under acl — tt: grants plus "-"-prefixed exclusions where the most specific matching entry wins (["tt:all"] public, ["-tt:all","tt:userFriends","tt:user"] friends-only, ["tt:all","-tt:user/somebody"] public except one user; owners always see their own things). POST creates (unified shape or the legacy post body — same path), GET reads one thing / lists a target’s attached things / lists your own, PUT upserts by id (create-or-replace), PATCH merges a partial update, DELETE removes an owned thing and its attached comments/reactions. The legacy visibility names still work as input and are derived on the wire. Crystals are optionally schema-less: omit thingtime and it defaults to ["data"], the bounded free-form crystal. Beside the crystal, every thing also carries a schema-free extended property — any JSON up to 512KB, stored and returned exactly as given, never validated or interpreted, and not structured-searchable (/search field conditions can’t target it, though its string content is indexed by the wildcard text index). extended replaces as a whole value on write (deep-merging arbitrary JSON is ambiguous) and null clears it — the open sidecar external apps park their data in. Things also carry a tokenAcl grant list (tt:token/<token id> entries, see /api/v1/tokens-docs): sandboxed personal-access-tokens may only mutate things carrying their entry; creators are auto-granted, the list replaces whole via tokenAcl on POST/PUT/PATCH (null clears, max 32 entries), it never affects visibility, and it projects to the owner only.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Mutations require an auth cookie or Authorization: Bearer token — a full session or a scoped personal access token (see /api/v1/tokens; scopes gate each verb, e.g. things.create for POST, things.update for PATCH, both for PUT). GET works logged out for tt:all things; attached things inherit their target audience. ' +
        "App-scoped Bearer tokens (\"Login with Thingtime\", app-data scope) get every verb too, fenced to the app's own namespace: reads conjoin the server-stamped root appId (plus the audience acl, tt:inherit chain resolution, and author-liveness for cross-user docs — anything outside the namespace 404s), writes are stamped (root appId + sizeBytes), charged against both the whole-app and per-app-user allowances, and acl-clamped to tt:user (the default — app inserts are private, never the public default) or tt:app/<clientId> (needs the app-data.shared scope). save/share things and protected kinds are refused; app responses carry the generic thing projection (never the post aggregation) with visibility 'private' | 'app' | 'inherit' and the acl filtered to the app's own entries."
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    steps: [
      'POST { thingtime: ["post"], crystal: { type, text, richText?, images, listing, thing }, acl, tags } — or the legacy post body — to create. type is text, image, marketplace, or thingtime.',
      'Post captions may include richText: a bounded native Editor.js document ({ kind: "rich-text", blocks: [...] }). The server derives crystal.text from those blocks as the canonical plain-text search, moderation, notification, and older-client fallback.',
      'Thingtime posts (type "thingtime") carry a free-form structured thing under crystal.thing — bounded like data crystals and searchable as crystal.thing.<field> on /search. They can also carry images and an optional marketplace listing (validated like a marketplace post’s when present).',
      'Omit thingtime entirely to create a schema-less thing: { crystal: { any: "shape" } } defaults to thingtime ["data"].',
      'Optionally add extended: any JSON up to 512KB, stored untouched and returned as-is — replace-on-write, null clears it. It is not structured-searchable (/search field conditions can’t target it), though its string content is indexed by the wildcard text index like any field.',
      'Attached kinds (comment, reaction) require targetId and carry acl ["tt:inherit"]; shares carry thingtime ["post","share"]. tt:inherit is stamped by the SERVER on target-attached things — sending it yourself is a 400 on create and update alike, because a thing whose audience is detached from its own acl can never be judged or re-edited.',
      "GET ?id= reads one thing; post projections include viewer-relative commentCounts { direct, replies, total, loaded } while commentCount remains the backward-compatible total. Hidden ACL/moderation rows are never counted or disclosed. GET ?target=&thingtime=comment lists a visible thing’s comments; GET ?thingtime=&cursor=&limit= lists your own things. Session callers may add appId=<clientId> to the own-things list to browse ONE app's namespace (see /api/v1/apps/data-summary).",
      'PUT { id, thingtime, crystal, acl? } creates the thing at that id (201) or replaces the owned thing’s crystal whole (200); PATCH { id, crystal?, extended?, acl?, tags? } merges crystal fields (extended still replaces whole).',
      'PATCH { id, attachmentIds } syncs a post’s (or rich comment’s) private attachments: the list is the full desired display order — it must include every id already bound to that thing (removals are rejected; 409 when the bound set changed) and may append the ids of newly uploaded ready drafts, which are bound to the post with the same fences create-time binding uses. Same-origin JSON from a full user session only, like attachment creation.',
      'PATCH/PUT may include expectedUpdatedAt to fail with 409 if the Thing changed after a preview. PATCH may set replaceCrystal true for whole-crystal replacement.',
      'DELETE ?id= (or body { id, expectedUpdatedAt? }) removes an owned thing; the optional precondition is checked atomically before cascade cleanup, attached comments/reactions go with it, and shares survive with an original-unavailable placeholder.',
      'Handle 401 unauthenticated, 400 invalid payload or acl, 404 missing target/thing, and 413 oversized payload.'
    ],
    requestExamples: [
      {
        name: 'Create public post',
        description: 'A public text post — acl ["tt:all"] is also the default when neither acl nor visibility is sent.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Everything is a thing ✨' },
          acl: ['tt:all'],
          tags: ['thingtime']
        }
      },
      {
        name: 'Create rich-text post',
        description: 'Native blocks retain inline marks, block styles, whitespace, and line breaks; text is derived server-side.',
        method: 'POST',
        body: {
          type: 'text',
          richText: {
            kind: 'rich-text',
            blocks: [{ type: 'paragraph', data: { text: '<mark>Home network public ip:</mark><br>113.29.241.145' } }]
          },
          visibility: 'private'
        }
      },
      {
        name: 'Create friends-only post',
        description: 'Exclude the world, grant the friends circle and yourself.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Bonfire at ours on Saturday 🔥' },
          acl: ['-tt:all', 'tt:userFriends', 'tt:user']
        }
      },
      {
        name: 'Create thingtime post',
        description: 'A post carrying any structured thing — searchable by its real datatypes on /search.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: {
            type: 'thingtime',
            text: 'My new standing desk 🌀',
            thing: { name: 'Walnut standing desk', legs: 4, material: 'wood', height: 130, sitStand: true }
          },
          tags: ['furniture']
        }
      },
      {
        name: 'Create public-except-one post',
        description: 'Grants and exclusions combine; the most specific entry wins per viewer.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Planning a surprise party 🎂🤫' },
          acl: ['tt:all', '-tt:user/birthday.person', 'tt:user']
        }
      },
      {
        name: 'Create marketplace post (legacy body)',
        description: 'The pre-unification body still works and maps onto the same path — visibility names become acls.',
        method: 'POST',
        body: {
          type: 'marketplace',
          text: 'Selling my hoverboard, barely used.',
          listing: { title: 'Hoverboard', price: 420, currency: 'AUD', category: 'other' },
          visibility: 'public'
        }
      },
      {
        name: 'Comment via the unified shape',
        description: 'Comments are things too — targetId points at the post, audience inherits.',
        method: 'POST',
        body: {
          thingtime: ['comment'],
          crystal: { text: 'So say we all 🚀' },
          targetId: 'post_123'
        }
      },
      {
        name: 'Create a schema-less thing',
        description: 'No thingtime needed — a bare crystal defaults to ["data"], and extended carries anything else as-is.',
        method: 'POST',
        body: {
          crystal: { name: 'Walnut standing desk', legs: 4, material: 'wood' },
          extended: { myApp: { mood: 'curious', readingList: ['FUNDAMENTALS.md', { title: 'Everything is a thing', progress: 0.42 }] } },
          acl: ['tt:user']
        }
      },
      {
        name: 'Read one thing',
        description:
          'Fetch a thing by id (posts AND comments include the full post projection; comments also return parent and root for thread navigation — the /post/:id permalink pages are backed by this).',
        method: 'GET',
        query: { id: 'post_123' }
      },
      {
        name: 'List comments of a post',
        description: 'Read the comment things attached to a visible thing.',
        method: 'GET',
        query: { target: 'post_123', thingtime: 'comment', limit: 20 }
      },
      {
        name: 'List your own things',
        description: 'Everything you own, newest first — filter with thingtime=post,comment.',
        method: 'GET',
        query: { thingtime: 'post', limit: 10 }
      },
      {
        name: 'Upsert by id',
        description: 'PUT creates the thing at your id or replaces the crystal whole — handy for idempotent sync clients.',
        method: 'PUT',
        body: {
          id: 'my-sync-doc-001',
          thingtime: ['post'],
          crystal: { type: 'text', text: 'Synced snapshot v2' },
          acl: ['tt:user']
        }
      },
      {
        name: 'Patch a thing',
        description: 'PATCH merges crystal fields and can retarget the audience.',
        method: 'PATCH',
        body: { id: 'post_123', crystal: { text: 'Edited ✏️' }, acl: ['-tt:all', 'tt:userFamily', 'tt:user'] }
      },
      {
        name: 'Apply a previewed patch safely',
        description: 'Replace the crystal only if the exact previewed version is still current.',
        method: 'PATCH',
        body: { id: 'post_123', crystal: { type: 'text', text: 'Reviewed replacement' }, replaceCrystal: true, expectedUpdatedAt: '2026-08-30T01:02:03.000Z' }
      },
      {
        name: 'Delete a thing',
        description: 'Removes an owned thing; its comments and reactions go with it.',
        method: 'DELETE',
        query: { id: 'post_123' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Post thing created.',
        body: {
          ok: true,
          post: {
            id: 'post_123',
            thingtime: ['post'],
            type: 'text',
            text: 'Everything is a thing ✨',
            acl: ['tt:all'],
            visibility: 'public'
          }
        }
      },
      {
        status: 201,
        description: 'PUT created a new thing at the caller-chosen id.',
        body: {
          ok: true,
          created: true,
          thing: {
            id: 'my-sync-doc-001',
            thingtime: ['post'],
            crystal: { type: 'text', text: 'Synced snapshot v2' },
            acl: ['tt:user']
          },
          post: { id: 'my-sync-doc-001', visibility: 'private' }
        }
      },
      {
        status: 200,
        description: 'Attached things listed.',
        body: {
          ok: true,
          things: [
            {
              id: 'comment_123',
              thingtime: ['comment'],
              crystal: { text: 'So say we all 🚀' },
              targetId: 'post_123',
              acl: ['tt:inherit'],
              visibility: 'inherit'
            }
          ],
          nextCursor: null
        }
      },
      {
        status: 400,
        description: 'Malformed acl entry.',
        body: {
          ok: false,
          error: "acl entries look like tt:all, tt:user, tt:userFriends, or tt:user/<username>, optionally '-' prefixed (got tt bogus)"
        }
      }
    ],
    notes: [
      'System kinds (user, theme, feed-algorithm, waitlist) are protected: this endpoint refuses to create, update, or delete them — they are managed exclusively by their dedicated endpoints (auth/register, users/profile, themes, algorithms, waitlist).',
      'acl entries: tt:all, tt:user (owner), tt:userFriends, tt:userFamily, tt:user/<username>, each optionally "-" prefixed; the most specific matching entry decides and owners always view. tt:userFriends resolves against the real friend graph (accepted friendships from /api/v1/users/friend); no family graph exists yet, so tt:userFamily still resolves to the owner only.',
      'Every doc stores the root schemaVersion it was written at; admins migrate older docs via /api/v1/admin/migrations.',
      'Browse every schema kind at /schemas or GET /api/v1/schemas.',
      'The comment/react/share/update/delete sub-routes remain as sugar over this endpoint.',
      "App-token behaviour in one line: same verbs, own namespace only — a thing without the app's root appId stamp 404s for reads, writes, and deletes alike. Apps read children (comments/reactions) relationally via GET ?target=… inside the namespace; child counts never mix in first-party or other-app children."
    ]
  }),
  endpoint({
    id: 'things-quota',
    group: 'things',
    title: 'Atomic service quota',
    endpoint: '/api/v1/things/quota',
    summary: 'Atomically reserve daily work and acquire rolling-window permits for a service account.',
    detail:
      'A server-to-server coordination primitive stored as one private, deterministic data Thing per service-account owner + key. ' +
      'GET ?key= returns bounded status. POST performs reserve, permit, release, or reset with one atomic Mongo findOneAndUpdate, ' +
      'so concurrent serverless invocations cannot oversubscribe a daily or rolling cap. The first reserve pins the policy. ' +
      'Every time decision uses Thingtime server time; request bodies cannot supply now. State and lookups are always scoped to the authenticated owner.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires a live service-purpose Thingtime credential, supplied as Authorization: Bearer or the tt_auth cookie. Ordinary browser sessions, user accounts, and app-scoped tokens are rejected.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'POST reserve with a globally unique reservationId, positive count, and policy. A replay with the same count is idempotent; a different count is 409.',
      'Before each expensive unit, POST permit with a permitId beginning with reservationId + ":". granted false is a normal 200 response; wait until retryAt before retrying.',
      'If a reserved unit became a cache hit before its permit, POST release with that same would-be child id as releaseId. Replays never decrement twice.',
      'GET status for daily and rolling remaining values. An authenticated service can POST reset for its own key; reset preserves in-flight identities and rolling permits.',
      'Treat 503 as fail-closed. No work should continue when quota state is unavailable.'
    ],
    requestExamples: [
      {
        name: 'Read status',
        description: 'Read this service account quota.',
        method: 'GET',
        query: { key: 'pokeworld:block-generation' }
      },
      {
        name: 'Reserve blocks',
        description: 'Reserve three daily generation slots.',
        method: 'POST',
        body: {
          key: 'pokeworld:block-generation',
          operation: 'reserve',
          reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd',
          count: 3,
          policy: { dailyLimit: 500, rollingLimit: 9, rollingWindowMs: 5000 }
        }
      },
      {
        name: 'Acquire permit',
        description: 'Acquire one of nine rolling-window permits.',
        method: 'POST',
        body: {
          key: 'pokeworld:block-generation',
          operation: 'permit',
          reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd',
          permitId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd:946647,488524'
        }
      },
      {
        name: 'Release cache hit',
        description: 'Return one reserved daily slot before it acquires a permit.',
        method: 'POST',
        body: {
          key: 'pokeworld:block-generation',
          operation: 'release',
          reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd',
          releaseId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd:946647,488524'
        }
      },
      {
        name: 'Reset daily usage',
        description: 'Clear daily use without cancelling in-flight work.',
        method: 'POST',
        body: { key: 'pokeworld:block-generation', operation: 'reset' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Reservation accepted.',
        body: {
          ok: true,
          status: {
            key: 'pokeworld:block-generation',
            policy: { dailyLimit: 500, rollingLimit: 9, rollingWindowMs: 5000 },
            dayKey: '2026-07-19',
            dailyUsed: 3,
            dailyRemaining: 497,
            rollingUsed: 0,
            rollingRemaining: 9,
            rollingResetAt: null
          },
          reservation: {
            dayKey: '2026-07-19',
            reservationId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd'
          }
        }
      },
      {
        status: 200,
        description: 'Rolling cap reached; retry at the server epoch timestamp.',
        body: {
          ok: true,
          status: { rollingUsed: 9, rollingRemaining: 0 },
          permit: {
            permitId: '8b0c9547-3575-4a87-b6bb-e95c9d3fb4dd:946647,488524',
            granted: false,
            retryAt: 1784462405010
          }
        }
      },
      {
        status: 409,
        description: 'A caller tried to change a pinned policy.',
        body: {
          ok: false,
          error: 'Quota policy is already pinned to different limits',
          code: 'QUOTA_POLICY_CONFLICT'
        }
      },
      {
        status: 413,
        description: 'The JSON body exceeded the 16 KiB route cap.',
        body: { ok: false, error: 'Request body too large' }
      },
      {
        status: 503,
        description: 'Fail-closed storage error.',
        body: { ok: false, error: 'Quota store is unavailable', code: 'QUOTA_UNAVAILABLE' }
      }
    ],
    notes: [
      'Keys are 1-128 safe characters. Reservation, permit, and release ids are bounded; permitId/releaseId must begin with reservationId + ":".',
      'Policy bounds: dailyLimit 1-10000, rollingLimit 1-1000, rollingWindowMs 100-86400000.',
      'Errors include a stable code: INVALID_REQUEST, QUOTA_NOT_FOUND, QUOTA_POLICY_CONFLICT, QUOTA_RESERVATION_CONFLICT, QUOTA_DAILY_LIMIT, QUOTA_RESERVATION_EXPIRED, QUOTA_PERMIT_CONFLICT, QUOTA_RELEASE_CONFLICT, or QUOTA_UNAVAILABLE.',
      'The raw quota Thing is private (acl ["tt:user"]); responses expose only the bounded status and operation result.'
    ]
  }),
  endpoint({
    id: 'things-search',
    featureVersion: '1.1.1',
    group: 'things',
    title: 'Search things',
    endpoint: '/api/v1/things/search',
    summary: 'Structured MongoDB-style search plus Google-like ranked text search over every thing you can see.',
    detail:
      'The search behind /search. Two modes that compose: q runs a ranked text search (weighted ' +
      'wildcard text index over every string field — relevance-sorted like a web search), and ' +
      'conditions runs a structured query built from a whitelisted operator grammar: eq, ne, gt, ' +
      'gte, lt, lte, between, in, nin, exists, type, contains, startsWith, endsWith. Fields address the ' +
      'crystal by path (bare names auto-prefix, so "legs" means crystal.legs) plus the root ' +
      'fields tags, thingtime, createdAt, updatedAt, shareId, and targetId. Conditions nest into ' +
      'all/any groups (depth ≤ 3, ≤ 32 conditions); values must be bounded primitives, and text ' +
      'operators escape to literal matching — raw regex and query operators from the client never ' +
      'reach the database. Results honour the same audience model as the feed: public things plus ' +
      'your own, with exact acl evaluation per doc; attached tt:inherit things (comments, ' +
      'reactions) only surface for their owner.',
    auth: {
      mode: 'optional',
      description:
        'Works logged out (tt:all things only, throttled per IP). Authenticated searches also see your own things. ' +
        "App-scoped Bearer tokens get the full grammar (conditions, sorts, cursors, engagement windows) with results fenced server-side to the app's own appId namespace — own entries, plus the app-audience slice when the token holds app-data.shared. appId and acl are never client-searchable fields; the namespace conjunction is injected server-side and inexpressible from the grammar."
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET ?q=<text>&thingtime=&tags=&sort=&cursor=&limit= for the simple shareable form.',
      'POST { q?, mode: "all"|"any", conditions: [{ field, op, value | values } | { mode, conditions: [...] }], thingtime?, tags?, from?, to?, sort?, cursor?, limit? } for structured searches.',
      'Range searches are one atomic between condition ({ field, op: "between", values: [low, high] }, either end open); enum picks are one in condition.',
      'sort defaults to relevance with q, newest otherwise (oldest also supported); ranked pages cursor by offset, chronological pages by the standard createdAt_shareId cursor.',
      'Shortcut filters (the feed/profile Advanced panel) compose with everything above: types (post types, csv), circles (audience circles, csv), author (one username — unknown usernames match nothing), minTextChars/maxTextChars (post text length), and minReactions/minComments.',
      'Engagement thresholds (minReactions/minComments) count child things at read time, so they search a bounded window of the newest (or best-matching) 400 candidates and page within it by offset — the same determinism trade-off as the ranked feed.',
      'The response carries things (generic projections; ranked text results include their query-relative rankScore), posts (full post projections keyed by thing id), nextCursor, and a capped approximate total (a visibility-superset count, only computed on the first page).',
      'Handle 400 invalid grammar and 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Ranked text search',
        description: 'Google-style: relevance-ranked matches across every string field of every visible thing.',
        method: 'GET',
        query: { q: 'standing desk walnut', limit: 20 }
      },
      {
        name: 'Structured property search',
        description: 'Real datatype conditions on crystal fields — a 60–130cm sit/stand table with wood or concrete top.',
        method: 'POST',
        body: {
          mode: 'all',
          conditions: [
            { field: 'legs', op: 'gte', value: 3 },
            { field: 'material', op: 'in', values: ['wood', 'concrete'] },
            { field: 'height', op: 'between', values: [60, 130] },
            { field: 'features', op: 'contains', value: 'sit/stand' }
          ]
        }
      },
      {
        name: 'Any-of groups + datatype checks',
        description: 'Nested all/any groups compose; type/exists conditions search by developer datatype.',
        method: 'POST',
        body: {
          mode: 'all',
          conditions: [
            { field: 'price', op: 'type', value: 'number' },
            {
              mode: 'any',
              conditions: [
                { field: 'condition', op: 'eq', value: 'new' },
                { field: 'price', op: 'lt', value: 100 }
              ]
            }
          ],
          thingtime: ['post'],
          sort: 'newest'
        }
      },
      {
        name: 'Text + structure together',
        description: 'Relevance-ranked text matching, narrowed by structured conditions.',
        method: 'POST',
        body: {
          q: 'table',
          conditions: [{ field: 'legs', op: 'gte', value: 4 }]
        }
      },
      {
        name: 'Advanced feed shortcuts',
        description: 'The feed/profile Advanced panel: popular long-form posts by one user, tagged desk.',
        method: 'POST',
        body: {
          thingtime: ['post'],
          author: 'rick.deckard',
          tags: 'desk',
          minReactions: 5,
          minComments: 2,
          minTextChars: 200
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Matches, newest or best first.',
        body: {
          ok: true,
          things: [
            {
              id: 'thing_123',
              thingtime: ['post'],
              crystal: { type: 'text', text: 'Standing desk, walnut top, 60–130cm' },
              tags: ['furniture'],
              acl: ['tt:all'],
              visibility: 'public',
              rankScore: 4.25
            }
          ],
          posts: { thing_123: { id: 'thing_123', type: 'text', text: 'Standing desk, walnut top, 60–130cm' } },
          nextCursor: null,
          total: 1,
          totalCapped: false,
          ranked: true
        }
      },
      {
        status: 400,
        description: 'A condition failed the grammar.',
        body: {
          ok: false,
          error: 'Unknown search operator: where (use eq, ne, gt, gte, lt, lte, between, in, nin, exists, type, contains, startsWith, endsWith)'
        }
      }
    ],
    notes: [
      'Browse schemas to search by on /search — picking one prefills conditions from its field definitions (user-authored schema things use thingtime ["schema"]).',
      'contains/startsWith/endsWith match escaped literals case-insensitively; raw regex is deliberately not accepted.',
      'The text index weights crystal.name/crystal.text highest, then titles and tags, then everything else.'
    ]
  }),
  endpoint({
    id: 'things-comment',
    featureVersion: '1.1.0',
    group: 'things',
    title: 'Comment on post',
    endpoint: '/api/v1/things/comment',
    summary: 'Adds a comment — comments share the post schema — to a thing visible to the current user.',
    detail:
			'Simple comments are standalone things (thingtime ["comment"]) pointing at their target via targetId and inheriting its visibility — this route is sugar over the unified thing path. Comments share the post schema: sending post fields (type, richText, images, listing, thing, tags) creates a RICH comment, a full ["post","comment"] thing validated by the post crystal rules, so comments can retain native rich-text presentation, linked photo URLs, marketplace listings, thingtime things, and private purpose=comment uploads. Attachment-only comments and replies are valid. Attachment comments require a stable client-generated shareId and bind every completed attachmentId atomically in the same home transaction as the comment. Comments are reactable and commentable like any post, and every comment has its own /post/:id permalink. The id may be a post or another comment (replies). Visibility is re-checked before writing, and attachment reads inherit the root post ACL through the complete reply chain, so private or circle-limited content stays private.',
    auth: {
      mode: 'session-or-bearer',
      description:
        "Requires an auth cookie or Authorization: Bearer token. App-scoped tokens comment only on things inside their own appId namespace (including other users' app-audience docs when the token holds app-data.shared); the comment is auto-stamped into the namespace, charged against the byte budget, and the returned commentCount is namespace-fenced."
    },
    methods: ['POST'],
    steps: [
      'POST id and text for a simple comment, or id plus post fields (type, images, listing, thing, tags) for a rich comment.',
			'For files, finish purpose=comment uploads and POST their attachmentIds with one stable shareId. The full-account browser mutation must be same-origin JSON.',
      'The target thing (post or comment) must be visible to the current user.',
			'The response comment carries the post vocabulary (reactionCounts, viewerReactions, commentCount, attachments) — use it and commentCount to update the card. A temporarily pending comment remains visible and counted for its author while moderation completes; other viewers do not see it until release.',
      'Handle 401 unauthenticated, 404 not visible, and 400 invalid payload.'
    ],
    requestExamples: [
      {
        name: 'Add comment',
        description: 'Comment on a visible post.',
        method: 'POST',
        body: { id: 'post_123', text: 'I am interested.' }
      },
      {
        name: 'Add rich comment',
        description: 'Comment with photos, like a full post.',
        method: 'POST',
        body: { id: 'post_123', type: 'image', text: 'Here it is!', images: ['https://example.com/photo.jpg'] }
			},
			{
				name: 'Add attachment reply',
				description: 'Reply with a private uploaded image and no text.',
				method: 'POST',
				body: {
					id: 'comment_123',
					shareId: '6db9fbc7-90ec-47ac-878d-3ead5b0ce27d',
					type: 'text',
					text: '',
					attachmentIds: ['att_3f9a7d2c5b1e8046a39f12dc7b5e90186d437be2a059c8f1467e3b9d1c4a502e']
				}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Comment added (post-shaped: reactions, reply count, permalink id).',
        body: {
          ok: true,
          comment: {
            id: 'comment_123',
            thingtime: ['comment'],
            type: 'text',
            text: 'I am interested.',
            reactionCounts: {},
            viewerReactions: [],
            commentCount: 0,
						attachments: [],
            targetId: 'post_123'
          },
          commentCount: 1
        }
      }
		],
		notes: [
			'Uploaded bytes reserve the author account storage tier and remain private behind the stable authorized content route.',
			'Deleting a comment or any ancestor permanently deletes every descendant attachment S3 version before its quota is refunded.',
			'Custom Mongo data planes cannot bind or authorize home S3 comment attachments.'
    ]
  }),
  endpoint({
    id: 'things-delete',
    group: 'things',
    title: 'Delete feed post',
    endpoint: '/api/v1/things/delete',
    summary: 'Deletes one of the current user things (post, comment, reaction, or share).',
    detail:
      'Only the owning user may delete a thing. Deleting a thing also deletes the comment and reaction things attached to it; share things pointing at it survive and render an original-unavailable placeholder.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires an auth cookie or Authorization: Bearer token. App-scoped tokens delete only inside their own appId namespace — the namespace stamp rides the delete filter itself, so anything else 404s — and the freed bytes (cascaded children included) refund the storage ledger.'
    },
    methods: ['POST'],
    steps: [
      'POST the Thing id and, for a previewed mutation, its expectedUpdatedAt timestamp.',
      'The current user must own the post.',
      'On success, remove the post from feed and profile lists.',
      'Handle 401 unauthenticated and 404 for missing or unowned posts.'
    ],
    requestExamples: [
      {
        name: 'Delete post',
        description: 'Delete a caller-owned post.',
        method: 'POST',
        body: { id: 'post_123', expectedUpdatedAt: '2026-08-30T01:02:03.000Z' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Post deleted.',
        body: { ok: true }
      }
    ]
  }),
  endpoint({
    id: 'things-bulk',
    group: 'things',
    title: 'Bulk move / copy / delete / share',
    endpoint: '/api/v1/things/bulk',
    summary: 'Multi-select operations for /things: move, copy, delete, or share up to 100 owned things in one request.',
    detail:
      'Each id runs through the exact single-item path the dedicated endpoints use (updateThing, createThing, deleteThing), so every ownership, protected-kind, folder, and validation rule applies identically — bulk is a loop, never a second code path. move rewrites each thing’s folderId (folderId null or omitted = the /things root; the destination must be one of YOUR folder things). copy mints brand-new things through the real create path (fresh shareId, storage accounting, acl preserved) — comment/reaction/save/share things can’t be copied; copying a FOLDER copies its whole subtree (bounded at 500 things), skipping uncopyable kinds with per-item copied/skipped counts. delete cascades like the single delete (attached comments/reactions/saves go with each thing; deleting a folder re-parents its contents to the folder’s parent instead of deleting them). share applies an acl (or legacy visibility circle) to each thing; with recursive true, folders also apply it to everything inside (same 500-thing bound) — inherit-locked things are counted as skipped, never silently changed. Results are per-item: one bad id never fails the batch.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST op (move, copy, delete, or share), ids (1–100 shareIds you own), and folderId for move/copy destinations.',
      'share additionally takes acl (or legacy visibility) and optional recursive: true to flow a folder’s audience to everything inside.',
      'Read the per-item results list — each entry carries ok plus error (failures), newId (copies), and copied/applied/skipped counts for recursive folder ops.',
      'succeeded and failed counts summarise the batch.',
      'Handle 401 unauthenticated, 400 malformed batches, and 404 for an unknown destination folder.'
    ],
    requestExamples: [
      {
        name: 'Move things into a folder',
        description: 'File two things inside an owned folder thing.',
        method: 'POST',
        body: { op: 'move', ids: ['thing_1', 'thing_2'], folderId: 'folder_abc' }
      },
      {
        name: 'Copy a folder (recursive)',
        description: 'Duplicate a folder and everything inside it at the root.',
        method: 'POST',
        body: { op: 'copy', ids: ['folder_abc'] }
      },
      {
        name: 'Share a folder and its contents',
        description: 'Make a folder and everything inside it friends-visible.',
        method: 'POST',
        body: { op: 'share', ids: ['folder_abc'], acl: ['-tt:all', 'tt:userFriends', 'tt:user'], recursive: true }
      },
      {
        name: 'Bulk delete',
        description: 'Delete a selection of owned things.',
        method: 'POST',
        body: { op: 'delete', ids: ['thing_1', 'thing_2'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Batch processed (per-item results).',
        body: {
          ok: true,
          op: 'move',
          results: [
            { id: 'thing_1', ok: true },
            { id: 'thing_2', ok: false, error: 'Thing not found' }
          ],
          succeeded: 1,
          failed: 1
        }
      },
      {
        status: 200,
        description: 'Recursive folder copy (copied/skipped count the subtree).',
        body: {
          ok: true,
          op: 'copy',
          results: [{ id: 'folder_abc', ok: true, newId: 'thing_xyz', copied: 12, skipped: 1 }],
          succeeded: 1,
          failed: 0
        }
      }
    ],
    notes: [
      'Throttled on the things.write rate limit (things.write.service for service accounts) — one token per batch.',
      'Folders organise /things: create one via POST /api/v1/things with thingtime ["folder"] and crystal { name, icon?, description? }; move a single thing with PATCH /api/v1/things { id, folderId }.'
    ]
  }),
  endpoint({
    id: 'things-feed',
    featureVersion: '1.1.0',
    group: 'things',
    title: 'Feed page',
    endpoint: '/api/v1/things/feed',
    summary: 'Returns public and viewer-visible feed posts with optional algorithm ranking.',
    detail:
      'The feed reads recent posts whose acl admits the viewer (tt:all for logged-out callers, plus your own things when authenticated — acl exclusions like -tt:user/<you> are honoured), applies filters, then optionally ranks them with the selected or active feed algorithm. tag narrows to posts carrying one tag (normalized to the stored trim/lowercase form) — the public tag feeds behind /feed?tag=<tag>.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers see public posts; authenticated callers may also see their own visible circles.'
    },
    methods: ['GET'],
    steps: [
      'Send optional types, circles, tag, from, to, algorithm, cursor, and limit query parameters.',
      'Use algorithm=latest to force chronological ordering.',
      'Use nextCursor for infinite scrolling.',
      'Read ranked to know whether algorithm scoring affected the page.'
    ],
    requestExamples: [
      {
        name: 'Read feed',
        description: 'Fetch a public feed page.',
        method: 'GET',
        query: { types: 'marketplace', circles: 'public', limit: 5 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Feed page returned.',
        body: { ok: true, posts: [], nextCursor: null, ranked: false }
      }
    ]
  }),
  endpoint({
    id: 'things-trending',
    group: 'things',
    title: 'Trending posts',
    endpoint: '/api/v1/things/trending',
    summary: 'Returns the explore board: public posts from the last week ranked by time-decayed engagement.',
    detail:
      'Candidates are public (tt:all) posts created in the last 7 days — the newest 300 are scored in memory as (reactions×3 + comments×4 + pollVotes×2 + views×0.25 + 1) / (hoursOld + 2)^1.4, so fresh engagement outranks stale piles, and the top 30 come back as the same PublicPost projections the feed returns (reactions, comments, polls, and view stats all batch-aggregated). The pool is public-only regardless of who asks; a session only personalises viewer fields like viewerReactions and poll viewerVote.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers get the same board; authenticated callers additionally get their viewer-specific fields.'
    },
    methods: ['GET'],
    steps: [
      'GET the endpoint — no parameters are required.',
      'Send anon=1 from logged-out clients so the response is edge-cacheable (it then depends only on the URL).',
      'Render posts with the same components as the feed; generatedAt timestamps the scoring pass.'
    ],
    requestExamples: [
      {
        name: 'Read trending',
        description: 'Fetch the current trending board.',
        method: 'GET',
        query: { anon: 1 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Trending board returned.',
        body: { ok: true, posts: [], generatedAt: '2026-08-19T00:00:00.000Z' }
      }
    ],
    notes: [
      'Anonymous (anon=1) responses carry Cache-Control: public, s-maxage=300, stale-while-revalidate=900 — the board is served from the Vercel edge and can lag live engagement by a few minutes.'
    ]
  }),
  endpoint({
    id: 'things-rss',
    group: 'things',
    title: 'Public posts Atom feed',
    endpoint: '/api/v1/things/rss',
    summary: 'Returns an Atom (RSS) XML feed of the latest ~50 public posts, newest first.',
    detail:
      'Unlike every other endpoint in this API, the response body is NOT JSON: it is an Atom 1.0 XML document (Content-Type: application/atom+xml; charset=utf-8) suitable for any feed reader. Entries are the newest 50 public (tt:all) posts rendered as the anonymous viewer — the same acl walk and PublicPost projections trending uses, with no viewer-specific fields — each carrying the author handle plus truncated text (or poll question) as <title>, the full text as <content type="text">, the /post/<id> permalink as <link rel="alternate">, and RFC 3339 <published>/<updated> timestamps. All user text is XML-escaped and stripped of XML-invalid control characters.',
    auth: {
      mode: 'none',
      description: 'Always anonymous — cookies and bearer tokens are ignored, so the feed only ever contains public posts.'
    },
    methods: ['GET'],
    steps: [
      'GET the endpoint (or subscribe to it from a feed reader) — no parameters are required.',
      'Parse the body as Atom XML, not JSON; each <entry> links to its /post/<id> permalink.',
      'The app shell also advertises the feed via <link rel="alternate" type="application/atom+xml"> for reader auto-discovery.'
    ],
    requestExamples: [
      {
        name: 'Fetch the feed',
        description: 'Fetch the Atom feed of the latest public posts.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Atom XML feed returned (shown here as a string; the raw body is the XML document itself, not JSON).',
        headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
        body: '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>Thingtime</title>\n  <updated>2026-08-19T00:00:00.000Z</updated>\n  <entry>...</entry>\n</feed>'
      }
    ],
    notes: [
      'Responses carry Cache-Control: public, s-maxage=300, stale-while-revalidate=900 — the feed is served from the Vercel edge and can lag new posts by a few minutes.'
    ]
  }),
  endpoint({
    id: 'things-react',
    group: 'things',
    title: 'React to post',
    endpoint: '/api/v1/things/react',
    summary: 'Toggles one of the current user reactions on a visible post (multi-react).',
    detail:
      'emoji may be a single emoji or a multi-emoji group typed/pasted as one token (e.g. "🤣🤣🙌💀💦"). Toggling a token you already have removes it, a new one is added — you can hold several at once. Adding a token also records it in your recent reactions; posting null is a no-op. Reactions are standalone things (thingtime ["reaction"], crystal.emoji = the token) pointing at their target via targetId — this route is toggle sugar over the unified thing path. Reaction counts are returned for immediate card updates.',
    auth: {
      mode: 'session-or-bearer',
      description:
        "Requires an auth cookie or Authorization: Bearer token. App-scoped tokens react only to things inside their own appId namespace; counts come back namespace-fenced and the user's personal recent-reactions list is never touched."
    },
    methods: ['POST'],
    steps: [
      'POST id and emoji (a single emoji or a multi-emoji token), or emoji null for a no-op.',
      'The post must be visible to the current user.',
      'Use reactionCounts and viewerReactions to update UI state; recentReactions (present when a token was added) refreshes the picker.',
      'Handle 401 unauthenticated and 404 for missing or not-visible posts.'
    ],
    requestExamples: [
      {
        name: 'Toggle reaction',
        description: 'Add or remove one reaction token on a post.',
        method: 'POST',
        body: { id: 'post_123', emoji: '🤣🤣🙌💀💦' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Reaction toggled.',
        body: {
          ok: true,
          reactionCounts: { '👍': 3, '🤣🤣🙌💀💦': 1 },
          viewerReactions: ['👍', '🤣🤣🙌💀💦'],
          recentReactions: ['🤣🤣🙌💀💦', '👍']
        }
      }
    ]
  }),
  endpoint({
    id: 'things-save',
    group: 'things',
    title: 'Save to library',
    endpoint: '/api/v1/things/save',
    summary: 'Toggles a private library save of a visible thing ("add to my library").',
    detail:
      'Saves are relational child things (thingtime ["save"], targetId = the saved thing, acl ' +
      '["tt:user"]) — always private to the saver, never inheriting the target audience, so a ' +
      'library is personal by construction. Toggling an existing save removes it. List saved ' +
      'posts via GET /api/v1/things/saved, saved schemas via /api/v1/schemas/browse?library=1, ' +
      'or raw saves via GET /api/v1/things?thingtime=save.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the id of the thing to save (or unsave).',
      'The thing must be visible to the current user.',
      'Use the returned saved boolean to flip the UI state optimistically.',
      'Handle 401 unauthenticated and 404 for missing or not-visible things.'
    ],
    requestExamples: [
      {
        name: 'Toggle save',
        description: 'Add or remove a thing from the caller library.',
        method: 'POST',
        body: { id: 'schema_table_001' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Save toggled.',
        body: { ok: true, saved: true }
      }
    ]
  }),
  endpoint({
    id: 'things-saved',
    group: 'things',
    title: 'Saved library',
    endpoint: '/api/v1/things/saved',
    summary: 'Lists the posts the current user saved to their library, newest-saved-first.',
    detail:
      'Reads the caller’s save things (written by POST /api/v1/things/save) newest first and batch-loads ' +
      'their post-shaped targets in two indexed queries — never N+1. Targets that no longer resolve ' +
      '(deleted, audience narrowed since the save, or not post-shaped, e.g. a saved schema) are silently ' +
      'skipped rather than erroring — the library fails closed. Posts come back as the same PublicPost ' +
      'projections the feed returns (reactions, comments, polls, view stats, viewerSaved: true), ordered by ' +
      'when they were SAVED, not when they were posted. Pagination uses the feed’s stable ' +
      '(createdAt, shareId) cursor over the save things; the cursor advances over the raw save page so ' +
      'skipped rows are dropped, not resurfaced.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token — a library is personal by construction, so there is no anonymous view.'
    },
    methods: ['GET'],
    steps: [
      'GET the endpoint — no parameters are required for the first page (default limit 30, max 50).',
      'Render posts with the same components as the feed; every entry carries viewerSaved: true.',
      'Pass nextCursor back as cursor for the next page; null means the library is fully paged.',
      'Handle 401 unauthenticated.'
    ],
    requestExamples: [
      {
        name: 'Read the library',
        description: 'Fetch the first page of saved posts.',
        method: 'GET'
      },
      {
        name: 'Next page',
        description: 'Continue from a previous response’s nextCursor.',
        method: 'GET',
        query: { cursor: '1755500000000_post_123', limit: 30 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Saved posts returned, newest-saved-first.',
        body: { ok: true, posts: [], nextCursor: null }
      }
    ],
    notes: ['Responses carry Cache-Control: private, no-store — the library is viewer-specific and never edge-cached.']
  }),
  endpoint({
    id: 'things-vote',
    group: 'things',
    title: 'Vote on poll',
    endpoint: '/api/v1/things/vote',
    summary: 'Casts (or moves, or removes) the current user vote on a visible poll thing.',
    detail:
      'Polls are posts (or data things) whose thing carries a string question plus an options ' +
      'list of 2+ entries. One vote per (user, poll), enforced structurally: votes are standalone ' +
      'things (thingtime ["vote"], crystal.optionIndex, targetId = the poll, acl ["tt:inherit"]) ' +
      'deduped by a server-written crystal.voteKey ("<pollId>~<userId>") under a partial unique ' +
      'index. Voting a DIFFERENT option moves your vote (the doc updates in place); voting the ' +
      'SAME option again removes it (toggle off, matching reactions). The poll must be visible ' +
      'to the caller — acl and inherit chains are re-checked on every vote. Live tallies ride ' +
      'poll posts as pollVotes wherever posts are projected (feed, /post/:id, profiles).',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token. Anonymous viewers see results only.'
    },
    methods: ['POST'],
    steps: [
      'POST the poll thing id and the zero-based optionIndex to vote for.',
      'The poll must be visible to the current user and optionIndex must be inside its options list.',
      'Use the returned pollVotes (counts per option, totalVotes, viewerVote) to reconcile the card.',
      'Handle 401 unauthenticated, 404 for missing or not-visible polls, and 400 for non-polls or out-of-range options.'
    ],
    requestExamples: [
      {
        name: 'Cast a vote',
        description: 'Vote for the second option of a poll.',
        method: 'POST',
        body: { id: 'poll_123', optionIndex: 1 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Vote recorded — the fresh tally comes back for immediate reconciliation.',
        body: {
          ok: true,
          pollVotes: { counts: [3, 5, 1], totalVotes: 9, viewerVote: 1 }
        }
      }
    ]
  }),
  endpoint({
    id: 'things-reactions-recent',
    group: 'things',
    title: 'Recent reactions',
    endpoint: '/api/v1/things/reactions-recent',
    summary: 'Returns the caller recently-used emoji tokens (most-recent-first).',
    detail:
      'The custom-emoji picker loads this lazily when it opens and pages through it 20 at a time. Tokens are single emoji or multi-emoji groups. Anonymous callers get an empty list.',
    auth: {
      mode: 'optional',
      description: 'Reads the auth cookie or Bearer token when present; anonymous callers receive an empty list.'
    },
    methods: ['GET'],
    steps: [
      'Send a GET request with credentials or a bearer token.',
      'Render recentReactions in the picker, 20 at a time with a "show more" pager.',
      'Seed from a local snapshot first for an instant render, then reconcile with this response.'
    ],
    requestExamples: [
      {
        name: 'Load recent reactions',
        description: 'Fetch the caller recently-used emoji.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Recently-used tokens, newest first.',
        body: { ok: true, recentReactions: ['🤣🤣🙌💀💦', '👍', '🔥', '💀'] }
      }
    ]
  }),
  endpoint({
    id: 'things-share',
    featureVersion: '1.1.0',
    group: 'things',
    title: 'Share post',
    endpoint: '/api/v1/things/share',
    summary: 'Creates a share post that points back to a visible root post.',
    detail: 'Shares copy the root post reference rather than chaining share-of-share references, so delete and count behavior stays deterministic.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST the post id plus optional text, tags, and visibility.',
      'The source post must be public or owned/visible to the current user.',
      'Optional tags (e.g. inline #hashtags harvested from the caption) merge with the tags carried from the original.',
      'Use the returned share post to update feed state.',
      'Handle 401 unauthenticated and 404 for missing or not-visible posts.'
    ],
    requestExamples: [
      {
        name: 'Share post',
        description: 'Create a repost with optional commentary — caption hashtags ride along as tags.',
        method: 'POST',
        body: { id: 'post_123', text: 'Worth saving #vibes', tags: ['vibes'], visibility: 'public' }
      },
      {
        name: 'Share to your friends only',
        description: 'Shares take acls too.',
        method: 'POST',
        body: { id: 'post_123', text: 'Keeping this in the circle', acl: ['-tt:all', 'tt:userFriends', 'tt:user'] }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Share created — a thing carrying both the post and share schemas.',
        body: { ok: true, post: { id: 'share_123', thingtime: ['post', 'share'], isShare: true } }
      }
    ]
  }),
  endpoint({
    id: 'things-update',
    featureVersion: '1.2.0',
    group: 'things',
    title: 'Update thing',
    endpoint: '/api/v1/things/update',
    summary: 'Updates one of the current user things — crystal payload, acl audience, or tags.',
    detail:
      'Sugar over PATCH /api/v1/things: crystal patches merge over the existing crystal and are re-validated against the thing schemas in its thingtime array; replaceCrystal=true takes the supplied crystal whole. expectedUpdatedAt provides an atomic optimistic-concurrency precondition for signed MCP previews and other safe clients. acl (or a legacy visibility name) retargets the audience. Updating a pre-unification post upgrades it to the v2 doc shape in place. Attached things keep their inherited audience. Saving a webpage thing (create or update) additionally binds the owner\'s own ready builder uploads referenced by its media blocks to the page — clearing their draft expiry and inheriting the page\'s audience; foreign or external references are left untouched.',
    auth: {
      mode: 'session-or-bearer',
      description:
        'Requires an auth cookie or Authorization: Bearer token. App-scoped tokens update only inside their own appId namespace: the acl clamp applies like every app write and size deltas are charged against the byte budget.'
    },
    methods: ['POST'],
    steps: [
      'POST the thing id plus any of crystal, extended, visibility, and tags.',
      'Crystal fields you omit keep their current values; included fields are validated by the thing schemas. For posts, a text patch from an older/plain client that omits richText intentionally clears the previous rich-text document.',
      'For a previewed update, send expectedUpdatedAt; a stale value returns 409 without writing. Set replaceCrystal only when whole-crystal replacement is intended.',
      'extended replaces as a whole value when provided (null clears it) — it is never deep-merged.',
      'The current user must own the thing.',
      'Handle 401 unauthenticated, 404 missing or unowned things, and 400 invalid patches.'
    ],
    requestExamples: [
      {
        name: 'Edit post text',
        description: 'Patch the crystal text of an owned post.',
        method: 'POST',
        body: { id: 'post_123', crystal: { text: 'Today I learned (edited)...' } }
      },
      {
        name: 'Retarget the audience',
        description: 'Swap the acl to friends-only without touching the crystal.',
        method: 'POST',
        body: { id: 'post_123', acl: ['-tt:all', 'tt:userFriends', 'tt:user'] }
      },
      {
        name: 'Apply a previewed replacement',
        description: 'Whole-crystal replacement guarded by the version inspected in the preview.',
        method: 'POST',
        body: { id: 'post_123', crystal: { type: 'text', text: 'Reviewed replacement' }, replaceCrystal: true, expectedUpdatedAt: '2026-08-30T01:02:03.000Z' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Thing updated.',
        body: {
          ok: true,
          thing: { id: 'post_123', thingtime: ['post'], crystal: { text: 'Today I learned (edited)...' } },
          post: { id: 'post_123', text: 'Today I learned (edited)...' }
        }
      }
    ]
  }),
  endpoint({
    id: 'things-user',
    featureVersion: '1.1.0',
    group: 'things',
    title: 'User posts',
    endpoint: '/api/v1/things/user',
    summary: 'Returns posts for a public profile, filtered by viewer visibility.',
    detail: 'Profile pages use this route to page through a user posts. Owners can see their full circle set; other viewers only see public content.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers can read public posts; authenticated callers may see their own broader visibility.'
    },
    methods: ['GET'],
    steps: [
      'Send username, optional cursor, and optional limit query parameters.',
      'Use nextCursor to fetch more posts.',
      'Read postCount for profile summary display.',
      'Handle 400 missing username and 404 unknown user.'
    ],
    requestExamples: [
      {
        name: 'Read user posts',
        description: 'Fetch public posts for a profile.',
        method: 'GET',
        query: { username: 'rick.deckard', limit: 10 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'User posts returned.',
        body: { ok: true, posts: [], nextCursor: null, postCount: 0 }
      }
    ]
  }),
  endpoint({
    id: 'tokens',
    group: 'tokens',
    title: 'Personal access tokens',
    endpoint: '/api/v1/tokens',
    summary: 'Mint and list scoped API tokens — hand one to an AI or script so it can work your things.',
    detail:
      'Personal access tokens (minted in Settings → Token minter, or here) are scoped, revocable Bearer credentials for the things API — made to hand to an AI agent or script so it can push new things, update things, and scan your things without your password. GET lists your tokens plus the scope and visibility catalogs; POST mints one: { name?, scopes: string[], expiresInMs?: number|null, maxUses?: number|null, onlyCreatedThings?: boolean, visibility?: "all"|"public"|"private" }. Scopes are dot paths with ancestor coverage — "things" covers every "things.*" leaf (read, create, update, delete, comment, react, save, share); upserts (PUT /api/v1/things) need BOTH things.create and things.update. Lifetime is two independent dials: expiresInMs from 1 (one millisecond) to null (never expires), and maxUses from 1 to null (unlimited) — each successfully authenticated request consumes one use; a missing-scope 403 consumes nothing. onlyCreatedThings: true sandboxes the token to its granted things — every thing it creates carries its tt:token/<token id> entry in the thing’s tokenAcl grant list, and its updates, deletes, comments, reactions, saves and shares only work on things whose tokenAcl carries its entry (403 anywhere else; reads still follow things.read). Grants layer: put several tokens’ entries on one thing (tokenAcl on create, or replace it whole via PATCH/PUT /api/v1/things) and those sandboxed tokens overlap on it. visibility fences the token to one audience of things: "public" means it only sees and touches world-visible things (acl tt:all — your private things stay invisible to it, and everything it creates or edits must stay public), "private" means it only sees and touches non-public things (it cannot read the public feed, publish, or engage publicly; its standalone creations default to acl ["tt:user"]), and "all" (the default) applies no fence. The fence covers reads AND writes, resolves inherited audiences through the target chain (a comment is as public as its post), and 403s with a clear message when a mutation crosses it. The token string is returned ONCE and never shown again (only the revocable session record is kept). Tokens work ONLY on the things routes plus /api/v1/tokens/self — they cannot manage tokens, change auth settings, or reach any other surface.',
    auth: {
      mode: 'session',
      description: 'Full session (cookie or service-account Bearer) required — a personal access token can never mint or list tokens.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET to list your tokens (newest first) and the scope catalog for pickers.',
      'POST { name, scopes, expiresInMs, maxUses } to mint — omit/null expiresInMs for never, omit/null maxUses for unlimited.',
      'Copy the returned token immediately; it is shown exactly once.',
      'Send it as Authorization: Bearer <token> against the things routes.',
      'Revoke anytime via POST /api/v1/tokens/revoke.'
    ],
    requestExamples: [
      { name: 'List tokens', description: 'Your minted tokens + the scope catalog.', method: 'GET' },
      {
        name: 'Mint for an AI agent',
        description: 'Full things access, expires in 7 days.',
        method: 'POST',
        body: { name: 'Claude research agent', scopes: ['things'], expiresInMs: 604800000, maxUses: null }
      },
      {
        name: 'Mint a single-use pusher',
        description: 'Can create exactly one thing, never expires.',
        method: 'POST',
        body: { name: 'One-shot webhook', scopes: ['things.create'], expiresInMs: null, maxUses: 1 }
      },
      {
        name: 'Mint a sandboxed agent',
        description: 'Full verbs, but only over things this token itself creates.',
        method: 'POST',
        body: { name: 'Sandboxed agent', scopes: ['things'], expiresInMs: 604800000, onlyCreatedThings: true }
      },
      {
        name: 'Mint a public-only agent',
        description: 'Full verbs over public things only — private things stay invisible to it.',
        method: 'POST',
        body: { name: 'Public-sphere agent', scopes: ['things'], expiresInMs: 604800000, visibility: 'public' }
      },
      {
        name: 'Mint a private-only agent',
        description: 'Works your private things only — it can never see or touch anything public.',
        method: 'POST',
        body: { name: 'Private vault agent', scopes: ['things.read', 'things.create', 'things.update'], expiresInMs: 604800000, visibility: 'private' }
      }
    ],
    responseExamples: [
      {
        status: 201,
        description: 'Token minted — the token string appears only in this response.',
        body: {
          ok: true,
          token: 'eyJhbGciOi…',
          tokenType: 'Bearer',
          tokenInfo: {
            id: 'jti-uuid',
            name: 'Claude research agent',
            scopes: ['things'],
            visibility: 'all',
            expiresAt: '2026-08-05T00:00:00.000Z',
            maxUses: null,
            usesRemaining: null,
            status: 'active'
          },
          example: "curl -H 'Authorization: Bearer eyJhbGciOi…' 'https://thingtime.com/api/v1/things'",
          docs: 'https://thingtime.com/api/docs'
        }
      },
      { status: 400, description: 'Unknown scope.', body: { ok: false, error: 'Unknown scope: things.telepathy' } }
    ],
    notes: [
      'Scope catalog: things, things.read, things.create, things.update, things.delete, things.comment, things.react, things.save, things.share.',
      'Expiry is enforced at millisecond precision server-side; the sessions TTL index reaps expired tokens, so they eventually disappear from the list.',
      'onlyCreatedThings sandbox: scopes say WHAT verbs, tokenAcl grants say ON WHICH things. A sandboxed token needs its tt:token/<id> entry on the thing — its own creations carry it automatically, the owner (or any credential that can update the thing) layers more tokens on by editing tokenAcl, and removing an entry revokes that token’s reach immediately. Re-sharing a token-created share of a foreign post still blocks (shares attach to the root).',
      'visibility fence: the third axis — scopes say WHAT verbs, tokenAcl says WHICH things, visibility says WHICH AUDIENCE. "public" and "private" partition things by whether their (inherit-resolved) acl carries tt:all; both directions of the boundary are locked (a public-only token cannot make a public thing private, a private-only token cannot publish). Tokens minted before this field behave as "all". Combines freely with onlyCreatedThings.',
      'tokenAcl entries for revoked or unknown tokens are inert (the credential can’t authenticate), so grant lists never need cleanup to stay safe.',
      'At most 200 tokens per user — revoke old ones to make room.'
    ]
  }),
  endpoint({
    id: 'tokens-revoke',
    group: 'tokens',
    title: 'Revoke a token',
    endpoint: '/api/v1/tokens/revoke',
    summary: 'Kill one of your personal access tokens immediately.',
    detail:
      'POST { id } (the id from the tokens list / mint response) revokes the token server-side — the very next request with it fails, whatever its expiry or remaining uses. Owner-bound and idempotent. Revoked never-expiring tokens are kept visible for ~30 days, then reaped.',
    auth: { mode: 'session', description: 'Full session required — a personal access token cannot revoke tokens.' },
    methods: ['POST'],
    steps: ['List your tokens to find the id.', 'POST { id } to revoke.', 'The token stops resolving immediately (its session record is revoked).'],
    requestExamples: [{ name: 'Revoke', description: 'Revoke one token by id.', method: 'POST', body: { id: 'jti-uuid' } }],
    responseExamples: [
      {
        status: 200,
        description: 'Revoked (idempotent).',
        body: { ok: true, token: { id: 'jti-uuid', name: 'Claude research agent', status: 'revoked' } }
      },
      { status: 404, description: 'Not yours / unknown.', body: { ok: false, error: 'Token not found' } }
    ]
  }),
  endpoint({
    id: 'tokens-self',
    group: 'tokens',
    title: 'Token introspection',
    endpoint: '/api/v1/tokens/self',
    summary: 'Ask a token who it is and what it can do — without spending a use.',
    detail:
      'GET with the personal access token as Authorization: Bearer <token> returns the token record (name, scopes, visibility, onlyCreatedThings, expiresAt, maxUses, usesRemaining, status) plus a minimal owner identity { id, username, displayName }. Deliberately free: introspection never consumes a use, so a 1-use token can check its powers before spending its only call. If you are an AI that has just been handed a token — call this first, then fetch /api/docs for the full API reference.',
    auth: { mode: 'bearer', description: 'Personal access token as a Bearer header — full sessions and app tokens are rejected here.' },
    methods: ['GET'],
    steps: [
      'Send the token as Authorization: Bearer <token>.',
      'Read scopes + usesRemaining to know what you can afford to do.',
      'Fetch /api/docs for the full endpoint reference.'
    ],
    requestExamples: [{ name: 'Introspect', description: 'Who am I and what can I do?', method: 'GET' }],
    responseExamples: [
      {
        status: 200,
        description: 'The token’s own record.',
        body: {
          ok: true,
          token: { id: 'jti-uuid', name: 'One-shot webhook', scopes: ['things.create'], maxUses: 1, usesRemaining: 1, status: 'active' },
          user: { id: '64f000000000000000000002', username: 'ada-lovelace', displayName: 'Ada' }
        }
      },
      { status: 401, description: 'Not a live PAT.', body: { ok: false, error: 'Token is invalid, expired, or revoked' } }
    ]
  }),
  endpoint({
    id: 'users-profile',
    group: 'profile',
    title: 'User profile',
    endpoint: '/api/v1/users/profile',
    summary: 'Reads public profiles or updates the current user profile fields.',
    detail:
      'GET returns a stripped public projection that never includes email, verification fields, or the ' +
      'birthday, plus wornTheme ({id, name} of the profile owner’s active theme, resolved through the ' +
      'public share gate — null when unset or private). POST updates the caller display name, bio, ' +
      'avatar, banner, or birthday. Avatar/banner may use either one external http(s) URL or a ready ' +
      'private attachment created for the exact profile slot; managed media remains in the private ' +
      'bucket and is served through a stable same-origin content route. Birthday is YYYY-MM-DD, ' +
      'private — stored in the secure blob and shared with apps only via the exact profile.birthday scope.',
    auth: {
      mode: 'optional',
      description: 'GET is public. POST requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with username to read a public profile and post count.',
			'POST displayName, bio, or birthday independently of profile media.',
			'Use avatarAttachmentId or bannerAttachmentId to bind a ready owner-matched profile upload. Use avatarUrl or bannerUrl for the quota-saving external-link alternative; sending a URL clears that slot’s managed attachment.',
			'Never send a non-null attachment id with a URL. Send both fields as null to clear a slot, or send only attachmentId:null to remove managed media while preserving its stored external fallback.',
			'External writes accept structurally valid credential-free http(s) URLs; legacy data:image values remain read-compatible.',
      'birthday must be a real YYYY-MM-DD date between 1900-01-01 and today (null clears it); it is never returned on public profiles.',
      'Handle 400 missing username or invalid profile fields, 401 anonymous updates, and 404 unknown users.'
    ],
    requestExamples: [
      {
        name: 'Read public profile',
        description: 'Fetch a public profile.',
        method: 'GET',
        query: { username: 'rick.deckard' }
      },
      {
        name: 'Update profile',
        description: 'Update the caller profile fields.',
        method: 'POST',
        body: { bio: 'Working on Thingtime.', avatarUrl: 'https://example.com/avatar.png' }
			},
			{
				name: 'Use a private uploaded banner',
				description: 'Bind a completed profile-banner upload to the current user.',
				method: 'POST',
				body: { bannerAttachmentId: 'att_3f9a7d2c5b1e8046a39f12dc7b5e90186d437be2a059c8f1467e3b9d1c4a502e' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Public profile returned.',
        body: {
          ok: true,
          profile: { username: 'rick.deckard', displayName: 'Rick Deckard' },
          postCount: 0,
          wornTheme: { id: 'theme_123', name: 'Neon Noir' }
        }
      },
      {
        status: 401,
        description: 'Anonymous caller attempted a profile update.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
  endpoint({
    id: 'users-search',
    group: 'profile',
    title: 'Search people',
    endpoint: '/api/v1/users/search',
    summary: 'Public people search — matches usernames and display names for the /search People rail.',
    detail:
      'Escaped-literal, case-insensitive matching on username and displayName only (never email — an ' +
      'address can’t be reversed to an account). Returns public profile projections: username, ' +
      'displayName, bio, avatar/banner URLs, createdAt. Users live in the users collection, not ' +
      'things, so /api/v1/things/search never sees them — this endpoint is how the search page ' +
      'surfaces people alongside things.',
    auth: {
      mode: 'optional',
      description: 'Works logged out; anonymous callers are rate-limited per hashed IP.'
    },
    methods: ['GET'],
    steps: [
      'GET ?q=<text>&limit= — empty q returns an empty list.',
      'Render results as profile links (/profile/<username>).',
      'Handle 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Find people',
        description: 'Match usernames and display names.',
        method: 'GET',
        query: { q: 'lopu', limit: 8 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Matching public profiles.',
        body: {
          ok: true,
          users: [{ id: '664f…', username: 'lopu', displayName: 'Lopu', bio: 'Making Thingtime 🦄', avatarUrl: null }]
        }
      }
    ]
  }),
  endpoint({
    id: 'users-follow',
    group: 'social',
    title: 'Read or change a follow',
    endpoint: '/api/v1/users/follow',
    summary: 'Read, follow, or unfollow another user — one-way, no approval needed.',
    detail:
      'GET with username or userId returns the public user, both follow directions, and follower/following ' +
      'counts. POST writes one home-pinned thingtime ["follow"] edge per follower/followed pair, deduped by ' +
      'its crystal.followKey unique index. Omitting `follow` toggles; passing it explicitly is idempotent. ' +
      'A new follow emits a new-follower notification to the followed user (respecting their ' +
      'notification prefs). Follow state also routes Messenger DMs out of the message-requests pile. ' +
      'Friendships are a separate, approval-based system — see /api/v1/users/friend.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET with userId or username to read the relationship, public user, and counts.',
      'POST { userId } or { username } to toggle that follow.',
      'Optionally pass follow: true|false for an idempotent set instead of a toggle.',
      'Read following, followsYou, followerCount, and followingCount back and reconcile the optimistic UI.',
      'Handle 400 self-follow, 401 unauthenticated, 404 unknown user, 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Read a relationship',
        description: 'Check both follow directions and counts for one user.',
        method: 'GET',
        query: { username: 'ada-lovelace' }
      },
      {
        name: 'Toggle follow',
        description: 'Follow (or unfollow, if already following) by user id.',
        method: 'POST',
        body: { userId: '664f1c2a9d3e5b0012345678' }
      },
      {
        name: 'Explicit follow',
        description: 'Idempotent follow by username.',
        method: 'POST',
        body: { username: 'lopu', follow: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Relationship returned after a read or mutation.',
        body: {
          ok: true,
          user: { id: 'c0ffee12-cccc-4ccc-8ccc-000000000003', username: 'ada-lovelace' },
          following: true,
          followsYou: false,
          followerCount: 42,
          followingCount: 17
        }
      },
      {
        status: 400,
        description: 'Self-follow.',
        body: { ok: false, error: 'You already have your own undivided attention 💅' }
      }
    ],
    notes: ['POST changes draw from the users.follow rate-limit bucket (30 requests per minute).']
  }),
  endpoint({
    id: 'users-friend',
    group: 'social',
    title: 'Friend request actions',
    endpoint: '/api/v1/users/friend',
    summary: 'Drive the friendship state machine: request, cancel, accept, decline, unfriend.',
    detail:
      'Friendships need approval (unlike follows): one thing per user pair (thingtime ["friend"], ' +
      'crystal.friendKey = sorted pair, unique index), status pending until the recipient accepts. ' +
      'Requesting someone who already requested you accepts instead of duplicating. Requests emit ' +
      'friend-request notifications; accepts emit friend-accepted. Accepted friendships power the ' +
      'tt:userFriends acl circle — friends-only posts become visible to real friends.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST { userId | username, intent } — intent: request | cancel | accept | decline | unfriend.',
      'request → pending-outgoing (or friends, if they had already asked you).',
      'accept/decline act on a pending-incoming request; cancel retracts your own.',
      'Read { friendState } back: none | pending-outgoing | pending-incoming | friends.',
      'Handle 400 bad intent/self, 401 unauthenticated, 404 unknown user or no pending request, 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Send request',
        description: 'Ask another user to be friends.',
        method: 'POST',
        body: { username: 'lopu', intent: 'request' }
      },
      {
        name: 'Accept request',
        description: 'Accept a pending incoming request.',
        method: 'POST',
        body: { userId: '664f1c2a9d3e5b0012345678', intent: 'accept' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Request sent.',
        body: { ok: true, friendState: 'pending-outgoing' }
      },
      {
        status: 404,
        description: 'Nothing to accept.',
        body: { ok: false, error: 'No pending friend request from that user' }
      }
    ]
  }),
  endpoint({
    id: 'users-relationships',
    group: 'social',
    title: 'Relationship summary',
    endpoint: '/api/v1/users/relationships',
    summary: 'Public follower/following/friend counts for a profile, plus the viewer’s relationship state.',
    detail:
      'Counts are public (they render on every profile). When authenticated, `viewer` reports your ' +
      'relationship to that user: following, followedBy, and friendState (none | pending-outgoing | ' +
      'pending-incoming | friends). Asking about yourself adds incomingRequests — the pending ' +
      'friend-request badge count. Logged out, `viewer` is null.',
    auth: {
      mode: 'optional',
      description: 'Works logged out (counts only); anonymous callers are rate-limited per hashed IP.'
    },
    methods: ['GET'],
    steps: [
      'GET ?username=<name> (or ?userId=).',
      'Render counts on the profile header; drive the Follow / Add friend buttons from `viewer`.',
      'Handle 404 unknown user and 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Profile summary',
        description: 'Counts + viewer state for a profile page.',
        method: 'GET',
        query: { username: 'lopu' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Counts and the viewer’s state.',
        body: {
          ok: true,
          userId: '664f…',
          counts: { followers: 12, following: 34, friends: 5 },
          viewer: { following: true, followedBy: false, friendState: 'friends' }
        }
      }
    ]
  }),
  endpoint({
    id: 'users-activity',
    group: 'profile',
    title: 'Activity heatmap',
    endpoint: '/api/v1/users/activity',
    summary: 'Day-bucketed counts of a user’s viewer-visible things over the last year (the profile contribution graph).',
    detail:
      'Returns `days` — a map of UTC `YYYY-MM-DD` day strings to how many things the user created that ' +
      'day — plus `total` and `firstDayUtc` (the first counted UTC day — the Sunday opening the 53-week ' +
      'grid, so the window is exactly the days a Sunday-first contribution grid renders). Counts only: no content, ' +
      'no kind breakdown. Visibility matches the profile post list exactly: logged out you count public ' +
      'things only, friends additionally count friends-circle things, and owners count everything they ' +
      'own. User actions (posts, comments, reactions, saves, poll votes, folders, schemas…) count; ' +
      'server-minted control-plane records (notifications, friend/subscription state, messenger index ' +
      'rows…) never do.',
    auth: {
      mode: 'optional',
      description: 'Works logged out (public activity only); anonymous callers are rate-limited per hashed IP.'
    },
    methods: ['GET'],
    steps: [
      'GET ?username=<name>.',
      'Render `days` as a 53×7 contribution grid; missing days mean zero.',
      'Handle 404 unknown user and 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Profile activity',
        description: 'A year of day-counts for a profile heatmap.',
        method: 'GET',
        query: { username: 'lopu' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Day-counts for the last year.',
        body: {
          ok: true,
          days: { '2026-08-01': 3, '2026-08-14': 1 },
          total: 4,
          firstDayUtc: '2025-08-17'
        }
      },
      { status: 404, description: 'Unknown user.', body: { ok: false, error: 'User not found' } }
    ]
  }),
  endpoint({
    id: 'users-connections',
    group: 'social',
    title: 'Connection lists',
    endpoint: '/api/v1/users/connections',
    summary: 'Paged public lists of a user’s followers, following, or friends (and your own pending requests).',
    detail:
      'type=followers|following|friends return public profile projections for anyone (matching the ' +
      'public counts). type=requests lists the PENDING incoming friend requests — only for your own ' +
      'account (403 otherwise). Cursor pagination: pass back `nextBefore` as `before` until it is null.',
    auth: {
      mode: 'optional',
      description: 'Public lists work logged out; type=requests requires auth and your own userId/username.'
    },
    methods: ['GET'],
    steps: [
      'GET ?username=<name>&type=followers|following|friends&limit=&before=.',
      'Render as profile rows; page with before=<nextBefore>.',
      'type=requests (your own account) powers the accept/decline inbox.',
      'Handle 400 bad type, 403 requests-for-someone-else, 404 unknown user, 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Followers list',
        description: 'First page of a user’s followers.',
        method: 'GET',
        query: { username: 'lopu', type: 'followers', limit: 20 }
      },
      {
        name: 'Pending requests',
        description: 'Your own incoming friend requests.',
        method: 'GET',
        query: { username: 'me-myself', type: 'requests' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'One page of public profiles.',
        body: {
          ok: true,
          users: [{ id: '664f…', username: 'rick', displayName: 'Rick Deckard', avatarUrl: null }],
          nextBefore: null
        }
      }
    ]
  }),
  endpoint({
    id: 'notifications-list',
    group: 'notifications',
    title: 'List notifications',
    endpoint: '/api/v1/notifications',
    summary: 'Your notifications, newest first, filtered by your notification prefs — plus the unread count.',
    detail:
      'Notifications are server-minted things (new followers, friend requests/accepts, comments, ' +
      'replies, reactions, shares, and capped posts-from-followed/friends fan-out). The list is ' +
      'ALWAYS filtered by your current notification settings, so disabling a type hides even ' +
      'already-written notifications of that type. unreadCount backs the bell badge. Cursor ' +
      'pagination via before=<nextBefore>.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET'],
    steps: [
      'GET ?limit=&before= — newest first.',
      'Show unreadCount on the bell; refetch on window focus.',
      'Click-through: postId → /post/<id>, otherwise actor → /profile/<username>.',
      'Handle 401 unauthenticated and 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Bell dropdown',
        description: 'First page for the notifications popover.',
        method: 'GET',
        query: { limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Notifications + unread count.',
        body: {
          ok: true,
          notifications: [
            {
              id: 'a1b2…',
              type: 'new-follower',
              actorId: '664f…',
              actorUsername: 'rick',
              actorName: 'Rick Deckard',
              actorAvatarUrl: null,
              targetId: '664f…',
              postId: null,
              preview: null,
              readAt: null,
              createdAt: '2026-08-01T12:00:00.000Z'
            }
          ],
          unreadCount: 1,
          nextBefore: null
        }
      }
    ]
  }),
  endpoint({
    id: 'notifications-read',
    group: 'notifications',
    title: 'Mark notifications read',
    endpoint: '/api/v1/notifications/read',
    summary: 'Mark some ({ ids }) or all ({ all: true }) of your notifications as read.',
    detail:
      'Flips root readAt on your unread notification things; the unread badge recomputes from it. ' +
      'Already-read ids are skipped (updated counts only fresh flips).',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['POST'],
    steps: [
      'POST { all: true } when opening the bell, or { ids: [...] } for targeted marks.',
      'Optimistically zero the badge; reconcile with the response.',
      'Handle 400 (neither ids nor all), 401 unauthenticated, 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Mark all read',
        description: 'Zero the bell badge.',
        method: 'POST',
        body: { all: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Marked.',
        body: { ok: true, updated: 3 }
      }
    ]
  }),
  endpoint({
    id: 'notifications-settings',
    group: 'notifications',
    title: 'Notification settings',
    endpoint: '/api/v1/notifications/settings',
    summary: 'Read or merge-patch your notification switches — per type, per channel (push + email), plus channel masters.',
    detail:
      'Two channels: push (the bell/in-app channel) and email (SES-backed notification emails), each ' +
      'with a master switch and per-type switches. Types: friend-request, friend-accepted, ' +
      'new-follower, post-from-followed, post-from-friend, comment, reply, reaction, share, mention, groups ' +
      '(reserved), plus the email-only weekly-summary digest. Defaults ON, except email for the two ' +
      'high-volume post types (post-from-followed / post-from-friend), which are opt-in. GET always ' +
      'returns the full matrix. POST merges only the keys you send — the new channel shape ' +
      '{ prefs: { push?, email?, masters? } } or the original flat { prefs: { <type>: boolean } } ' +
      '(which patches the push channel); unknown keys 400. A disabled push type is hidden from your ' +
      'list and unread count immediately; a disabled email type stops future emails. Emails only go ' +
      'to verified addresses and are capped per recipient per hour; every one carries a manage link ' +
      'and a one-click unsubscribe link.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Requires an auth cookie or Authorization: Bearer token.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'GET returns { prefs: { push, email, masters } } with every switch as a boolean.',
      'POST { prefs: { email: { <type>: boolean } } } (or push / masters) merges just those switches.',
      'The flat legacy body { prefs: { <type>: boolean } } still works and patches push.',
      'Flip switches optimistically; revert on failure.',
      'Handle 400 unknown key / non-boolean, 401 unauthenticated, 429 rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Disable follower emails',
        description: 'Stop new-follower emails only — the bell keeps working.',
        method: 'POST',
        body: { prefs: { email: { 'new-follower': false } } }
      },
      {
        name: 'Mute all emails',
        description: 'Flip the email master off without touching per-type switches.',
        method: 'POST',
        body: { prefs: { masters: { email: false } } }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'The full merged switch matrix.',
        body: {
          ok: true,
          prefs: {
            push: {
              'friend-request': true,
              'friend-accepted': true,
              'new-follower': true,
              'post-from-followed': true,
              'post-from-friend': true,
              comment: true,
              reply: true,
              reaction: true,
              share: true,
              groups: true
            },
            email: {
              'friend-request': true,
              'friend-accepted': true,
              'new-follower': false,
              'post-from-followed': false,
              'post-from-friend': false,
              comment: true,
              reply: true,
              reaction: true,
              share: true,
              groups: true,
              'weekly-summary': true
            },
            masters: { push: true, email: true }
          }
        }
      }
    ]
  }),
  endpoint({
    id: 'notifications-email-unsubscribe',
    group: 'notifications',
    title: 'Email one-click unsubscribe',
    endpoint: '/api/v1/notifications/email/unsubscribe',
    summary: 'The one-click link in notification email footers — flips the email master switch off.',
    detail:
      'GET with ?uid=<userId>&token=<hmac> (both come pre-built in every notification email footer; ' +
      'the token is an HMAC over the user id, so a link can only ever mute its own recipient). No ' +
      'session needed — email clients don’t carry cookies. Responds with a small HTML confirmation ' +
      'page, is idempotent, and the switch can be flipped back on any time in Settings → ' +
      'Notifications. Invalid or missing tokens get a 400 page; requests are IP rate-limited.',
    auth: {
      mode: 'none',
      description: 'Authenticated by the HMAC token in the link, not by session.'
    },
    methods: ['GET'],
    steps: [
      'Click the “Unsubscribe from all” link in any notification email.',
      'The email master switch flips off; per-type switches are untouched.',
      'Re-enable any time from Settings → Notifications.'
    ],
    requestExamples: [
      {
        name: 'One-click unsubscribe',
        description: 'As clicked from an email footer.',
        method: 'GET',
        query: { uid: '664f…', token: '3f2a…' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'HTML confirmation page (text/html, not JSON).',
        body: { note: 'Returns an HTML page: “You’re unsubscribed 💌”.' }
      }
    ]
  }),
  endpoint({
    id: 'notifications-email-weekly-summary',
    group: 'notifications',
    title: 'Weekly summary digest run',
    endpoint: '/api/v1/notifications/email/weekly-summary',
    summary: 'Kick off the weekly email digest — cron (CRON_SECRET bearer) or admin only.',
    detail:
      'Sends every opted-in, email-verified user a recap of the last seven days around their things ' +
      '(new followers, friend requests, comments, replies, reactions, shares, post views, posts). ' +
      'Users with zero activity are skipped, and a six-day per-recipient lookback makes the run ' +
      'idempotent — a retried cron or a manual admin run never double-sends. The Vercel cron ' +
      '(remix/vercel.json) calls GET with Authorization: Bearer <CRON_SECRET>; signed-in admins can ' +
      'also run it, and POST { dryRun: true } (or GET ?dryRun=1) previews counts without sending.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Admin session, or the CRON_SECRET bearer token Vercel cron attaches.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Configure CRON_SECRET in Vercel so the scheduled cron authenticates.',
      'GET ?dryRun=1 as an admin to preview who would get a digest.',
      'POST {} (admin) to run manually; the lookback prevents double-sends.',
      'Handle 401 unauthenticated / 403 non-admin.'
    ],
    requestExamples: [
      {
        name: 'Dry run',
        description: 'Preview counts without sending anything.',
        method: 'POST',
        body: { dryRun: true }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Run summary.',
        body: {
          ok: true,
          considered: 42,
          eligible: 17,
          sent: 9,
          skipped: { alreadySent: 5, noActivity: 3, failed: 0 },
          truncated: false,
          dryRun: false
        }
      }
    ]
  }),
  endpoint({
    id: 'things-views',
    group: 'things',
    title: 'Record post views',
    endpoint: '/api/v1/things/views',
    summary: 'Batched post view/impression telemetry — unique-viewer deduped, anti-bot filtered, beacon-safe.',
    detail:
      'The client reports posts that were ≥50% visible for ≥1s: { events: [{ id, dwellMs, ratio, pos }] } ' +
      '(dwellMs = on-screen time, ratio = max visible fraction, pos = viewport position 0..1). One doc ' +
      'per (post, viewer identity) keeps the public viewCount = UNIQUE viewers — replay only bumps ' +
      'impressions, which the rate limit bounds. Anonymous viewers dedup on a salted hash of IP+UA ' +
      '(no raw IP stored); UA-less requests are dropped. Owner self-views never count. Views are only ' +
      'accepted for posts the caller could read. Stats surface publicly on every post payload as ' +
      'viewCount + viewStats { impressions, avgDwellMs }.',
    auth: {
      mode: 'optional',
      description: 'Works logged out (anonymous identities dedup per salted IP+UA hash).'
    },
    methods: ['POST'],
    steps: [
      'Batch events client-side (the app flushes every ~10s and on page hide via sendBeacon).',
      'POST { events: [{ id, dwellMs?, ratio?, pos? }] } — up to 50 per call.',
      'The response { counted } is informational; failures are safe to ignore.',
      'Handle 429 rate-limited by dropping the batch (never retry-loop telemetry).'
    ],
    requestExamples: [
      {
        name: 'Flush view batch',
        description: 'Two posts seen this scroll session.',
        method: 'POST',
        body: {
          events: [
            { id: 'a1b2c3…', dwellMs: 4200, ratio: 1, pos: 0.31 },
            { id: 'd4e5f6…', dwellMs: 900, ratio: 0.8, pos: 0.66 }
          ]
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Batch accepted (counted = events that passed validation).',
        body: { ok: true, counted: 2 }
      }
    ]
  }),
  endpoint({
    id: 'vercel-deployments',
    group: 'vercel',
    title: 'Vercel deployments',
    endpoint: '/api/v1/vercel/deployments',
    summary: 'Returns deployment overview data for environment pickers and dashboards.',
    detail: 'This route is visible only when deployment status is enabled. It normalizes branch and per-branch history limits, returns one latest deployment per branch for compatibility plus bounded deploymentGroups history, and hides itself with 404 otherwise.',
    auth: {
      mode: 'none',
      description: 'Public status endpoint when enabled by server-side deployment configuration.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call with an optional limit, branchLimit, or branches query parameter.',
      'Set history, historyLimit, or deploymentsPerBranch to include up to 20 recent deployments in each deploymentGroups entry.',
      'Use deployments for a latest-per-branch selector or deploymentGroups for a nested branch and deployment-history selector.',
      'Handle 404 as intentionally hidden when deployment status is disabled.',
      'Avoid exposing Vercel API tokens; this route returns sanitized overview data only.'
    ],
    requestExamples: [
      {
        name: 'List deployments',
        description: 'Read up to five branch deployments.',
        method: 'GET',
        query: { history: 10, limit: 5 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deployment overview.',
        body: { ok: true, project: 'thingtime', deployments: [] }
      },
      {
        status: 404,
        description: 'Status is hidden in this runtime.',
        body: 'Not found'
      }
    ]
  }),
  endpoint({
    id: 'vercel-status',
    group: 'vercel',
    title: 'Vercel status',
    endpoint: '/api/v1/vercel/status',
    summary: 'Returns status for the current Vercel deployment.',
    detail: 'Use this route for footer/status UI when the deployment status feature is enabled.',
    auth: {
      mode: 'none',
      description: 'Public status endpoint when enabled by server-side deployment configuration.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'Call GET for normal status checks or POST for API tester parity.',
      'Read configured, state, label, and error fields.',
      'Handle 404 as intentionally hidden when status is disabled.',
      'Use /api/v1/vercel/status-data when a resource-only GET endpoint is required.'
    ],
    requestExamples: [
      {
        name: 'Read Vercel status',
        description: 'Check deployment status.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deployment status.',
        body: { configured: true, state: 'READY', label: 'Vercel: ready' }
      }
    ]
  }),
  endpoint({
    id: 'vercel-status-data',
    group: 'vercel',
    title: 'Vercel status data',
    endpoint: '/api/v1/vercel/status-data',
    summary: 'Resource-only GET version of Vercel deployment status.',
    detail: 'Use this endpoint when fetch callers need JSON and should not hit route components or tester parity actions.',
    auth: {
      mode: 'none',
      description: 'Public status endpoint when enabled by server-side deployment configuration.'
    },
    methods: ['GET'],
    steps: [
      'Call GET from status widgets or remote health checks.',
      'Read the same deployment status shape as /api/v1/vercel/status.',
      'Handle 404 as intentionally hidden when status is disabled.',
      'Do not expect dashboard secrets or raw Vercel API responses.'
    ],
    requestExamples: [
      {
        name: 'Read Vercel JSON status',
        description: 'Fetch deployment status data only.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deployment status.',
        body: { configured: true, state: 'READY', label: 'Vercel: ready' }
      }
    ]
  }),
  endpoint({
    id: 'vercel-webhook',
    group: 'vercel',
    title: 'Vercel webhook',
    endpoint: '/api/v1/vercel/webhook',
    summary: 'Receiver for Vercel deployment lifecycle events (created/succeeded/error/canceled).',
    detail:
      'Vercel pushes signed deployment events here; the latest status per git branch is persisted server-side so /api/v1/vercel/status can serve ready/error/canceled states without spending Vercel API calls. Configure the webhook in the Vercel dashboard pointing at this endpoint and set VERCEL_WEBHOOK_SECRET to the webhook secret.',
    auth: {
      mode: 'none',
      description: 'HMAC-authenticated: the raw body must be signed with the webhook secret in x-vercel-signature (sha1 hex). 404 when VERCEL_WEBHOOK_SECRET is unset; 401 on bad signatures.'
    },
    methods: ['POST'],
    steps: [
      'Create a Vercel webhook for deployment.created, deployment.succeeded, deployment.promoted, deployment.error, and deployment.canceled pointing at this endpoint.',
      'Set VERCEL_WEBHOOK_SECRET in the deployment environment to the webhook secret Vercel shows on creation.',
      'Vercel signs each delivery; unsigned or tampered requests are rejected with 401.',
      'Untracked event types are acknowledged with tracked: false so Vercel does not retry.'
    ],
    requestExamples: [
      {
        name: 'Deployment succeeded event',
        description: 'Example Vercel envelope (sent by Vercel, signed with the webhook secret).',
        method: 'POST',
        body: {
          type: 'deployment.succeeded',
          createdAt: 1752986400000,
          payload: {
            target: 'production',
            deployment: {
              id: 'dpl_123',
              url: 'thingtime-abc123.vercel.app',
              meta: { githubCommitRef: 'main', githubCommitSha: 'abc1234' }
            },
            links: { deployment: 'https://vercel.com/lopu/thingtime/dpl_123' }
          }
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Event recorded.',
        body: { ok: true, tracked: true, state: 'ready', branch: 'main' }
      },
      {
        status: 401,
        description: 'Missing or invalid x-vercel-signature.',
        body: { ok: false, error: 'Invalid signature' }
      }
    ]
  }),
  endpoint({
    id: 'waitlist',
    group: 'waitlist',
    title: 'Waitlist',
    endpoint: '/api/v1/waitlist',
    summary: 'Adds an email address to the launch waitlist.',
    detail:
      'Use this endpoint from the landing page or external launch signup surfaces. The route validates email and is idempotent/rate-limit aware.',
    auth: {
      mode: 'none',
      description: 'Public signup endpoint.'
    },
    methods: ['POST'],
    steps: [
      'POST a valid email address.',
      'Show success when ok is true.',
      'Handle 400 for invalid email and 413 for bodies over 2 KiB.',
      'Handle 429 as a temporary rate-limit response.'
    ],
    requestExamples: [
      {
        name: 'Join waitlist',
        description: 'Add an email to the launch waitlist.',
        method: 'POST',
        body: { email: 'hello@example.com' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Email accepted — includes a welcome fortune from Lopu (deterministic, time-rotated).',
        body: { ok: true, fortune: 'Tiny things become big things. Keep tending the little ones. ✨' }
      },
      {
        status: 400,
        description: 'Email validation failed.',
        body: { ok: false, error: 'A valid email is required' }
      }
    ]
  }),
  endpoint({
    id: 'schemas',
    group: 'schemas',
    title: 'Thingtime Schemas',
    endpoint: '/api/v1/schemas',
    summary: 'Returns every Thingtime Schema — the root thing schema, crystal sub-schemas, and collection schemas.',
    detail:
      'The registry the API validates against, as data: field lists, versions, examples, and the schema version each collection currently writes. Browse the same registry visually at /docs/schemas; published community schemas live at /schemas.',
    auth: {
      mode: 'none',
      description: 'Public — schemas describe shapes, never data.'
    },
    methods: ['GET'],
    steps: [
      'GET with no parameters for every schema plus collectionVersions.',
      'GET ?id=post (or comment, reaction, share, thing, ...) for one schema.',
      'Crystal schemas are the ids a thing may carry in its thingtime array.',
      'Handle 404 for unknown schema ids.'
    ],
    requestExamples: [
      {
        name: 'List schemas',
        description: 'Read the full schema registry.',
        method: 'GET'
      },
      {
        name: 'Read one schema',
        description: 'Read the post crystal schema.',
        method: 'GET',
        query: { id: 'post' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Registry returned.',
        body: { ok: true, schemas: [{ id: 'thing', kind: 'root', version: 2 }], collectionVersions: { things: 2 } }
      }
    ]
  }),
  endpoint({
    id: 'network-probe-ping',
    group: 'system',
    title: 'Network probe ping',
    endpoint: '/api/v1/network-probe/ping',
    summary: 'A tiny uncached response for measuring round-trip latency to Thingtime.',
    detail:
      'Commander Activity uses this public endpoint while its Activity view is open. It returns a fixed 256-byte payload, never stores request data, and is rate limited per client IP.',
    auth: { mode: 'none', description: 'Public diagnostic endpoint.' },
    methods: ['GET'],
    steps: ['Time the complete request and response.', 'Treat 429 as a temporary network-probe cooldown.'],
    requestExamples: [{ name: 'Measure latency', description: 'Fetch the fixed ping payload.', method: 'GET' }],
    responseExamples: [{ status: 200, description: 'A 256-byte binary response.', headers: { 'Content-Type': 'application/octet-stream' } }]
  }),
  endpoint({
    id: 'network-probe-download',
    group: 'system',
    title: 'Network probe download',
    endpoint: '/api/v1/network-probe/download',
    summary: 'Returns one fixed, non-cacheable packet for an opt-in throughput measurement.',
    detail:
      'Only 56 KiB, 500 KiB, 2 MiB, 5 MiB, and 10 MiB packets are accepted. The exact allowlist and per-IP rate limit prevent this endpoint from becoming a general transfer service.',
    auth: { mode: 'none', description: 'Public bounded diagnostic endpoint.' },
    methods: ['GET'],
    steps: ['Pass one documented bytes value.', 'Measure the response body only after a successful 200.', 'Respect 429 before retrying.'],
    requestExamples: [
      { name: 'Download a 2 MiB packet', description: 'One member of the fixed speed-test ladder.', method: 'GET', query: { bytes: 2097152 } }
    ],
    responseExamples: [
      { status: 200, description: 'The requested fixed-size binary packet.', headers: { 'Content-Type': 'application/octet-stream' } }
    ]
  }),
  endpoint({
    id: 'network-probe-upload',
    group: 'system',
    title: 'Network probe upload',
    endpoint: '/api/v1/network-probe/upload',
    summary: 'Consumes one exact fixed-size packet for an opt-in upload measurement.',
    detail:
      'The binary body and Content-Length must exactly match one documented packet size. Nothing is persisted or reflected, and the endpoint is rate limited per client IP.',
    auth: { mode: 'none', description: 'Public bounded diagnostic endpoint.' },
    methods: ['POST'],
    steps: [
      'Pass one documented bytes value.',
      'Send binary data with exactly that Content-Length.',
      'Use the small JSON acknowledgement only after a 200.'
    ],
    requestExamples: [
      {
        name: 'Upload a 500 KiB packet',
        description: 'One member of the fixed speed-test ladder; set Content-Length to 512000.',
        method: 'POST',
        query: { bytes: 512000 }
      }
    ],
    responseExamples: [{ status: 200, description: 'Exact body accepted.', body: { ok: true, bytes: 512000 } }]
  }),
  endpoint({
    id: 'schemas-browse',
    group: 'schemas',
    title: 'Browse published schemas',
    endpoint: '/api/v1/schemas/browse',
    summary: 'Paginated browsing of user-published schema things — newest, oldest, popular, or text-searched.',
    detail:
      'The UGC side of /schemas: schema things (thingtime ["schema"]) with cursor pagination. ' +
      'sort=popular ranks by reaction count over a bounded window; q rides the same hardened ' +
      'text search as /api/v1/things/search; library=1 returns only the caller saved schemas ' +
      '(save recency order); mine=1 returns only the caller own schemas. Every entry carries ' +
      'reactionCounts, viewerReactions, saved, and usageCount (public data things whose crystal ' +
      'schema field names it). Built-in registry schemas are not included — clients merge them ' +
      'from GET /api/v1/schemas.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers see public schemas; library=1 and mine=1 require auth.'
    },
    methods: ['GET'],
    steps: [
      'GET with sort=newest|oldest|popular, optional q, limit (max 50).',
      'Page with the returned nextCursor until it is null (cursors are opaque).',
      'Pass library=1 for the caller saved schemas, mine=1 for their own.',
      'Handle 401 for library/mine without auth and 429 when rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Popular schemas',
        description: 'First page of the most-reacted schemas.',
        method: 'GET',
        query: { sort: 'popular', limit: 20 }
      },
      {
        name: 'Search schemas',
        description: 'Relevance-ranked text search.',
        method: 'GET',
        query: { q: 'table', limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Schema page returned.',
        body: {
          ok: true,
          schemas: [
            {
              id: 'schema_table_001',
              thingtime: ['schema'],
              crystal: { name: 'Table', description: 'Tables of all kinds.', fields: [{ name: 'legs', type: 'number', min: 0, max: 12 }] },
              reactionCounts: { '🔥': 3 },
              viewerReactions: [],
              saved: false,
              usageCount: 12
            }
          ],
          nextCursor: null,
          total: 1,
          totalCapped: false
        }
      }
    ]
  }),
  endpoint({
    id: 'actions-run',
    group: 'actions',
    title: 'Run an action',
    endpoint: '/api/v1/actions/run',
    summary: 'Execute one action thing inside its declared capability + budget envelope.',
    detail:
      'The Action Thing executor: action things (thingtime ["action"]) are small declarative programs over a ' +
      'closed operation vocabulary (things.create/get/search/update, actions.invoke, return) with typed inputs, ' +
      'author-declared capabilities, and a limits envelope. Capabilities only NARROW — every operation delegates ' +
      'to the ordinary things API as the signed-in caller, so ACL, quotas and schema validation always apply and ' +
      'an action can never do something its invoker couldn’t do by hand. One budget (deadline, operation count, ' +
      'depth, child actions, result bytes) is shared across the whole invocation including child actions.invoke ' +
      'calls, so recursive chains terminate by construction. Every run lands a protected action-run thing ' +
      '(targetId = the action) with a per-step trace; the response carries the same runId, status, result, ' +
      'budget usage and trace.',
    auth: {
      mode: 'session',
      description: 'Session cookie required. PATs and app tokens are default-denied in v1.'
    },
    methods: ['POST'],
    steps: [
      'POST { action: "<shareId or your actionKey>", inputs: { ... } }.',
      'Add source: "component" when the run is DELEGATED — fired by a control inside rendered component markup rather than chosen from the ' +
        'inspector. That narrows resolution to actions you own, so a template someone else authored cannot lend your authority to their ' +
        'program by naming its id. Omit it for a deliberate run, which may also resolve any action you can read.',
      'Inputs are validated against the action’s typed descriptors (400 on mismatch).',
      'The executor runs the steps inside the budget; refs like "$input.name" and "$step.1.id" substitute whole values.',
      'Read status ("ok" | "error"), result, trace, and budget usage from the response.',
      'Fetch history later via GET /api/v1/actions/runs?action=<id>.'
    ],
    requestExamples: [
      {
        name: 'Run create-customer',
        description: 'Execute an action by its key with typed inputs.',
        method: 'POST',
        body: { action: 'create-customer', inputs: { name: 'Ada Lovelace', email: 'ada@example.com' } }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Run completed (status may still be "error" if a step failed — the envelope is ok).',
        body: {
          ok: true,
          runId: 'action-run-4f6a…',
          status: 'ok',
          actionId: 'abc123',
          result: { id: 'thing456', schema: 'customer' },
          durationMs: 482,
          opsUsed: 2,
          depthUsed: 0,
          childActionsUsed: 0,
          trace: [{ step: '1', op: 'things.create', ms: 41, target: 'thing456' }]
        }
      }
    ]
  }),
  endpoint({
    id: 'actions-runs',
    group: 'actions',
    title: 'List action runs',
    endpoint: '/api/v1/actions/runs',
    summary: 'Your own action-run records, newest first — the inspectable audit trail.',
    detail:
      'action-run things are PROTECTED (executor-minted only, invisible to the generic thing reads), so run ' +
      'history has this dedicated read model: the signed-in caller’s own runs, optionally filtered to one action ' +
      'via action=<shareId>, newest first, limit ≤ 50. Each run carries status, startedAt, durationMs, budget ' +
      'usage, a size-capped echo of the inputs and result, and the per-step trace the /actions inspector renders. ' +
      'The trail is retained, not permanent: the executor keeps the newest 50 records per action per owner and ' +
      'prunes older ones after each run, and deleting the action deletes its run records with it — so treat run ' +
      'history as a rolling window rather than a permanent log.',
    auth: {
      mode: 'session',
      description: 'Session cookie required; you only ever see your own runs.'
    },
    methods: ['GET'],
    steps: [
      'GET with optional action=<shareId> and limit (max 50).',
      'Runs are newest-first; each entry links its actionId (targetId).',
      'Handle 401 when signed out and 429 when rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Latest runs of one action',
        description: 'The last 20 runs of a specific action.',
        method: 'GET',
        query: { action: 'abc123', limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Run history returned.',
        body: {
          ok: true,
          runs: [
            {
              id: 'action-run-4f6a…',
              actionId: 'abc123',
              status: 'ok',
              startedAt: '2026-08-24T10:00:00.000Z',
              durationMs: 482,
              opsUsed: 2,
              error: null,
              trace: [{ step: '1', op: 'things.create', ms: 41, target: 'thing456' }],
              result: { id: 'thing456' },
              inputs: { name: 'Ada Lovelace' },
              createdAt: '2026-08-24T10:00:01.000Z'
            }
          ]
        }
      }
    ]
  }),
  endpoint({
    id: 'components-browse',
    group: 'components',
    title: 'Browse UI components',
    endpoint: '/api/v1/components/browse',
    summary: 'Paginated browsing of component things — the UI library behind /components.',
    detail:
      'The read model behind /components: component things (thingtime ["component"]) with cursor pagination. ' +
      'The platform library (1000+ system-seeded components styled after Ant Design, Bootstrap, MUI, shadcn/ui, ' +
      'Untitled UI, daisyUI, React Flow, and the Thingtime house style) and user-published components ride one ' +
      'query. sort=popular ranks by reaction count over a bounded window; q rides the same hardened text search ' +
      'as /api/v1/things/search; lib= and category= filter the catalog on no-q pages; library=1 returns only the ' +
      'caller’s saved components (save recency order); mine=1 returns only the caller’s own. Every entry carries ' +
      'reactionCounts, viewerReactions, saved, and usageCount (visible saved versions sharing its componentKey). ' +
      'Each crystal holds the arg descriptors and the render template the /components tester resolves live.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers see public components; library=1 and mine=1 require auth.'
    },
    methods: ['GET'],
    steps: [
      'GET with sort=newest|oldest|popular, optional q, limit (max 50).',
      'Filter the catalog with lib=antd|bootstrap|mui|shadcn|untitled|daisyui|reactflow|thingtime and/or category=.',
      'Page with the returned nextCursor until it is null (cursors are opaque).',
      'Pass library=1 for the caller’s saved components, mine=1 for their own.',
      'Handle 401 for library/mine without auth and 429 when rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Newest MUI components',
        description: 'First page of the Material-styled catalog.',
        method: 'GET',
        query: { lib: 'mui', limit: 20 }
      },
      {
        name: 'Search components',
        description: 'Relevance-ranked text search.',
        method: 'GET',
        query: { q: 'button', limit: 20 }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Component page returned.',
        body: {
          ok: true,
          components: [
            {
              id: 'component-mui-button-solid',
              thingtime: ['component'],
              crystal: {
                name: 'Solid Button',
                library: 'mui',
                category: 'buttons',
                componentKey: 'mui-button-solid',
                args: [{ name: 'label', type: 'string', default: 'Get started' }],
                render: { tag: 'button', props: {}, children: ['{label}'] }
              },
              reactionCounts: { '🔥': 3 },
              viewerReactions: [],
              saved: false,
              usageCount: 2
            }
          ],
          nextCursor: null,
          total: 1,
          totalCapped: false
        }
      }
    ]
  }),
  endpoint({
    id: 'webpages-resolve',
    group: 'webpages',
    title: 'Resolve a webpage',
    endpoint: '/api/v1/webpages/resolve',
    summary: 'Resolve one block-based webpage plus every component thing its blocks reference — the read model behind /p/ pages, the builder, and site pages.',
    detail:
      'Webpage things (thingtime ["webpage"]) hold a bounded ordered block tree: component blocks reference ' +
      'component things by componentKey or shareId, container blocks lay children out, text blocks carry short ' +
      'copy, and native blocks mark where a built-in Thingtime screen sits on a site page. This endpoint resolves ' +
      'ONE page — by id (a standalone /p/ page), by path (the site page bound to an app route, where a ' +
      'viewer-owned personalised doc outranks the seeded system default), or global=1 (the site-global block ' +
      'doc) — together with every referenced component in one batched query. Component refs resolve exact ' +
      'visible shareIds first, then the seeded platform doc (component-<ref>), then the caller’s own latest ' +
      'componentKey match; the refs map records each resolution. Pages are created and edited through the ' +
      'ordinary /api/v1/things write path (the webpage crystal sanitizer is the write gate) — this endpoint ' +
      'only reads.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers resolve public pages and the seeded site defaults; signed-in callers also get their own pages and personalised site docs.'
    },
    methods: ['GET'],
    steps: [
      'GET with exactly one of id=<shareId>, path=</route>, or global=1.',
      'Read page (null when no doc matches a path/global lookup) and source ("user" | "system").',
      'Render blocks by looking each component block’s ref up in the refs map, then in components[].',
      'Treat a null refs entry as an unresolvable component (render a placeholder).',
      'Handle 400 for a malformed query, 404 for an id that doesn’t resolve, and 429 when rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Resolve a standalone page',
        description: 'The read behind /p/<id>.',
        method: 'GET',
        query: { id: 'my-launch-page' }
      },
      {
        name: 'Resolve a site page',
        description: 'The block doc bound to an app route (viewer-personalised when a fork exists).',
        method: 'GET',
        query: { path: '/status' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Page and referenced components returned.',
        body: {
          ok: true,
          page: {
            id: 'webpage-route-status',
            thingtime: ['webpage'],
            crystal: {
              name: 'Status',
              pageKey: 'route-status',
              siteRoute: '/status',
              blocks: [{ id: 'native-status', type: 'native', native: 'status' }]
            }
          },
          source: 'system',
          components: [],
          refs: {}
        }
      }
    ]
  }),
  endpoint({
    id: 'webpages-demos',
    contractVersion: '1.1.0',
    group: 'webpages',
    title: 'Browse the builder demo library',
    endpoint: '/api/v1/webpages/demos',
    summary: 'Lists the deterministic catalog of builder demos (sections, full pages, component-block pages) and behaviour suites (schemas + components + actions + data + page), with a seeded flag per entry.',
    detail:
      'The demo library is code: schemas/webpageDemos generates a few hundred example webpages from family × ' +
      'layout × tone tables, each of which clears the webpage write gate unchanged. This endpoint lists that ' +
      'catalog — id (the seeded shareId webpage-demo-<slug>), slug, name, family, kind, tone, layout, tags, ' +
      'description, blockCount — plus families with counts and, per demo, whether its system doc is seeded on ' +
      'this deployment (then /p/<id> and /builder?page=<id> open it directly; the builder forks a viewer’s edits ' +
      'into their own twin). Pass slug=<slug> to also get that one demo’s full crystal (blocks included) — the ' +
      'payload a client posts to /api/v1/things to make its own copy, seeded or not. Every response also lists ' +
      'suites[] — the behaviour suites (schemas/behaviourSuites): bundles of schema things, ttAction-bound ' +
      'component things, action things (the closed-vocabulary programs), sample data things, and a page, each ' +
      'with counts, the system copy’s pageId/actionIds/schemaIds, and a seeded flag. Pass suite=<key> for ' +
      'suite.bundle — the OWN-mode materialisation (schemas referenced by name, child actions by actionKey) a ' +
      'client posts part by part to /api/v1/things (schemas, then components, actions, data stamped with the ' +
      'created schema ids, then the page) so the page’s controls run the caller’s own programs end to end. ' +
      'Every response also carries components[] + refs — the platform library component things the ' +
      'component-kind demos reference, resolved exactly as /api/v1/webpages/resolve resolves a page’s blocks, ' +
      'so a client can draw those demos without a second round trip; a null ref means that componentKey is not ' +
      'seeded here and the block draws nothing. Read-only and public; two bounded queries, no per-viewer state.',
    auth: {
      mode: 'optional',
      description: 'Anonymous callers see the same catalog and seeded flags — nothing here is per-viewer.'
    },
    methods: ['GET'],
    steps: [
      'GET with no query for the whole catalog, or family=<key> / kind=section|page|component to filter.',
      'Read families[] (key, title, emoji, kind, description, count), total, seededCount, and suites[].',
      'Draw kind=component demos by folding components[] + refs into a ref → component map (buildComponentsByRef).',
      'Pass slug=<slug> to receive demo.crystal — POST it to /api/v1/things with thingtime ["webpage"] to copy it.',
      'Pass suite=<key> to receive suite.bundle and install it: POST each schema, component, action, data (add schemaId), then the page.',
      'Treat seeded: true as “/p/<id> and the builder open this demo directly” (suites: /actions/<actionId> runs the seeded program).',
      'Handle 400 for an unknown family/kind/slug/suite shape, 404 for an unknown slug or suite, and 429 when rate-limited.'
    ],
    requestExamples: [
      {
        name: 'Browse one family',
        description: 'Every hero demo.',
        method: 'GET',
        query: { family: 'hero' }
      },
      {
        name: 'Fetch one demo with blocks',
        description: 'The crystal to clone.',
        method: 'GET',
        query: { slug: 'hero-centered-paper' }
      },
      {
        name: 'Fetch a behaviour suite bundle',
        description: 'Everything needed to install the guestbook suite into your own things.',
        method: 'GET',
        query: { suite: 'guestbook' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Catalog slice returned.',
        body: {
          ok: true,
          total: 322,
          seededCount: 322,
          families: [{ key: 'hero', title: 'Hero', emoji: '🌅', kind: 'section', description: 'Opening statements — centered, split, with stats, and minimal.', count: 24 }],
          demos: [
            {
              id: 'webpage-demo-hero-centered-paper',
              slug: 'hero-centered-paper',
              name: 'Hero · Centered · Paper',
              family: 'hero',
              kind: 'section',
              tone: 'paper',
              layout: 'centered',
              tags: ['webpage', 'demo', 'hero', 'section', 'paper', 'centered'],
              description: 'Opening statements — centered, split, with stats, and minimal. Centered layout in the paper tone, copy from Thingtime.',
              previewBg: '#fafafb',
              blockCount: 7,
              seeded: true
            }
          ],
          suites: [
            {
              key: 'guestbook',
              title: 'Guestbook',
              emoji: '📖',
              description: 'Sign a guestbook, then read the signatures back.',
              story: ['The simplest program: one schema, one create action, one search action.'],
              tone: 'paper',
              counts: { schemas: 1, components: 2, actions: 2, data: 3 },
              pageId: 'webpage-demo-suite-guestbook',
              actionIds: ['action-demo-guestbook-sign', 'action-demo-guestbook-recent'],
              schemaIds: ['schema-demo-guestbook-entry'],
              seeded: true
            }
          ],
          refs: { 'thingtime-button-solid': 'component-thingtime-button-solid', 'thingtime-card-basic': 'component-thingtime-card-basic' },
          components: [{ id: 'component-thingtime-button-solid', thingtime: ['component'], visibility: 'public', crystal: { name: 'Solid Button', componentKey: 'thingtime-button-solid', args: [], render: {} } }]
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-components-seed',
    group: 'admin',
    title: 'Seed component library',
    endpoint: '/api/v1/admin/components/seed',
    summary: 'Upserts a batch of components-db definitions as system-owned public component things.',
    detail:
      'The write path that mirrors the repo’s components-db folder database into things: each definition ' +
      'becomes (or refreshes) a system-owned public component thing with deterministic shareId component-<slug> ' +
      '(the prefix is reserved against squatters), storageClass "control", acl ["tt:all"], and a hashed ' +
      'component:<slug> uniqueKey. Crystals pass validateThingtimeCrystal(["component"]) — the exact write gate ' +
      'user components clear — so seeded and user-authored components share one grammar. Idempotent and ' +
      'self-healing: re-runs leave matching docs unchanged, refresh drifted crystals/tags in place, and skip ' +
      '(never touch) foreign docs squatting a destination id. GET returns the seed census without writing.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'POST { components: [definition, …] } with at most 100 definitions per call.',
      'Each definition needs slug, name, library, category, args, and a render template.',
      'Read created/refreshed/unchanged/skipped and notes for per-slug outcomes.',
      'GET the same path for { totalSeeded } to check progress without writing.',
      'Handle 401/403 for non-admins and 429 when the fail-closed rate limit trips.'
    ],
    requestExamples: [
      {
        name: 'Seed a batch',
        description: 'Upsert two library components.',
        method: 'POST',
        body: {
          components: [
            {
              slug: 'thingtime-button-solid',
              name: 'Solid Button',
              library: 'thingtime',
              category: 'buttons',
              description: 'Filled primary action button in the Thingtime house style.',
              args: [{ name: 'label', type: 'string', default: 'Get started' }],
              render: { tag: 'button', props: {}, children: ['{label}'] }
            }
          ]
        }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Seed report returned.',
        body: { ok: true, received: 1, created: 1, refreshed: 0, unchanged: 0, skipped: 0, notes: [], totalSeeded: 1 }
      }
    ]
  }),
  endpoint({
    id: 'admin-webpages-seed-demos',
    group: 'admin',
    title: 'Seed the builder demo library',
    endpoint: '/api/v1/admin/webpages/seed-demos',
    summary: 'Upserts every builder demo page and every behaviour-suite part (schemas, components, actions, data, pages) as system-owned public things.',
    detail:
      'The write path for the builder demo library: the deterministic schemas/webpageDemos catalog seeds one ' +
      'system-owned webpage thing per demo (shareId webpage-demo-<slug>, reserved prefix, pageKey demo-<slug>, ' +
      'tags webpage/demo/<family>/<kind>), and the schemas/behaviourSuites catalog seeds every suite part — ' +
      'schema-demo-<suite>-<key>, component-demo-<suite>-<key> (ttAction-bound controls), ' +
      'action-demo-<suite>-<key> (programs whose schema refs are the seeded schema ids and whose child refs are ' +
      'the seeded action ids), data-demo-<suite>-<n> (stamped schema/schemaId like executor-minted things), and ' +
      'webpage-demo-suite-<suite>. All carry storageClass "control", acl ["tt:all"], and per-kind hashed ' +
      'uniqueKeys — the same envelope and reconciling upsert as the site-page seed. Every crystal passes its ' +
      'kind’s validateThingtimeCrystal gate, the exact gate user things clear. Idempotent and self-healing: ' +
      're-runs leave matching docs unchanged, refresh drifted crystals/tags in place, and skip (never touch) ' +
      'foreign docs squatting a destination id. Once seeded, every demo opens at /p/ and in the builder (edits ' +
      'fork), suite parts are browsable on /schemas, /components and /actions, and a signed-in viewer can run a ' +
      'seeded action from its /actions page (it mints THEIR data things). The report sums both passes and ' +
      'carries the suite pass as `suites`. GET returns the seed census (site + demo + suite counts) without writing.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'POST with an empty body — the demo catalog is server-side and deterministic.',
      'Read created/refreshed/unchanged/skipped and notes for per-slug outcomes.',
      'GET the same path for { totalSeeded, siteSeeded, demosSeeded, demosTotal, suitesSeeded, suitesTotal } to check the census without writing — the three seeded counts are disjoint, so a suite page counts once, under suitesSeeded.',
      'Re-run after the catalogs change — converges, never duplicates.',
      'Handle 401/403 for non-admins and 429 when the fail-closed rate limit trips.'
    ],
    requestExamples: [
      {
        name: 'Seed the demo library',
        description: 'Upsert every catalog demo.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Seed report returned.',
        body: {
          ok: true,
          received: 447,
          created: 447,
          refreshed: 0,
          unchanged: 0,
          skipped: 0,
          notes: [],
          totalSeeded: 364,
          suites: { ok: true, received: 125, created: 125, refreshed: 0, unchanged: 0, skipped: 0, notes: [], totalSeeded: 364 }
        }
      }
    ]
  }),
  endpoint({
    id: 'admin-webpages-seed',
    contractVersion: '1.1.0',
    group: 'admin',
    title: 'Seed site webpages',
    endpoint: '/api/v1/admin/webpages/seed',
    summary: 'Upserts the built-in site-page docs (one webpage thing per app route, native-block bodies) plus the site-global doc.',
    detail:
      'The write path that makes every built-in Thingtime route a block-based site: a deterministic server-side ' +
      'table seeds one system-owned webpage thing per app route (shareId webpage-route-<key>, the prefix is ' +
      'reserved against squatters) whose block list is the locked native block for that screen, plus the empty ' +
      'site-global doc (webpage-site-global). storageClass "control", acl ["tt:all"], hashed webpage:<slug> ' +
      'uniqueKeys. Crystals pass validateThingtimeCrystal(["webpage"]) — the exact write gate user pages clear. ' +
      'Idempotent and self-healing: re-runs leave matching docs unchanged, refresh drifted crystals/tags in ' +
      'place, and skip (never touch) foreign docs squatting a destination id. Viewers personalise site pages by ' +
      'saving their own webpage twin (same pageKey/siteRoute) through the builder — the seeds themselves never ' +
      'change per user. GET returns the seed census without writing.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['GET', 'POST'],
    steps: [
      'POST with an empty body — the seed table is server-side and deterministic.',
      'Read created/refreshed/unchanged/skipped and notes for per-slug outcomes.',
      'GET the same path for { totalSeeded, siteSeeded, demosSeeded, demosTotal, suitesSeeded, suitesTotal } — totalSeeded counts every system webpage (site pages, the global doc, and demo-library pages), and the three seeded counts partition it.',
      'Re-run after adding routes to the seed table — converges, never duplicates.',
      'Handle 401/403 for non-admins and 429 when the fail-closed rate limit trips.'
    ],
    requestExamples: [
      {
        name: 'Seed the site pages',
        description: 'Upsert every built-in route doc + the global doc.',
        method: 'POST',
        body: {}
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Seed report returned.',
        body: { ok: true, received: 28, created: 28, refreshed: 0, unchanged: 0, skipped: 0, notes: [], totalSeeded: 28 }
      }
    ]
  }),
  endpoint({
    id: 'admin-migrations',
    group: 'admin',
    title: 'Migration status',
    endpoint: '/api/v1/admin/migrations',
    summary: 'Per-collection schema-version census, storage generations, and registered migrations with pending counts.',
    detail:
      'Every doc stores the root-level schemaVersion it was written at (docs without one count as version 1), and every ' +
      'collection lives in a versioned physical collection — logical `things` at version 2 is the physical collection ' +
      '`things_v2`. This endpoint reports how many docs sit at each version per collection, every physical collection ' +
      'generation on the server (current, stale, or ahead), any legacy collections adoption could not rename, and which ' +
      'registered migrations still have work to do.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['GET'],
    steps: [
      'GET as an allowlisted admin.',
      'Read collections for the per-version doc census.',
      'Read generations for every physical collection and its stale/current status.',
      'Read migrations for pending counts per registered migration.',
      'Handle 401 for anonymous or non-admin callers.'
    ],
    requestExamples: [
      {
        name: 'Read migration status',
        description: 'Census of schema versions across collections.',
        method: 'GET'
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Status returned.',
        body: {
          ok: true,
          collections: [
            {
              collection: 'things',
              physical: 'things_v2',
              currentVersion: 2,
              total: 42,
              versions: { '1': 24, '2': 18 },
              pendingMigrations: ['things-v1-to-v2']
            }
          ],
          generations: [
            { collection: 'things', physical: 'things_v2', version: 2, docs: 42, current: true, stale: false },
            { collection: 'things', physical: 'things', version: null, docs: 42, current: false, stale: true }
          ],
          adoptionIssues: [],
          migrations: [{ id: 'things-v1-to-v2', collection: 'things', fromVersion: 1, toVersion: 2, destructive: false, pending: 24 }]
        }
      },
      {
        status: 401,
        description: 'Anonymous or non-admin caller.',
        body: { ok: false, error: 'Unauthorized' }
      }
    ]
  }),
	endpoint({
		id: 'admin-migrations-diagnostic',
		group: 'admin',
		title: 'Read migration diagnostic',
		endpoint: '/api/v1/admin/migrations/diagnostic',
		summary: 'Reads one short-lived, private error report created after a failed real migration run.',
		detail:
			'A failed real migration may create a protected, non-billable migration-diagnostic Thing after its lease is released. ' +
			'Pass its id to read a bounded snapshot of the error name, message, stack, standard codes, labels, and cause chain. Secret, ' +
			'credential, connection-string, and private-key patterns are irreversibly redacted. New v2 reports may also advertise value-free reveal descriptors for MongoDB ObjectIds supplied through an explicitly authored server-side error context; arbitrary error prose cannot grant reveal access. The raw values remain inside the protected envelope until the owning admin confirms their current password through /api/v1/things/reveal. Reads are pinned to Thingtime’s home database and require the same current ' +
			'admin account that ran the migration. Dry runs never create diagnostics; failed diagnostic persistence falls back to detail ' +
			'in the private migration response instead.',
		auth: {
			mode: 'session-or-bearer',
			description: 'Requires a current admin session and exact ownership of the diagnostic. Missing or inaccessible ids return 404.'
		},
		methods: ['GET'],
		steps: [
			'Copy diagnosticThingId from a failed real migration response.',
			'GET with id=<diagnosticThingId> as the same current admin.',
			'Render detail as plain text only; the server captures a closed field set and redacts sensitive text patterns.',
			'If revealables is non-empty, correlate its placeholders with detail and use the password-confirmed reveal endpoint one reference at a time.',
			'Treat 404 as expired, removed, or inaccessible without distinguishing those cases.'
		],
		requestExamples: [
			{
				name: 'Read error report',
				description: 'Open the durable report linked by the migration toast.',
				method: 'GET',
				query: { id: 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90' }
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Private diagnostic returned.',
				body: {
					ok: true,
					diagnostic: {
						id: 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90',
						migrationId: 'backfill-user-storage-accounting',
						status: 500,
						outcome: 'unknown',
						summary: 'Migration stopped before completion.',
						capturedAt: '2026-08-08T00:00:00.000Z',
						expiresAt: '2026-09-07T00:00:00.000Z',
						detail: '{\n  "name": "MongoServerError"\n}',
						redactions: 1,
						truncated: false,
						revealables: [
							{
								reference: 'mongodb-object-id-1',
								kind: 'mongodb-object-id',
								label: 'MongoDB ObjectId #1',
								placeholder: '[redacted MongoDB ObjectId #1]'
							}
						]
					}
				}
			},
			{ status: 404, description: 'Expired, missing, or inaccessible.', body: { ok: false, error: 'Diagnostic not found' } }
		]
	}),
	endpoint({
		id: 'things-sensitive-reveal',
		group: 'things',
		title: 'Reveal one protected Thing value',
		endpoint: '/api/v1/things/reveal',
		summary: 'Password-confirms the current user, then reveals one allowlisted value from a protected Thing.',
		detail:
			'This is a closed-codec reveal boundary, not a generic secure-field reader. The caller supplies only a Thing id, an opaque reference advertised by that Thing’s dedicated reader, and the current account password. ' +
			'Thingtime repeats live-session and password verification on every request, applies a non-configurable fail-closed attempt limit, and returns one value with private no-store headers. The first provider supports current-owner admin migration diagnostics and MongoDB ObjectIds only. ' +
			'Passwords, authorization values, tokens, credentials, connection strings, arbitrary secure Binary fields, and ambiguous 24-hex strings are never retained for reveal. The fixed five-request window counts every confirmation request, including successful reveals.',
		auth: {
			mode: 'session-or-bearer',
			description:
				'Requires a full live account session (app, sandbox, and PAT sessions do not resolve here), the current password, and provider-specific authorization. Migration diagnostics require the same owning admin.'
		},
		methods: ['POST'],
		steps: [
			'Read the protected Thing through its dedicated endpoint and choose one returned revealables reference.',
			'POST thingId, reference, and the current account password as same-origin application/json.',
			'Use the returned value transiently; do not persist it in browser storage or a URL.',
			'Repeat password confirmation for every later reveal.'
		],
		requestExamples: [
			{
				name: 'Reveal one migration ObjectId',
				description: 'Confirm the current password for this single lookup.',
				method: 'POST',
				body: {
					thingId: 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90',
					reference: 'mongodb-object-id-1',
					password: '<current password>'
				}
			}
		],
		responseExamples: [
			{
				status: 200,
				description: 'Exactly one approved value returned.',
				body: {
					ok: true,
					reveal: { reference: 'mongodb-object-id-1', kind: 'mongodb-object-id', value: '507f1f77bcf86cd799439011' }
				}
			},
			{ status: 401, description: 'No full live account session.', body: { ok: false, error: 'Unauthorized' } },
			{ status: 401, description: 'Current-password confirmation failed.', body: { ok: false, error: 'Password confirmation failed' } },
			{ status: 404, description: 'Missing, expired, inaccessible, or unknown reference.', body: { ok: false, error: 'Sensitive value not found' } },
			{
				status: 429,
				description: 'The fixed confirmation-request ceiling was reached.',
				body: { ok: false, error: 'Too many reveal confirmation attempts' }
			},
			{
				status: 503,
				description: 'The rate limiter, password verifier, or protected reader is temporarily unavailable.',
				body: { ok: false, error: 'Sensitive reveal is temporarily unavailable' }
			}
		],
		notes: [
			'Content-Type must be application/json. Browser requests with a cross-origin Origin header are rejected.',
			'No confirmation cookie, token, or grace period is issued; each reveal request includes and verifies the password again.',
			'Every success and error response, including unsupported GET/HEAD and oversized-body errors, is private and no-store.'
		]
	}),
  endpoint({
    id: 'admin-migrations-run',
    group: 'admin',
    title: 'Run migration',
    endpoint: '/api/v1/admin/migrations/run',
    summary: 'Runs (or dry-runs) a registered schema-version migration.',
    detail:
      'Migrations are idempotent, so re-running after a partial failure only touches what is left. The things v1→v2 ' +
      'migration explodes embedded comments/reactions into standalone things, converts share posts to thingtime ' +
      '["post","share"], moves post payloads under crystal, and stamps schemaVersion; the other collections stamp the ' +
      'version they already conform to. merge-legacy-collections folds leftover unversioned collections into their ' +
      'versioned successors, and drop-stale-collection-generations removes superseded physical collections — that one ' +
			'is destructive and additionally requires confirm: true on the non-dry run. Failed real runs may return a private ' +
			'diagnosticThingId for the same admin to open at /thing/:id; failed dry runs never create diagnostics and instead return ' +
			'bounded redacted adminDetail inline.',
    auth: {
      mode: 'session-or-bearer',
      description: 'Admin-only (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers get 401, signed-in non-admins 403.'
    },
    methods: ['POST'],
    steps: [
      'POST the migration id from /api/v1/admin/migrations.',
      'Pass dryRun: true first to see matched counts without writing.',
      'Pass confirm: true when running a destructive migration for real.',
      'Read the report for matched, migrated, created, skipped, and notes.',
			'On failure, open diagnosticThingId as the same admin, or render adminDetail when persistence was skipped or unavailable.',
      'Handle 401 non-admin callers and 404 unknown migration ids.'
    ],
    requestExamples: [
      {
        name: 'Dry-run the things migration',
        description: 'Count what the unified-thing migration would touch.',
        method: 'POST',
        body: { migration: 'things-v1-to-v2', dryRun: true }
      },
      {
        name: 'Run the things migration',
        description: 'Migrate v1 posts to unified v2 things.',
        method: 'POST',
        body: { migration: 'things-v1-to-v2' }
      }
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Migration report returned.',
        body: {
          ok: true,
          migration: 'things-v1-to-v2',
          report: { dryRun: false, matched: 24, migrated: 24, created: 28, skipped: 0, notes: [] }
        }
      },
			{
				status: 500,
				description: 'Real run failed; a private diagnostic was saved after the migration lease was released.',
				body: {
					ok: false,
					error:
						'Migration backfill-user-storage-accounting stopped before completion: MongoServerError (224). Refresh migration status before retrying.',
					outcome: 'unknown',
					diagnosticThingId: 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90'
				}
			},
      {
        status: 404,
        description: 'Unknown migration id.',
        body: { ok: false, error: 'Unknown migration' }
      }
    ]
  })
];

const normaliseApiPath = (input: string) => {
  const raw = String(input || '').trim();
  const pathname = raw.includes('://') ? new URL(raw).pathname : raw.split('?')[0].split('#')[0];
  let path = pathname.replace(/^\/+|\/+$/g, '');

  if (!path.startsWith('api/')) {
    path = `api/${path}`;
  }

  path = `/${path}`;

  if (path.endsWith('-docs')) {
    path = path.slice(0, -'-docs'.length);
  }

  return path;
};

const apiDocMap = new Map(apiEndpointDocs.map((doc) => [normaliseApiPath(doc.endpoint), doc]));

export const getApiDocByPath = (path: string) => apiDocMap.get(normaliseApiPath(path)) || null;

export const apiV1RouteKeys = apiEndpointDocs.filter((doc) => doc.endpoint.startsWith('/api/v1/')).map((doc) => doc.endpoint.replace(/^\/api\//, ''));

export const apiV1DocsRouteKeys = apiV1RouteKeys.map((route) => `${route}-docs`);

export type ApiCapabilitiesManifest = {
	ok: true;
	schemaVersion: 1;
	features: Record<string, `${number}.${number}.${number}`>;
	dataEnvironment: DeploymentDataEnvironment | null;
};

/** A stable machine-readable name for a concrete API route, including internal routes without public docs. */
export const apiRouteCapabilityId = (routeKey: string) => `route.${routeKey.replace(/\//g, '.')}`;

/**
 * Generated from the canonical public API registry plus the active route map.
 * `api.*` names are semantic, versioned client contracts; `route.*` names make
 * every executable endpoint discoverable, including intentionally undocumented
 * diagnostics and future routes while they are being documented.
 */
export const createApiCapabilitiesManifest = (
	routeKeys: Iterable<string> = [],
	dataEnvironment: DeploymentDataEnvironment | null = null
): ApiCapabilitiesManifest => {
  const features: ApiCapabilitiesManifest['features'] = Object.fromEntries(
    apiEndpointDocs.map((doc) => [`api.${doc.id}`, doc.contractVersion])
  );

  for (const routeKey of routeKeys) {
    features[apiRouteCapabilityId(routeKey)] ||= '1.0.0';
  }

	return { ok: true, schemaVersion: 1, features, dataEnvironment };
};

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

const compactJson = (value: unknown) => JSON.stringify(value);

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const makeUrl = (origin: string, endpointPath: string, query?: ApiRequestExample['query']) => {
  const url = new URL(endpointPath, origin || 'https://thingtime.com');

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const shouldIncludeAuthHeader = (mode: ApiAuthMode) => mode === 'bearer' || mode === 'session-or-bearer' || mode === 'optional';

const buildHeaders = (doc: ApiEndpointDoc, hasBody: boolean) => {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  if (shouldIncludeAuthHeader(doc.auth.mode)) {
    headers.Authorization = 'Bearer YOUR_THINGTIME_TOKEN';
  }

  return headers;
};

const primaryRequestExample = (doc: ApiEndpointDoc): ApiRequestExample =>
  doc.requestExamples[0] || {
    name: doc.title,
    description: doc.summary,
    method: doc.methods[0]
  };

export const buildPlatformExamples = (doc: ApiEndpointDoc, origin = 'https://thingtime.com'): ApiPlatformExamples => {
  const example = primaryRequestExample(doc);
  const method = example.method || doc.methods[0];
  const hasBody = example.body !== undefined;
  const url = makeUrl(origin, doc.endpoint, example.query);
  const headers = { ...buildHeaders(doc, hasBody), ...(example.headers || {}) };
  const jsonBody = hasBody ? compactJson(example.body) : '';
  const prettyBody = hasBody ? prettyJson(example.body) : '';
  const headerEntries = Object.entries(headers);

  const curlLines = [`curl -X ${method} ${shellQuote(url)}`];
  headerEntries.forEach(([key, value]) => curlLines.push(`  -H ${shellQuote(`${key}: ${value}`)}`));
  if (hasBody) curlLines.push(`  --data ${shellQuote(jsonBody)}`);

  const wgetLines = [`wget --method=${method}`];
  headerEntries.forEach(([key, value]) => wgetLines.push(`  --header=${shellQuote(`${key}: ${value}`)}`));
  if (hasBody) wgetLines.push(`  --body-data=${shellQuote(jsonBody)}`);
  wgetLines.push(`  -O - ${shellQuote(url)}`);

  const node = [
    `const response = await fetch(${JSON.stringify(url)}, {`,
    `  method: ${JSON.stringify(method)},`,
    `  headers: ${prettyJson(headers).replace(/\n/g, '\n  ')}${hasBody ? ',' : ''}`,
    ...(hasBody ? [`  body: JSON.stringify(${prettyBody.replace(/\n/g, '\n  ')})`] : []),
    '});',
    '',
    'if (!response.ok) {',
    '  throw new Error("Thingtime API failed: " + response.status);',
    '}',
    '',
    'console.log(await response.json());'
  ].join('\n');

  const pythonHeaders = prettyJson(headers)
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None');
  const python = [
    'import json',
    'from urllib import request',
    '',
    ...(hasBody ? [`payload = ${prettyBody}`, ''] : []),
    `req = request.Request(`,
    `    ${JSON.stringify(url)},`,
    ...(hasBody ? ['    data=json.dumps(payload).encode("utf-8"),'] : []),
    `    method=${JSON.stringify(method)},`,
    `    headers=${pythonHeaders.replace(/\n/g, '\n    ')}`,
    ')',
    '',
    'with request.urlopen(req) as response:',
    '    print(response.read().decode("utf-8"))'
  ].join('\n');

  const rubyHeaders = ['{', ...headerEntries.map(([key, value]) => `  ${JSON.stringify(key)} => ${JSON.stringify(value)}`), '}'].join('\n');
  const ruby = [
    "require 'json'",
    "require 'net/http'",
    "require 'uri'",
    '',
    ...(hasBody ? [`payload = JSON.parse(<<~JSON)`, prettyBody, 'JSON', ''] : []),
    `uri = URI(${JSON.stringify(url)})`,
    `request = Net::HTTP::${method.charAt(0) + method.slice(1).toLowerCase()}.new(uri)`,
    `${rubyHeaders}.each { |key, value| request[key] = value }`,
    ...(hasBody ? ['request.body = payload.to_json'] : []),
    '',
    'response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|',
    '  http.request(request)',
    'end',
    '',
    'puts response.body'
  ].join('\n');

  return {
    curl: curlLines.join(' \\\n'),
    wget: wgetLines.join(' \\\n'),
    node,
    python,
    ruby
  };
};

export const serializeApiDoc = (doc: ApiEndpointDoc, origin = 'https://thingtime.com'): SerializedApiEndpointDoc => ({
  ...doc,
  platformExamples: buildPlatformExamples(doc, origin)
});

export const createApiDocPayload = (doc: ApiEndpointDoc, origin?: string) => ({
  ok: true,
  docs: serializeApiDoc(doc, origin)
});
