import { parseAiWaterfallConfig } from '../ai/waterfallConfig';
export const FEATURE_STACK_MAX_AI_ATTEMPTS = 32;
export const validateFeatureStackModels = (value: unknown) => {
	if (value == null) return null;
	const config = parseAiWaterfallConfig(value);
	if (config.entries.length > FEATURE_STACK_MAX_AI_ATTEMPTS) throw new TypeError('Choose up to 32 AI attempts for this stack.');
	return config;
};
