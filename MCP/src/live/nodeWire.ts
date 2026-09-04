export type RuntimeRequest = {
	id: string | number;
	method: string;
	params?: Record<string, unknown>;
};

export type RuntimeWire = 'json-rpc' | 'thingtime-node';

export const decodeRuntimeRequest = (line: string): { request: RuntimeRequest; wire: RuntimeWire } => {
	const value = JSON.parse(line) as Record<string, unknown>;
	if (value.type === 'command') {
		if (typeof value.id !== 'string' || !value.id || value.id.length > 512) throw new Error('Connector command id is invalid.');
		if (typeof value.operation !== 'string' || !value.operation || value.operation.length > 128) {
			throw new Error('Connector operation is invalid.');
		}
		const payload =
			value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) ? (value.payload as Record<string, unknown>) : {};
		return { request: { id: value.id, method: value.operation, params: payload }, wire: 'thingtime-node' };
	}
	if ((typeof value.id !== 'string' && typeof value.id !== 'number') || typeof value.method !== 'string') {
		throw new Error('Runtime request is invalid.');
	}
	return {
		request: {
			id: value.id,
			method: value.method,
			params: value.params && typeof value.params === 'object' && !Array.isArray(value.params) ? (value.params as Record<string, unknown>) : {}
		},
		wire: 'json-rpc'
	};
};

export const runtimeReply = (wire: RuntimeWire, id: string | number | null, result: unknown, error?: { code: string; message: string }) =>
	wire === 'thingtime-node'
		? error
			? { type: 'reply', id: String(id ?? ''), ok: false, error }
			: { type: 'reply', id: String(id ?? ''), ok: true, result }
		: error
		? { id, error }
		: { id, result };

export const runtimeEvent = (wire: RuntimeWire, event: unknown) =>
	wire === 'thingtime-node' ? { type: 'event', event: 'connector/event', payload: event } : { method: 'connector/event', params: event };
