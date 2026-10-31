// Portable selection only. Endpoint credentials/URLs are resolved by the caller.
export type AiWaterfallEntry = { endpointId: string; modelId: string; effort: string | null; speed: 'normal' | 'fast' };
export type AiWaterfallConfig = { version: 1; entries: AiWaterfallEntry[] };
export type AiWaterfallModel = { id: string; label: string; efforts: readonly string[]; speeds: readonly ('normal' | 'fast')[] };
export type AiWaterfallEndpoint = { id: string; label: string; models: readonly AiWaterfallModel[]; allowCustomModel?: boolean; hint?: string };
export const AI_WATERFALL_MAX_ENTRIES = 256;
export const parseAiWaterfallConfig = (value: unknown): AiWaterfallConfig => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Choose an AI waterfall.');
	const config = value as Record<string, unknown>;
	if (
		Object.keys(config).some((key) => !['version', 'entries'].includes(key)) ||
		config.version !== 1 ||
		!Array.isArray(config.entries) ||
		!config.entries.length ||
		config.entries.length > AI_WATERFALL_MAX_ENTRIES
	)
		throw new TypeError('Choose 1–256 AI attempts.');
	const entries = config.entries.map((raw): AiWaterfallEntry => {
		if (
			!raw ||
			typeof raw !== 'object' ||
			Array.isArray(raw) ||
			Object.keys(raw).some((key) => !['endpointId', 'modelId', 'effort', 'speed'].includes(key))
		)
			throw new TypeError('Invalid AI attempt.');
		if (
			typeof raw.endpointId !== 'string' ||
			!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,179}$/.test(raw.endpointId) ||
			typeof raw.modelId !== 'string' ||
			!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(raw.modelId) ||
			(raw.effort != null && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(raw.effort)) ||
			!['normal', 'fast'].includes(raw.speed)
		)
			throw new TypeError('Invalid AI model or endpoint.');
		return { endpointId: raw.endpointId, modelId: raw.modelId, effort: raw.effort ?? null, speed: raw.speed };
	});
	if (new Set(entries.map((entry) => JSON.stringify(entry))).size !== entries.length) throw new TypeError('Each AI attempt must be distinct.');
	return { version: 1, entries };
};
export const validateAiWaterfallSelection = (value: unknown, endpoints: readonly AiWaterfallEndpoint[]): AiWaterfallConfig => {
	const config = parseAiWaterfallConfig(value);
	for (const entry of config.entries) {
		const endpoint = endpoints.find((item) => item.id === entry.endpointId);
		if (!endpoint) throw new TypeError('Choose an available endpoint connection.');
		const model = endpoint.models.find((item) => item.id === entry.modelId);
		if (!model && !endpoint.allowCustomModel) throw new TypeError('Choose a model supported by this endpoint.');
		if (model && ((entry.effort && !model.efforts.includes(entry.effort)) || !model.speeds.includes(entry.speed)))
			throw new TypeError('This model does not support that effort or speed.');
	}
	return config;
};
export const moveAiWaterfallEntry = (entries: AiWaterfallEntry[], from: number, to: number) => {
	const next = [...entries];
	if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
	next.splice(to, 0, next.splice(from, 1)[0]);
	return next;
};
