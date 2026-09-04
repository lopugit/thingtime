import type { DeviceCommandInputByKind, DeviceCommandStatus, DeviceConnectorSnapshot, DeviceDescriptor, DeviceStateSnapshot } from './deviceCore';
import type { PublicDevice } from './devices';
import type { NodeDeviceCommand, PublicDeviceApproval, PublicDeviceCommand } from './deviceCommands';
import type { PublicDeviceScreenSession } from './deviceScreens';

// Exported transport contract shared by the native HTTPS adapter, route tests,
// and generated API examples. Node credentials are generated locally and are
// intentionally absent from every response shape.
export type DevicePairingPrepareRequest = {
	op: 'prepare';
	pairingSecret: string;
	publicKey: string;
	nonce: string;
};

export type DevicePairingCompleteRequest = {
	op: 'complete';
	pairingSecret: string;
	credential: string;
	device: DeviceDescriptor;
	capabilities: string[];
	proof: {
		pairingId: string;
		publicKey: string;
		nonce: string;
		serverNonce: string;
		signature: string;
	};
};

export type DevicePairingClaimRequest = DevicePairingPrepareRequest | DevicePairingCompleteRequest;

export type DevicePairingClaimResponse =
	| {
			ok: true;
			op: 'prepare';
			proof: { pairingId: string; serverNonce: string; expiresAt: string };
	  }
	| {
			ok: true;
			device: PublicDevice;
			credentialStored: true;
	  };

export type DeviceNodeStateRequest = {
	revision: number;
	state: DeviceStateSnapshot;
	connectors: DeviceConnectorSnapshot[];
};

export type DeviceNodeStateResponse = {
	ok: true;
	revision: number;
	applied: boolean;
	stale: boolean;
};

export type DeviceNodeCommandRequest =
	| { op: 'claim'; waitMs?: number }
	| { op: 'heartbeat'; commandId: string; leaseId: string }
	| {
			op: 'report';
			commandId: string;
			leaseId: string;
			eventId: string;
			status: Exclude<DeviceCommandStatus, 'queued' | 'claimed'>;
			error?: string;
			outputRef?: string;
	  }
	| {
			op: 'approval-request';
			commandId: string;
			leaseId: string;
			requestId: string;
			kind: string;
			prompt: string;
			expiresAt?: string;
	  }
	| { op: 'approvals' }
	| { op: 'screen-status'; sessionId: string; eventId: string; status: PublicDeviceScreenSession['status']; error?: string };

export type DeviceNodeCommandResponse =
	| { ok: true; command: NodeDeviceCommand | null; serverTime: string }
	| { ok: true; leaseExpiresAt: string }
	| { ok: true; command: PublicDeviceCommand; idempotent: boolean }
	| { ok: true; approval: PublicDeviceApproval; idempotent: boolean }
	| { ok: true; approvals: PublicDeviceApproval[] }
	| { ok: true; session: PublicDeviceScreenSession; idempotent: boolean };

export { DEVICE_COMMAND_HEARTBEAT_INTERVAL_MS, DEVICE_COMMAND_LEASE_MS } from './deviceCommands';

export { DEVICE_PAIRING_PROOF_VERSION, canonicalDevicePairingClaimBytes } from './deviceAuth';

export type DeviceCreateCommandRequest<K extends keyof DeviceCommandInputByKind = keyof DeviceCommandInputByKind> = {
	deviceId: string;
	requestId: string;
	kind: K;
	input: DeviceCommandInputByKind[K];
	requiresApproval?: boolean;
};

export type {
	DeviceLiveConnectorEvent,
	DeviceLiveEventType,
	DeviceLiveItemActivityType,
	DeviceLiveMessageEnvelope,
	DeviceLiveSafeActivityItem,
	DeviceLiveSafeItem,
	DeviceLiveSafeTurn,
	DeviceLiveSafeVisibleItem,
	DeviceLiveSessionState,
	DeviceLiveSessionSummary,
	DeviceLiveTranscriptActivity,
	DeviceLiveTranscriptActivityType,
	DeviceLiveTranscriptEntry,
	DeviceLiveTranscriptMessage,
	DeviceLiveTranscriptPage,
	DeviceNodeLiveSyncRequest,
	DeviceNodeLiveSyncResponse
} from './deviceLiveAiCore';
