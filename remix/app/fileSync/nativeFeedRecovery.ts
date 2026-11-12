import { SyncVolumeRemounted } from './syncConnectionWait';
import { NativeStreamingIndexInterrupted } from './streamingIndex';

/** A native feed supplies positive hints. A verified remount or validated
 * interrupted producer closes that old observation prefix; neither creates
 * a new cursor or discards an effect.
 * The existing consumer resolves receipts and guards pending operations before
 * normal sealed reconciliation can publish any whole-tree checkpoint. */
export async function* recoverRemountedNativeFeed<T>(
	source: AsyncIterable<T>,
	endForReconciliation: () => Promise<void>,
	signal: AbortSignal
): AsyncGenerator<T> {
	try {
		yield* source;
	} catch (error) {
		signal.throwIfAborted();
		if (!(error instanceof SyncVolumeRemounted || error instanceof NativeStreamingIndexInterrupted)) throw error;
		await endForReconciliation();
		signal.throwIfAborted();
	}
}
