import { parseAlgorithmTransfer } from '../../api/utils/algorithms/algorithmTransferCore';
import type { TransferThing } from './format';

export const isTransferAlgorithm = (thing: Pick<TransferThing, 'thingtime'>) => thing.thingtime.length === 1 && thing.thingtime[0] === 'feed-algorithm';
export const validateTransferAlgorithm = (thing: TransferThing): void => {
	if (!isTransferAlgorithm(thing) || thing.targetId || thing.extended != null || thing.tags?.length) throw new Error('Algorithm transfers cannot contain child relationships or extra Thing fields');
	parseAlgorithmTransfer(thing.crystal);
};
export const algorithmTransferContent = (crystal: Record<string, unknown>) => parseAlgorithmTransfer({
	...(Object.prototype.hasOwnProperty.call(crystal, 'title') ? { title: crystal.title } : {}),
	name: crystal.name, emoji: crystal.emoji, weights: crystal.weights, eventCount: crystal.eventCount, lastTrainedAt: crystal.lastTrainedAt
});
