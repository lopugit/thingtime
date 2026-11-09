import { capabilitySatisfies } from '../../api/utils/capabilities/capabilityContract';
import type { ThingtimeBridgeMessage, ThingtimeNativeBridge } from '../../utils/nativeBridge';

export const LIDAR_SCAN_CAPABILITY = 'lidar.scan';

export type LidarScanAction = 'status' | 'start' | 'retry' | 'suspend';
export type LidarScanState = 'idle' | 'capturing' | 'saving' | 'saved' | 'pending' | 'cancelled' | 'error';
export type LidarScanScope = { ownerId: string; origin: string };
type Request = LidarScanScope & { requestId: string; action: LidarScanAction; scanId?: string };
type Result = { state: LidarScanState; supported: boolean; scanId?: string; fileThingId?: string; error?: string; isPartial?: boolean; detail?: string };

const states: readonly LidarScanState[] = ['idle', 'capturing', 'saving', 'saved', 'pending', 'cancelled', 'error'];
const uuid = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export function supportsLidarScan(bridge?: ThingtimeNativeBridge): bridge is ThingtimeNativeBridge & { platform: 'ios'; lidarVersion: string } {
	return Boolean(bridge?.isNativeWebView && bridge.platform === 'ios' && capabilitySatisfies(bridge.lidarVersion ?? '', '1.0.0'));
}

export function isLidarScanInput(input: Record<string, unknown>): boolean {
	return input.op === 'native' && input.capability === LIDAR_SCAN_CAPABILITY && Object.keys(input).length === 2;
}

export function lidarAppLink(origin: string, userAgent: string, platform: string, touchPoints: number): string | null {
	if (!/iPad|iPhone/i.test(userAgent) && !(platform === 'MacIntel' && touchPoints > 1)) return null;
	try {
		const url = new URL(origin);
		if (url.protocol !== 'https:' || url.origin !== origin) return null;
		return `thingtime://scan/lidar?${new URLSearchParams({ origin })}`;
	} catch { return null; }
}

function parseResult(value: unknown, request: Request): Result | null {
	if (!value || typeof value !== 'object') return null;
	const { type, payload } = value as { type?: unknown; payload?: Record<string, unknown> };
	if (type !== 'lidar-scan-result' || !payload || payload.requestId !== request.requestId ||
		payload.ownerId !== request.ownerId || payload.origin !== request.origin || typeof payload.supported !== 'boolean') return null;
	const { state, supported, scanId, fileThingId, error, isPartial, detail } = payload;
	if (!states.includes(state as LidarScanState) || (scanId !== undefined && !uuid(scanId)) ||
		((state === 'pending' || state === 'saved') && !uuid(scanId)) ||
		(state === 'saved' && !uuid(fileThingId)) ||
		(!supported && state !== 'idle' && state !== 'error')) return null;
	// A replay must refer to the exact retained archive. No path, URL or bytes
	// from the host become part of the browser view.
	const expectedScan = request.action === 'start' ? request.requestId : request.scanId;
	if (expectedScan && uuid(scanId) && scanId.toLowerCase() !== expectedScan.toLowerCase()) return null;
	return {
		state: state as LidarScanState, supported,
		...(uuid(scanId) ? { scanId: scanId.toLowerCase() } : {}),
		...(state === 'saved' && uuid(fileThingId) ? { fileThingId: fileThingId.toLowerCase() } : {}),
		...(typeof error === 'string' && (state === 'pending' || state === 'error') ? { error: error.slice(0, 240) } : {}),
		...(isPartial === true && (state === 'saved' || state === 'pending') ?
			{ isPartial: true, ...(typeof detail === 'string' ? { detail: detail.slice(0, 240) } : {}) } : {})
	};
}

export type LidarScanSnapshot = { waiting?: LidarScanAction; result?: Result; connectionError?: string };

export function createLidarScanClient(options: {
	scope: LidarScanScope;
	send: (message: ThingtimeBridgeMessage) => void;
	isCurrent: () => boolean;
	update: (snapshot: LidarScanSnapshot) => void;
	newId: () => string;
}) {
	let active: Request | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let snapshot: LidarScanSnapshot = {};
	let closed = false;
	const update = (next: LidarScanSnapshot) => { snapshot = next; options.update(next); };
	const send = (payload: Request) => options.send({ type: 'lidar-scan', payload });
	const finishRequest = () => { clearTimeout(timer); active = undefined; };
	const fail = () => {
		finishRequest();
		if (!closed && options.isCurrent()) update({ ...snapshot, waiting: undefined, connectionError: 'The scanner did not respond. Check its status to reconnect.' });
	};
	const request = (action: Exclude<LidarScanAction, 'suspend'>): boolean => {
		if (closed || active || !options.isCurrent()) return false;
		const result = snapshot.result;
		if (action !== 'status' && (!result?.supported || snapshot.connectionError)) return false;
		if (action === 'start' && result?.state === 'pending') return false;
		if (action === 'retry' && (result?.state !== 'pending' || !result.scanId)) return false;
		active = {
			...options.scope, requestId: options.newId(), action,
			...(action === 'retry' && result?.scanId ? { scanId: result.scanId } : {})
		};
		update({ ...snapshot, waiting: action, connectionError: undefined });
		timer = setTimeout(fail, 20_000);
		try { send(active); } catch { fail(); return false; }
		return true;
	};
	return {
		request,
		refresh(): boolean {
			if (closed || !options.isCurrent()) return false;
			// A resumed WebView may outlive the native operation. Replace
			// only its observation and fence out the previous request ID.
			finishRequest();
			return request('status');
		},
		receive(value: unknown): boolean {
			if (closed || !active || !options.isCurrent()) return false;
			const result = parseResult(value, active);
			if (!result) return false;
			const previous = snapshot.waiting ? undefined : snapshot.result;
			if (previous?.scanId && result.scanId && previous.scanId !== result.scanId) return false;
			if (previous?.state === 'saving' && result.state === 'capturing') return false;
			if (previous?.state === 'saving' && result.state === 'saving' && previous.scanId === result.scanId) return true;
			clearTimeout(timer);
			if (result.state !== 'capturing' && result.state !== 'saving') finishRequest();
			update({ result });
			return true;
		},
		close(suspend: boolean) {
			if (closed) return;
			closed = true;
			finishRequest();
			if (suspend) {
				try { send({ ...options.scope, requestId: options.newId(), action: 'suspend' }); }
				catch { /* Native frame and account checks also retire the scope. */ }
			}
		}
	};
}
