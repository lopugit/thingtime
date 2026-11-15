import type { SavedAiWaterfall } from '~/api/utils/ai/savedWaterfallCore';
import type { AiWaterfallConfig } from '~/api/utils/ai/waterfallConfig';

export const sameWaterfall = (left: AiWaterfallConfig | null, right: AiWaterfallConfig | null): boolean =>
	!!left &&
	!!right &&
	left.version === right.version &&
	left.entries.length === right.entries.length &&
	left.entries.every((entry, index) => {
		const other = right.entries[index];
		return entry.endpointId === other.endpointId && entry.modelId === other.modelId &&
			(entry.effort ?? null) === (other.effort ?? null) && entry.speed === other.speed;
	});

export const matchingSavedWaterfall = (value: AiWaterfallConfig | null, items: readonly SavedAiWaterfall[]) =>
	items.find((item) => sameWaterfall(value, item.config));
