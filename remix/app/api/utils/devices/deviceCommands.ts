import { randomBytes } from 'node:crypto';

import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import {
	DEVICE_APPROVAL_STATUSES,
	DEVICE_COMMAND_STATUSES,
	canTransitionDeviceCommand,
	deviceCommandRequiresApproval,
	decideDeviceLease,
	deviceConnectorSupportsCommand,
	deviceSupportsCommand,
	deviceControlEventLogicalBytes,
	deviceFail,
	deviceHash,
	normalizeDevicePermissionMode,
	devicePayloadHash,
	normalizeDeviceCommand,
	normalizeCommandKind,
	normalizeRequestId,
	type DeviceCommandApprovalState,
	type DeviceCommandStatus,
	type DeviceFail
} from './deviceCore';
import { DEVICE_CONNECTOR_FRESHNESS_MS, appendDeviceEvent, deviceConnectorIsFresh, deviceExistsForOwner, newDeviceThing } from './devices';

export const DEVICE_COMMAND_LEASE_MS = 30_000;
export const DEVICE_COMMAND_HEARTBEAT_INTERVAL_MS = 10_000;
const DEVICE_COMMAND_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_COMMANDS_PER_DEVICE = 512;
const MAX_PENDING_COMMAND_BYTES_PER_DEVICE = 1024 * 1024;
const MAX_COMMANDS_PAGE = 200;
const MAX_APPROVALS_PAGE = 200;
export const DEVICE_APPROVAL_DEFAULT_TTL_MS = 10 * 60 * 1000;
export const DEVICE_APPROVAL_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const DEVICE_APPROVAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_APPROVALS_PER_DEVICE = 128;

export const deviceApprovalExpiry = (value: unknown, now = new Date()): Date | null => {
	if (value === undefined || value === null) return new Date(now.getTime() + DEVICE_APPROVAL_DEFAULT_TTL_MS);
	const expiresAt = new Date(String(value));
	return Number.isFinite(expiresAt.getTime()) &&
		expiresAt.getTime() > now.getTime() &&
		expiresAt.getTime() <= now.getTime() + DEVICE_APPROVAL_MAX_TTL_MS
		? expiresAt
		: null;
};

export const availableDeviceApprovalSlot = (values: unknown[]): number | null => {
	const used = new Set(
		values.filter((value): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < MAX_PENDING_APPROVALS_PER_DEVICE)
	);
	for (let slot = 0; slot < MAX_PENDING_APPROVALS_PER_DEVICE; slot += 1) {
		if (!used.has(slot)) return slot;
	}
	return null;
};

export const deviceSessionSendRedactionFields = (command: any, now: Date): Record<string, unknown> => {
	if (command?.crystal?.kind !== 'session.send') return {};
	const input = command.crystal?.input && typeof command.crystal.input === 'object' ? (command.crystal.input as Record<string, unknown>) : {};
	const text = typeof input.text === 'string' ? input.text : '';
	return {
		'crystal.input.text': '',
		'crystal.controlBytes': deviceControlEventLogicalBytes({ kind: 'session.send', input: { ...input, text: '' } }),
		...(text
			? {
					'crystal.inputTextHash': devicePayloadHash(text),
					'crystal.inputRedactedAt': now
			  }
			: {})
	};
};

const iso = (value: unknown): string | null => {
	if (!value) return null;
	const date = new Date(value as any);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const bounded = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const commandOutputReference = (value: unknown): string | null => {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || !value || value !== value.trim() || Array.from(value).length > 2_048) return null;
	return /[\p{Cc}\p{Cf}]/u.test(value) ? null : value;
};

export type PublicDeviceCommand = {
	id: string;
	requestId: string;
	deviceId: string;
	kind: string;
	status: DeviceCommandStatus;
	input: Record<string, unknown>;
	requiresApproval: boolean;
	approvalState: DeviceCommandApprovalState;
	error: string | null;
	outputRef: string | null;
	createdAt: string;
	updatedAt: string;
	claimedAt: string | null;
	leaseExpiresAt: string | null;
	completedAt: string | null;
};

const commandStatus = (value: unknown): DeviceCommandStatus =>
	typeof value === 'string' && (DEVICE_COMMAND_STATUSES as readonly string[]).includes(value) ? (value as DeviceCommandStatus) : 'needs-review';

const commandApprovalState = (value: unknown, requiresApproval: boolean): DeviceCommandApprovalState => {
	if (value === 'pending' || value === 'approved' || value === 'denied' || value === 'not-required') return value;
	return requiresApproval ? 'pending' : 'not-required';
};

export const publicDeviceCommand = (doc: any): PublicDeviceCommand => {
	const requiresApproval = doc.crystal?.requiresApproval === true;
	return {
		id: String(doc.shareId),
		requestId: String(doc.crystal?.requestId || ''),
		deviceId: String(doc.targetId),
		kind: String(doc.crystal?.kind || ''),
		status: commandStatus(doc.crystal?.status),
		input: doc.crystal?.input && typeof doc.crystal.input === 'object' ? doc.crystal.input : {},
		requiresApproval,
		approvalState: commandApprovalState(doc.crystal?.approvalState, requiresApproval),
		error: typeof doc.crystal?.error === 'string' ? doc.crystal.error : null,
		outputRef: typeof doc.crystal?.outputRef === 'string' ? doc.crystal.outputRef : null,
		createdAt: new Date(doc.createdAt).toISOString(),
		updatedAt: new Date(doc.updatedAt).toISOString(),
		claimedAt: iso(doc.crystal?.claimedAt),
		leaseExpiresAt: iso(doc.crystal?.leaseExpiresAt),
		completedAt: iso(doc.crystal?.completedAt)
	};
};

type CreateCommandInput = {
	deviceId?: unknown;
	requestId?: unknown;
	kind?: unknown;
	input?: unknown;
	requiresApproval?: unknown;
};

type PreparedCommand = {
	ok: true;
	doc: any;
	commandKey: string;
	payloadHash: string;
};

const prepareCommand = (
	ownerId: string,
	input: CreateCommandInput,
	options: { shareId?: string; requiresApproval?: boolean } = {}
): DeviceFail | PreparedCommand => {
	const deviceId = bounded(input?.deviceId, 160);
	const requestId = normalizeRequestId(input?.requestId);
	const kind = normalizeCommandKind(input?.kind);
	const normalizedInput = kind ? normalizeDeviceCommand(kind, input?.input) : null;
	if (!deviceId) return deviceFail(400, 'deviceId is required');
	if (!requestId) return deviceFail(400, 'requestId must be a stable bounded identifier');
	if (!kind) return deviceFail(400, 'Command kind is not allowed');
	if (!normalizedInput) return deviceFail(400, 'Command kind is not allowed');
	if (normalizedInput.ok === false) return normalizedInput;
	if (input?.requiresApproval !== undefined && typeof input.requiresApproval !== 'boolean') {
		return deviceFail(400, 'requiresApproval must be a boolean');
	}
	const requiresApproval = deviceCommandRequiresApproval(kind, options.requiresApproval ?? input?.requiresApproval === true);
	const payload = { kind, input: normalizedInput.input, requiresApproval };
	const payloadHash = devicePayloadHash(payload);
	const controlBytes = deviceControlEventLogicalBytes(payload);
	const commandKey = deviceHash('command', ownerId, deviceId, requestId);
	return {
		ok: true,
		commandKey,
		payloadHash,
		doc: newDeviceThing('device-command', {
			...(options.shareId ? { shareId: options.shareId } : {}),
			ownerId,
			targetId: deviceId,
			control: true,
			crystal: {
				deviceCommandKey: commandKey,
				requestId,
				payloadHash,
				controlBytes,
				kind,
				input: normalizedInput.input,
				requiresApproval,
				approvalState: requiresApproval ? 'pending' : 'not-required',
				status: requiresApproval ? 'needs-approval' : 'queued',
				claimedAt: null,
				leaseHash: null,
				leaseExpiresAt: null,
				completedAt: null,
				error: null,
				outputRef: null,
				lastReportKey: null,
				lastReportHash: null
			}
		})
	};
};

const reconcileCommand = (existing: any, payloadHash: string): DeviceFail | { ok: true; command: PublicDeviceCommand; idempotent: true } =>
	existing?.crystal?.payloadHash === payloadHash
		? { ok: true, command: publicDeviceCommand(existing), idempotent: true }
		: deviceFail(409, 'requestId was already used for different command content');

export const createDeviceCommand = async (
	ownerId: string,
	input: CreateCommandInput
): Promise<DeviceFail | { ok: true; command: PublicDeviceCommand; idempotent: boolean }> => {
	let prepared = prepareCommand(ownerId, input);
	if (prepared.ok === false) return prepared;
	const deviceId = String(prepared.doc.targetId);
	const device = await deviceExistsForOwner(ownerId, deviceId);
	if (!device) return deviceFail(404, 'Device not found');
	const permissionMode = normalizeDevicePermissionMode(device.crystal?.permissionMode);
	if (permissionMode === 'deny') return deviceFail(403, 'This account has denied remote actions for this device');
	prepared = prepareCommand(ownerId, input, {
		shareId: String(prepared.doc.shareId),
		requiresApproval: deviceCommandRequiresApproval(prepared.doc.crystal.kind, permissionMode === 'ask-every-time' || input.requiresApproval === true)
	});
	if (prepared.ok === false) return prepared;
	const things = await getHomeThingsCollection();
	const connectorId = typeof prepared.doc.crystal?.input?.connectorId === 'string' ? prepared.doc.crystal.input.connectorId : null;
	if (!connectorId && !deviceSupportsCommand(prepared.doc.crystal.kind, device.crystal?.capabilities)) {
		return deviceFail(409, 'The paired device does not advertise support for this command');
	}
	if (connectorId) {
		const [connectorDoc, stateDoc] = await Promise.all([
			things.findOne({
				thingtime: 'device-connector',
				ownerId,
				targetId: deviceId,
				'crystal.connector.id': connectorId,
				updatedAt: { $gt: new Date(Date.now() - DEVICE_CONNECTOR_FRESHNESS_MS) }
			} as any),
			things.findOne({ thingtime: 'device-state', ownerId, targetId: deviceId } as any, { projection: { 'crystal.revision': 1 } })
		]);
		if (
			!connectorDoc ||
			!deviceConnectorIsFresh(connectorDoc) ||
			!Number.isSafeInteger(stateDoc?.crystal?.revision) ||
			stateDoc.crystal.revision !== connectorDoc.crystal?.revision
		) {
			return deviceFail(409, 'The target connector is missing or its complete device snapshot is stale');
		}
		const kind = prepared.doc.crystal.kind;
		if (!deviceConnectorSupportsCommand(kind, prepared.doc.crystal.input, connectorDoc.crystal?.connector ?? { capabilities: [] })) {
			return deviceFail(409, 'The target connector does not advertise support for this command');
		}
	}
	const existing = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', prepared.commandKey) as any);
	if (existing) return reconcileCommand(existing, prepared.payloadHash);
	const requiresApproval = prepared.doc.crystal.requiresApproval === true;
	const commandId = String(prepared.doc.shareId);
	const commandCreatedAt = new Date(prepared.doc.createdAt);
	const approvalExpiresAt = new Date(commandCreatedAt.getTime() + DEVICE_APPROVAL_DEFAULT_TTL_MS);
	const approvalKey = requiresApproval ? deviceHash('approval', ownerId, deviceId, commandId, 'command-dispatch') : null;
	const approval = approvalKey
		? newDeviceThing('device-approval', {
				ownerId,
				targetId: deviceId,
				control: true,
				crystal: {
					deviceApprovalKey: approvalKey,
					payloadHash: devicePayloadHash({ commandId, kind: prepared.doc.crystal.kind }),
					commandId,
					requestId: String(prepared.doc.crystal.requestId),
					kind: 'command-dispatch',
					prompt: `Allow ${String(prepared.doc.crystal.kind)} on this device?`,
					status: 'pending',
					expiresAt: approvalExpiresAt,
					deviceTtlAt: new Date(approvalExpiresAt.getTime() + DEVICE_APPROVAL_RETENTION_MS),
					approvalPendingSlot: null,
					decidedAt: null
				}
		  })
		: null;
	if (approval) {
		// If an entirely offline device never returns to drive lazy expiry,
		// Mongo's approval TTL must not leave an immortal needs-approval command.
		prepared.doc.crystal.deviceTtlAt = approval.crystal.deviceTtlAt;
	}
	try {
		await withHomeMongoTransaction(async (session) => {
			const currentDevice = await things.findOne({ thingtime: 'device', ownerId, shareId: deviceId } as any, {
				projection: { 'crystal.capabilities': 1, 'crystal.permissionMode': 1 },
				session
			});
			if (!currentDevice || (!connectorId && !deviceSupportsCommand(prepared.doc.crystal.kind, currentDevice.crystal?.capabilities))) {
				throw Object.assign(new Error('device_capability_policy_changed'), { status: 409 });
			}
			const currentPermissionMode = normalizeDevicePermissionMode(currentDevice.crystal?.permissionMode);
			if (currentPermissionMode === 'deny') throw Object.assign(new Error('device_permission_policy_denied'), { status: 403 });
			const currentRequiresApproval = deviceCommandRequiresApproval(
				prepared.doc.crystal.kind,
				currentPermissionMode === 'ask-every-time' || input.requiresApproval === true
			);
			if (currentRequiresApproval !== (prepared.doc.crystal.requiresApproval === true)) {
				throw Object.assign(new Error('device_permission_policy_changed'), { status: 409 });
			}
			if (connectorId) {
				const [currentConnector, currentState] = await Promise.all([
					things.findOne(
						{
							thingtime: 'device-connector',
							ownerId,
							targetId: deviceId,
							'crystal.connector.id': connectorId,
							updatedAt: { $gt: new Date(Date.now() - DEVICE_CONNECTOR_FRESHNESS_MS) }
						} as any,
						{ session }
					),
					things.findOne({ thingtime: 'device-state', ownerId, targetId: deviceId } as any, { projection: { 'crystal.revision': 1 }, session })
				]);
				const connectorSupportsCommand = currentConnector
					? deviceConnectorSupportsCommand(
							prepared.doc.crystal.kind,
							prepared.doc.crystal.input,
							currentConnector.crystal?.connector ?? { capabilities: [] }
					  )
					: false;
				if (
					!currentConnector ||
					!deviceConnectorIsFresh(currentConnector) ||
					!Number.isSafeInteger(currentState?.crystal?.revision) ||
					currentState.crystal.revision !== currentConnector.crystal?.revision ||
					!connectorSupportsCommand
				) {
					throw Object.assign(new Error('device_connector_policy_changed'), { status: 409 });
				}
			}
			const pending = await things
				.find(
					{
						thingtime: 'device-command',
						ownerId,
						targetId: deviceId,
						'crystal.status': { $in: ['queued', 'claimed', 'running', 'needs-approval'] }
					} as any,
					{
						projection: { 'crystal.controlBytes': 1, 'crystal.kind': 1, 'crystal.input': 1 },
						session
					}
				)
				.limit(MAX_PENDING_COMMANDS_PER_DEVICE + 1)
				.toArray();
			const pendingBytes = pending.reduce(
				(total: number, command: any) =>
					total +
					(Number.isSafeInteger(command.crystal?.controlBytes)
						? Number(command.crystal.controlBytes)
						: deviceControlEventLogicalBytes({ kind: command.crystal?.kind, input: command.crystal?.input ?? {} })),
				0
			);
			if (
				pending.length >= MAX_PENDING_COMMANDS_PER_DEVICE ||
				pendingBytes + Number(prepared.doc.crystal.controlBytes || 0) > MAX_PENDING_COMMAND_BYTES_PER_DEVICE
			) {
				throw Object.assign(new Error('device_command_budget'), { status: 429 });
			}
			if (approval) {
				approval.crystal.approvalPendingSlot = await reservePendingApprovalSlot(things, ownerId, deviceId, new Date(), session);
			}
			await things.insertOne(prepared.doc, { session });
			if (approval) await things.insertOne(approval, { session });
			await appendDeviceEvent(
				{
					ownerId,
					deviceId,
					eventType: requiresApproval ? 'command.approval-required' : 'command.queued',
					resourceId: String(prepared.doc.shareId),
					payload: {
						kind: prepared.doc.crystal.kind,
						status: prepared.doc.crystal.status,
						...(approval ? { approvalId: String(approval.shareId) } : {})
					},
					idempotencyKey: `command:${prepared.commandKey}:${requiresApproval ? 'approval-required' : 'queued'}`
				},
				session
			);
			if (approval) {
				await appendDeviceEvent(
					{
						ownerId,
						deviceId,
						eventType: 'approval.requested',
						resourceId: String(approval.shareId),
						payload: { commandId, kind: 'command-dispatch' },
						idempotencyKey: `approval:${approvalKey}:requested`
					},
					session
				);
			}
		});
	} catch (error: any) {
		if (error?.status === 409 || error?.message === 'device_connector_policy_changed' || error?.message === 'device_capability_policy_changed') {
			return deviceFail(409, 'The device capability, connector snapshot, or permission setting changed; retry command creation');
		}
		if (error?.status === 403 || error?.message === 'device_permission_policy_denied') {
			return deviceFail(403, 'This account has denied remote actions for this device');
		}
		if (error?.message === 'device_approval_budget') {
			return deviceFail(429, 'This device already has the maximum number of pending approvals');
		}
		if (error?.status === 429 || error?.message === 'device_command_budget') {
			return deviceFail(429, 'This device has too much pending command data; wait for delivery or cancel older work');
		}
		if (error?.code !== 11000) throw error;
		const raced = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', prepared.commandKey) as any);
		return raced ? reconcileCommand(raced, prepared.payloadHash) : deviceFail(409, 'Command creation raced; retry');
	}
	return { ok: true, command: publicDeviceCommand(prepared.doc), idempotent: false };
};

export const listDeviceCommands = async (
	ownerId: string,
	deviceIdValue: unknown,
	statusValue?: unknown
): Promise<DeviceFail | { ok: true; commands: PublicDeviceCommand[] }> => {
	const deviceId = bounded(deviceIdValue, 160);
	if (!deviceId) return deviceFail(400, 'deviceId is required');
	if (!(await deviceExistsForOwner(ownerId, deviceId))) return deviceFail(404, 'Device not found');
	await expirePendingApprovals(ownerId, deviceId);
	const filter: any = { thingtime: 'device-command', ownerId, targetId: deviceId };
	if (statusValue) {
		if (typeof statusValue !== 'string' || !(DEVICE_COMMAND_STATUSES as readonly string[]).includes(statusValue)) {
			return deviceFail(400, 'status is invalid');
		}
		filter['crystal.status'] = statusValue;
	}
	const docs = await (await getHomeThingsCollection()).find(filter).sort({ createdAt: -1, shareId: 1 }).limit(MAX_COMMANDS_PAGE).toArray();
	return { ok: true, commands: docs.map(publicDeviceCommand) };
};

const leaseHash = (leaseId: string): string => deviceHash('lease', leaseId);

const markOneExpiredLeaseNeedsReview = async (things: any, ownerId: string, deviceId: string, command: any, now: Date): Promise<boolean> => {
	const expiresAt = command.crystal?.leaseExpiresAt ? new Date(command.crystal.leaseExpiresAt) : null;
	if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > now.getTime()) return false;
	let changed = false;
	await withHomeMongoTransaction(async (session) => {
		const result = await things.updateOne(
			{
				_id: command._id,
				'crystal.status': { $in: ['claimed', 'running', 'needs-approval'] },
				'crystal.leaseHash': command.crystal?.leaseHash,
				'crystal.leaseExpiresAt': { $lte: now }
			} as any,
			{
				$set: {
					'crystal.status': 'needs-review',
					'crystal.completedAt': now,
					'crystal.error': 'The execution lease expired after the command may have started; it was not retried automatically.',
					'crystal.leaseHash': null,
					'crystal.leaseExpiresAt': null,
					'crystal.expiresAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
					'crystal.deviceTtlAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
					...deviceSessionSendRedactionFields(command, now),
					updatedAt: now
				}
			},
			{ session }
		);
		if (!result.modifiedCount) return;
		changed = true;
		await appendDeviceEvent(
			{
				ownerId,
				deviceId,
				eventType: 'command.needs-review',
				resourceId: String(command.shareId),
				payload: { status: 'needs-review', reason: 'lease-expired' },
				idempotencyKey: `command:${command.shareId}:lease-expired:${expiresAt.toISOString()}`
			},
			session
		);
	});
	return changed;
};

const markExpiredLeasesNeedsReview = async (ownerId: string, deviceId: string): Promise<void> => {
	const things = await getHomeThingsCollection();
	const now = new Date();
	const expired = await things
		.find({
			thingtime: 'device-command',
			ownerId,
			targetId: deviceId,
			'crystal.status': { $in: ['claimed', 'running', 'needs-approval'] },
			'crystal.leaseExpiresAt': { $lte: now }
		} as any)
		.sort({ 'crystal.leaseExpiresAt': 1 })
		.limit(25)
		.toArray();
	for (const command of expired as any[]) {
		await markOneExpiredLeaseNeedsReview(things, ownerId, deviceId, command, now);
	}
};

export type NodeDeviceCommand = PublicDeviceCommand & { leaseId: string };

export const claimNextDeviceCommand = async (
	ownerId: string,
	deviceId: string,
	waitMsValue: unknown
): Promise<DeviceFail | { ok: true; command: NodeDeviceCommand | null; serverTime: string }> => {
	if (!(await deviceExistsForOwner(ownerId, deviceId))) return deviceFail(404, 'Device not found');
	const waitMs = Math.max(0, Math.min(20_000, Math.floor(Number(waitMsValue) || 0)));
	const deadline = Date.now() + waitMs;
	const things = await getHomeThingsCollection();
	for (;;) {
		await markExpiredLeasesNeedsReview(ownerId, deviceId);
		const leaseId = randomBytes(24).toString('base64url');
		const now = new Date();
		const leaseExpiresAt = new Date(now.getTime() + DEVICE_COMMAND_LEASE_MS);
		let claimed: any = null;
		await withHomeMongoTransaction(async (session) => {
			claimed = await things.findOneAndUpdate(
				{
					thingtime: 'device-command',
					ownerId,
					targetId: deviceId,
					'crystal.status': 'queued',
					$or: [{ 'crystal.requiresApproval': { $ne: true } }, { 'crystal.approvalState': 'approved' }]
				} as any,
				{
					$set: {
						'crystal.status': 'claimed',
						'crystal.claimedAt': now,
						'crystal.leaseHash': leaseHash(leaseId),
						'crystal.leaseExpiresAt': leaseExpiresAt,
						updatedAt: now
					}
				},
				{ sort: { createdAt: 1, shareId: 1 }, returnDocument: 'after', session }
			);
			if (!claimed) return;
			await appendDeviceEvent(
				{
					ownerId,
					deviceId,
					eventType: 'command.claimed',
					resourceId: String(claimed.shareId),
					payload: { status: 'claimed', leaseExpiresAt: leaseExpiresAt.toISOString() },
					idempotencyKey: `command:${claimed.shareId}:claimed:${leaseHash(leaseId)}`
				},
				session
			);
		});
		if (claimed) return { ok: true, command: { ...publicDeviceCommand(claimed), leaseId }, serverTime: new Date().toISOString() };
		if (Date.now() >= deadline) return { ok: true, command: null, serverTime: new Date().toISOString() };
		await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
	}
};

export const heartbeatDeviceCommand = async (
	ownerId: string,
	deviceId: string,
	input: { commandId?: unknown; leaseId?: unknown }
): Promise<DeviceFail | { ok: true; leaseExpiresAt: string }> => {
	const commandId = bounded(input?.commandId, 160);
	const leaseId = bounded(input?.leaseId, 160);
	if (!commandId || !leaseId) return deviceFail(400, 'commandId and leaseId are required');
	const now = new Date();
	const leaseExpiresAt = new Date(now.getTime() + DEVICE_COMMAND_LEASE_MS);
	const things = await getHomeThingsCollection();
	const result = await things.updateOne(
		{
			shareId: commandId,
			thingtime: 'device-command',
			ownerId,
			targetId: deviceId,
			'crystal.status': { $in: ['claimed', 'running', 'needs-approval'] },
			'crystal.leaseHash': leaseHash(leaseId),
			'crystal.leaseExpiresAt': { $gt: now }
		} as any,
		{ $set: { 'crystal.leaseExpiresAt': leaseExpiresAt, updatedAt: now } }
	);
	if (result.modifiedCount) return { ok: true, leaseExpiresAt: leaseExpiresAt.toISOString() };
	const current = await things.findOne({ shareId: commandId, thingtime: 'device-command', ownerId, targetId: deviceId } as any);
	if (current && decideDeviceLease(current.crystal?.leaseHash, leaseHash(leaseId), current.crystal?.leaseExpiresAt, now) === 'expired') {
		await markOneExpiredLeaseNeedsReview(things, ownerId, deviceId, current, now);
	}
	return deviceFail(409, 'Command lease is invalid or expired');
};

export const reportDeviceCommand = async (
	ownerId: string,
	deviceId: string,
	input: {
		commandId?: unknown;
		leaseId?: unknown;
		eventId?: unknown;
		status?: unknown;
		error?: unknown;
		outputRef?: unknown;
	}
): Promise<DeviceFail | { ok: true; command: PublicDeviceCommand; idempotent: boolean }> => {
	const commandId = bounded(input?.commandId, 160);
	const leaseId = bounded(input?.leaseId, 160);
	const eventId = normalizeRequestId(input?.eventId);
	const nextStatus =
		typeof input?.status === 'string' && (DEVICE_COMMAND_STATUSES as readonly string[]).includes(input.status)
			? (input.status as DeviceCommandStatus)
			: null;
	if (!commandId || !leaseId || !eventId || !nextStatus || nextStatus === 'queued' || nextStatus === 'claimed') {
		return deviceFail(400, 'commandId, leaseId, eventId and a reportable status are required');
	}
	const error = bounded(input?.error, 1000) || null;
	const outputRef = commandOutputReference(input?.outputRef);
	if (input?.outputRef !== undefined && input.outputRef !== null && !outputRef) {
		return deviceFail(400, 'outputRef must be a bounded opaque identifier');
	}
	const reportKey = deviceHash('command-report', ownerId, deviceId, commandId, eventId);
	const reportHash = devicePayloadHash({ nextStatus, error, outputRef });
	const things = await getHomeThingsCollection();
	const current = await things.findOne({ shareId: commandId, thingtime: 'device-command', ownerId, targetId: deviceId } as any);
	if (!current) return deviceFail(404, 'Command not found');
	const now = new Date();
	const leaseDecision = decideDeviceLease(current.crystal?.leaseHash, leaseHash(leaseId), current.crystal?.leaseExpiresAt, now);
	if (leaseDecision === 'expired') {
		await markOneExpiredLeaseNeedsReview(things, ownerId, deviceId, current, now);
		return deviceFail(409, 'Command lease is expired and its outcome requires review');
	}
	if (leaseDecision === 'invalid') return deviceFail(409, 'Command lease is invalid');
	if (current.crystal?.lastReportKey === reportKey) {
		return current.crystal?.lastReportHash === reportHash
			? { ok: true, command: publicDeviceCommand(current), idempotent: true }
			: deviceFail(409, 'eventId was already used for different report content');
	}
	const from = commandStatus(current.crystal?.status);
	if (!canTransitionDeviceCommand(from, nextStatus)) return deviceFail(409, `Command cannot move from ${from} to ${nextStatus}`);
	const terminal = nextStatus === 'succeeded' || nextStatus === 'failed' || nextStatus === 'cancelled' || nextStatus === 'needs-review';
	let updated: any = null;
	await withHomeMongoTransaction(async (session) => {
		updated = await things.findOneAndUpdate(
			{
				_id: current._id,
				'crystal.status': from,
				'crystal.leaseHash': leaseHash(leaseId),
				'crystal.leaseExpiresAt': { $gt: now },
				'crystal.lastReportKey': current.crystal?.lastReportKey ?? null
			} as any,
			{
				$set: {
					'crystal.status': nextStatus,
					'crystal.error': error,
					'crystal.outputRef': outputRef,
					'crystal.lastReportKey': reportKey,
					'crystal.lastReportHash': reportHash,
					...(terminal
						? {
								'crystal.completedAt': now,
								'crystal.expiresAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
								'crystal.deviceTtlAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
								...deviceSessionSendRedactionFields(current, now)
						  }
						: {}),
					updatedAt: now
				}
			},
			{ returnDocument: 'after', session }
		);
		if (!updated) throw Object.assign(new Error('command_report_race'), { status: 409 });
		await appendDeviceEvent(
			{
				ownerId,
				deviceId,
				eventType: `command.${nextStatus}`,
				resourceId: commandId,
				payload: { status: nextStatus, error, outputRef },
				idempotencyKey: `command-report:${reportKey}:${reportHash}`
			},
			session
		);
	});
	return { ok: true, command: publicDeviceCommand(updated), idempotent: false };
};

export type PublicDeviceApproval = {
	id: string;
	deviceId: string;
	commandId: string;
	requestId: string;
	kind: string;
	prompt: string;
	status: 'pending' | 'approved' | 'denied' | 'expired';
	createdAt: string;
	expiresAt: string | null;
	decidedAt: string | null;
};

const publicApproval = (doc: any): PublicDeviceApproval => ({
	id: String(doc.shareId),
	deviceId: String(doc.targetId),
	commandId: String(doc.crystal?.commandId || ''),
	requestId: String(doc.crystal?.requestId || ''),
	kind: String(doc.crystal?.kind || 'permission'),
	prompt: String(doc.crystal?.prompt || ''),
	status: (DEVICE_APPROVAL_STATUSES as readonly string[]).includes(doc.crystal?.status) ? doc.crystal.status : 'expired',
	createdAt: new Date(doc.createdAt).toISOString(),
	expiresAt: iso(doc.crystal?.expiresAt),
	decidedAt: iso(doc.crystal?.decidedAt)
});

const expirePendingApprovalsInSession = async (things: any, ownerId: string, deviceId: string, now: Date, session: any): Promise<void> => {
	const expired = await things
		.find(
			{
				thingtime: 'device-approval',
				ownerId,
				targetId: deviceId,
				'crystal.status': 'pending',
				$or: [{ 'crystal.expiresAt': { $lte: now } }, { 'crystal.expiresAt': null }, { 'crystal.expiresAt': { $exists: false } }]
			} as any,
			{ session }
		)
		.sort({ 'crystal.expiresAt': 1, shareId: 1 })
		.limit(MAX_PENDING_APPROVALS_PER_DEVICE)
		.toArray();
	for (const approval of expired as any[]) {
		const changed = await things.updateOne(
			{
				_id: approval._id,
				'crystal.status': 'pending',
				$or: [{ 'crystal.expiresAt': { $lte: now } }, { 'crystal.expiresAt': null }, { 'crystal.expiresAt': { $exists: false } }]
			} as any,
			{
				$set: {
					'crystal.status': 'expired',
					'crystal.decidedAt': now,
					'crystal.deviceTtlAt': new Date(now.getTime() + DEVICE_APPROVAL_RETENTION_MS),
					updatedAt: now
				},
				$unset: { 'crystal.approvalPendingSlot': '' }
			},
			{ session }
		);
		if (!changed.modifiedCount) continue;
		const command = await things.findOne(
			{
				shareId: String(approval.crystal?.commandId || ''),
				thingtime: 'device-command',
				ownerId,
				targetId: deviceId
			} as any,
			{ session }
		);
		const commandUpdate = command
			? await things.updateOne(
					{
						_id: command._id,
						'crystal.status': 'needs-approval'
					} as any,
					{
						$set: {
							'crystal.status': 'cancelled',
							...(approval.crystal?.kind === 'command-dispatch' ? { 'crystal.approvalState': 'denied' } : {}),
							'crystal.completedAt': now,
							'crystal.error': 'The approval request expired before it was accepted.',
							'crystal.leaseHash': null,
							'crystal.leaseExpiresAt': null,
							'crystal.expiresAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
							'crystal.deviceTtlAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
							...deviceSessionSendRedactionFields(command, now),
							updatedAt: now
						}
					},
					{ session }
			  )
			: null;
		if (commandUpdate?.modifiedCount) {
			await appendDeviceEvent(
				{
					ownerId,
					deviceId,
					eventType: 'command.cancelled',
					resourceId: String(approval.crystal?.commandId || ''),
					payload: { status: 'cancelled', approvalId: String(approval.shareId), reason: 'approval-expired' },
					idempotencyKey: `command:${String(approval.crystal?.commandId || '')}:approval-expired:${String(approval.shareId)}`
				},
				session
			);
		}
		await appendDeviceEvent(
			{
				ownerId,
				deviceId,
				eventType: 'approval.expired',
				resourceId: String(approval.shareId),
				payload: { commandId: String(approval.crystal?.commandId || ''), status: 'expired' },
				idempotencyKey: `approval:${String(approval.shareId)}:expired`
			},
			session
		);
	}
};

const reservePendingApprovalSlot = async (things: any, ownerId: string, deviceId: string, now: Date, session: any): Promise<number> => {
	await expirePendingApprovalsInSession(things, ownerId, deviceId, now, session);
	const pending = await things
		.find(
			{
				thingtime: 'device-approval',
				ownerId,
				targetId: deviceId,
				'crystal.status': 'pending',
				'crystal.expiresAt': { $gt: now }
			} as any,
			{ projection: { 'crystal.approvalPendingSlot': 1 }, session }
		)
		.limit(MAX_PENDING_APPROVALS_PER_DEVICE + 1)
		.toArray();
	if (pending.length >= MAX_PENDING_APPROVALS_PER_DEVICE) {
		throw Object.assign(new Error('device_approval_budget'), { status: 429 });
	}
	const slot = availableDeviceApprovalSlot(pending.map((entry: any) => entry.crystal?.approvalPendingSlot));
	if (slot === null) throw Object.assign(new Error('device_approval_budget'), { status: 429 });
	return slot;
};

const expirePendingApprovals = async (ownerId: string, deviceId: string): Promise<void> => {
	const things = await getHomeThingsCollection();
	await withHomeMongoTransaction((session) => expirePendingApprovalsInSession(things, ownerId, deviceId, new Date(), session));
};

export const requestDeviceApproval = async (
	ownerId: string,
	deviceId: string,
	input: {
		commandId?: unknown;
		leaseId?: unknown;
		requestId?: unknown;
		kind?: unknown;
		prompt?: unknown;
		expiresAt?: unknown;
	}
): Promise<DeviceFail | { ok: true; approval: PublicDeviceApproval; idempotent: boolean }> => {
	const commandId = bounded(input?.commandId, 160);
	const leaseId = bounded(input?.leaseId, 160);
	const requestId = normalizeRequestId(input?.requestId);
	const kind = bounded(input?.kind, 80);
	const prompt = bounded(input?.prompt, 1000);
	if (!commandId || !leaseId || !requestId || !kind || !prompt) {
		return deviceFail(400, 'commandId, leaseId, requestId, kind and prompt are required');
	}
	const now = new Date();
	const expiresAt = deviceApprovalExpiry(input?.expiresAt, now);
	if (!expiresAt) return deviceFail(400, 'expiresAt must be within the next 24 hours');
	const things = await getHomeThingsCollection();
	const command = await things.findOne({ shareId: commandId, thingtime: 'device-command', ownerId, targetId: deviceId } as any);
	if (!command) return deviceFail(404, 'Command not found');
	const leaseNow = new Date();
	const leaseDecision = decideDeviceLease(command.crystal?.leaseHash, leaseHash(leaseId), command.crystal?.leaseExpiresAt, leaseNow);
	if (leaseDecision === 'expired') {
		await markOneExpiredLeaseNeedsReview(things, ownerId, deviceId, command, leaseNow);
		return deviceFail(409, 'Command lease is expired and its outcome requires review');
	}
	if (leaseDecision === 'invalid') return deviceFail(409, 'Command lease is invalid');
	const key = deviceHash('approval', ownerId, deviceId, commandId, requestId);
	const payloadHash = devicePayloadHash({
		kind,
		prompt,
		expiresAt: input?.expiresAt === undefined || input.expiresAt === null ? 'default' : expiresAt.toISOString()
	});
	const existing = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', key) as any);
	if (existing) {
		return existing.crystal?.payloadHash === payloadHash
			? { ok: true, approval: publicApproval(existing), idempotent: true }
			: deviceFail(409, 'requestId was already used for a different approval');
	}
	const approval = newDeviceThing('device-approval', {
		ownerId,
		targetId: deviceId,
		control: true,
		crystal: {
			deviceApprovalKey: key,
			payloadHash,
			commandId,
			requestId,
			kind,
			prompt,
			status: 'pending',
			expiresAt,
			deviceTtlAt: new Date(expiresAt.getTime() + DEVICE_APPROVAL_RETENTION_MS),
			approvalPendingSlot: null,
			decidedAt: null
		}
	});
	try {
		await withHomeMongoTransaction(async (session) => {
			const transactionNow = new Date();
			if (expiresAt.getTime() <= transactionNow.getTime()) {
				throw Object.assign(new Error('approval_deadline_elapsed'), { status: 409 });
			}
			approval.crystal.approvalPendingSlot = await reservePendingApprovalSlot(things, ownerId, deviceId, transactionNow, session);
			await things.insertOne(approval, { session });
			const changed = await things.updateOne(
				{
					_id: command._id,
					'crystal.status': { $in: ['claimed', 'running', 'needs-approval'] },
					'crystal.leaseHash': leaseHash(leaseId),
					'crystal.leaseExpiresAt': { $gt: transactionNow },
					$expr: { $gt: ['$crystal.leaseExpiresAt', '$$NOW'] }
				} as any,
				{
					$set: {
						'crystal.status': 'needs-approval',
						'crystal.deviceTtlAt': approval.crystal.deviceTtlAt,
						updatedAt: transactionNow
					}
				},
				{ session }
			);
			if (!changed.modifiedCount) throw Object.assign(new Error('approval_command_race'), { status: 409 });
			await appendDeviceEvent(
				{
					ownerId,
					deviceId,
					eventType: 'approval.requested',
					resourceId: String(approval.shareId),
					payload: { commandId, kind, prompt, expiresAt: expiresAt?.toISOString() ?? null },
					idempotencyKey: `approval:${key}:requested`
				},
				session
			);
		});
	} catch (error: any) {
		if (error?.message === 'device_approval_budget') {
			return deviceFail(429, 'This device already has the maximum number of pending approvals');
		}
		if (error?.message === 'approval_deadline_elapsed' || error?.message === 'approval_command_race') {
			return deviceFail(409, 'The command lease or approval deadline elapsed; retry the operation');
		}
		if (error?.code === 11000) {
			const raced = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', key) as any);
			return raced && raced.crystal?.payloadHash === payloadHash
				? { ok: true, approval: publicApproval(raced), idempotent: true }
				: deviceFail(409, 'Approval creation raced; retry');
		}
		throw error;
	}
	return { ok: true, approval: publicApproval(approval), idempotent: false };
};

export const listDeviceApprovals = async (
	ownerId: string,
	deviceIdValue: unknown,
	statusValue?: unknown
): Promise<DeviceFail | { ok: true; approvals: PublicDeviceApproval[] }> => {
	const deviceId = bounded(deviceIdValue, 160);
	if (!deviceId) return deviceFail(400, 'deviceId is required');
	if (!(await deviceExistsForOwner(ownerId, deviceId))) return deviceFail(404, 'Device not found');
	await expirePendingApprovals(ownerId, deviceId);
	const filter: any = { thingtime: 'device-approval', ownerId, targetId: deviceId };
	if (statusValue) {
		if (typeof statusValue !== 'string' || !(DEVICE_APPROVAL_STATUSES as readonly string[]).includes(statusValue)) {
			return deviceFail(400, 'status is invalid');
		}
		filter['crystal.status'] = statusValue;
	}
	const docs = await (await getHomeThingsCollection()).find(filter).sort({ createdAt: -1, shareId: 1 }).limit(MAX_APPROVALS_PAGE).toArray();
	return { ok: true, approvals: docs.map(publicApproval) };
};

export const decideDeviceApproval = async (
	ownerId: string,
	input: { approvalId?: unknown; decision?: unknown }
): Promise<DeviceFail | { ok: true; approval: PublicDeviceApproval; idempotent: boolean }> => {
	const approvalId = bounded(input?.approvalId, 160);
	const decision = input?.decision === 'approved' || input?.decision === 'denied' ? input.decision : null;
	if (!approvalId || !decision) return deviceFail(400, 'approvalId and decision (approved or denied) are required');
	const things = await getHomeThingsCollection();
	const approval = await things.findOne({ shareId: approvalId, thingtime: 'device-approval', ownerId } as any);
	if (!approval) return deviceFail(404, 'Approval not found');
	if (approval.crystal?.status === decision) return { ok: true, approval: publicApproval(approval), idempotent: true };
	if (approval.crystal?.status !== 'pending') return deviceFail(409, 'This approval already has a different final decision');
	if (approval.crystal?.expiresAt && new Date(approval.crystal.expiresAt).getTime() <= Date.now()) {
		await expirePendingApprovals(ownerId, String(approval.targetId));
		return deviceFail(409, 'This approval has expired');
	}
	const now = new Date();
	let updated: any = null;
	try {
		await withHomeMongoTransaction(async (session) => {
			updated = await things.findOneAndUpdate(
				{
					_id: approval._id,
					'crystal.status': 'pending',
					'crystal.expiresAt': { $type: 'date' },
					$expr: { $gt: ['$crystal.expiresAt', '$$NOW'] }
				} as any,
				{
					$set: {
						'crystal.status': decision,
						'crystal.decidedAt': now,
						'crystal.deviceTtlAt': new Date(now.getTime() + DEVICE_APPROVAL_RETENTION_MS),
						updatedAt: now
					},
					$unset: { 'crystal.approvalPendingSlot': '' }
				},
				{ returnDocument: 'after', session }
			);
			if (!updated) throw Object.assign(new Error('approval_decision_race'), { status: 409 });
			const dispatchApproval = approval.crystal?.kind === 'command-dispatch';
			if (dispatchApproval) {
				const nextStatus: DeviceCommandStatus = decision === 'approved' ? 'queued' : 'cancelled';
				const commandBeforeDecision = await things.findOne(
					{
						shareId: String(approval.crystal?.commandId || ''),
						thingtime: 'device-command',
						ownerId,
						targetId: String(approval.targetId)
					} as any,
					{ session }
				);
				const commandUpdate = await things.updateOne(
					{
						shareId: String(approval.crystal?.commandId || ''),
						thingtime: 'device-command',
						ownerId,
						targetId: String(approval.targetId),
						'crystal.status': 'needs-approval',
						'crystal.requiresApproval': true,
						'crystal.approvalState': 'pending'
					} as any,
					{
						$set: {
							'crystal.status': nextStatus,
							'crystal.approvalState': decision,
							...(decision === 'denied'
								? {
										'crystal.completedAt': now,
										'crystal.error': 'Command dispatch was denied by the user.',
										'crystal.expiresAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
										'crystal.deviceTtlAt': new Date(now.getTime() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
										...deviceSessionSendRedactionFields(commandBeforeDecision, now)
								  }
								: {}),
							updatedAt: now
						}
					},
					{ session }
				);
				if (!commandUpdate.modifiedCount) {
					throw Object.assign(new Error('approval_command_race'), { status: 409 });
				}
				await appendDeviceEvent(
					{
						ownerId,
						deviceId: String(approval.targetId),
						eventType: decision === 'approved' ? 'command.queued' : 'command.cancelled',
						resourceId: String(approval.crystal?.commandId || ''),
						payload: { status: nextStatus, approvalId },
						idempotencyKey: `command:${String(approval.crystal?.commandId || '')}:dispatch-${decision}`
					},
					session
				);
			}
			await appendDeviceEvent(
				{
					ownerId,
					deviceId: String(approval.targetId),
					eventType: `approval.${decision}`,
					resourceId: approvalId,
					payload: { commandId: String(approval.crystal?.commandId || ''), status: decision },
					idempotencyKey: `approval:${approvalId}:${decision}`
				},
				session
			);
		});
	} catch (error: any) {
		if (error?.message !== 'approval_decision_race' && error?.message !== 'approval_command_race') throw error;
		const current = await things.findOne({ shareId: approvalId, thingtime: 'device-approval', ownerId } as any);
		if (current?.crystal?.status === decision) {
			return { ok: true, approval: publicApproval(current), idempotent: true };
		}
		if (current?.crystal?.status === 'pending') {
			await expirePendingApprovals(ownerId, String(approval.targetId));
		}
		return deviceFail(409, 'This approval changed, expired, or its command is no longer awaiting this decision');
	}
	return { ok: true, approval: publicApproval(updated), idempotent: false };
};

export const listNodeApprovalDecisions = async (ownerId: string, deviceId: string): Promise<{ ok: true; approvals: PublicDeviceApproval[] }> => {
	await expirePendingApprovals(ownerId, deviceId);
	const docs = await (
		await getHomeThingsCollection()
	)
		.find({
			thingtime: 'device-approval',
			ownerId,
			targetId: deviceId,
			'crystal.status': { $in: ['approved', 'denied', 'expired'] }
		} as any)
		.sort({ updatedAt: -1, shareId: 1 })
		.limit(MAX_APPROVALS_PAGE)
		.toArray();
	return { ok: true, approvals: docs.map(publicApproval) };
};
