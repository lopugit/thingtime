import { parseAiWaterfallConfig, type AiWaterfallConfig } from './waterfallConfig';
export const AI_WATERFALL_SYSTEM_TYPE = 'ai-waterfall-v1';
export type SavedAiWaterfall = { id: string; name: string; config: AiWaterfallConfig; updatedAt: string };
export const parseSavedWaterfallInput = (value: unknown) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid waterfall.');
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some((key) => !['id', 'name', 'config', 'updatedAt'].includes(key))) throw new TypeError('Unexpected waterfall fields.');
	if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.name))
		throw new TypeError('Choose a name of up to 80 characters.');
	if (input.id !== undefined && (typeof input.id !== 'string' || !/^ai-waterfall-[0-9a-f-]{36}$/.test(input.id)))
		throw new TypeError('Invalid saved waterfall.');
	if (input.id && (typeof input.updatedAt !== 'string' || Number.isNaN(Date.parse(input.updatedAt))))
		throw new TypeError('Reload the saved waterfall before updating it.');
	return {
		id: input.id as string | undefined,
		name: input.name.trim(),
		config: parseAiWaterfallConfig(input.config),
		updatedAt: input.updatedAt as string | undefined
	};
};
