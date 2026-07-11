export type ThingtimeMutationDrainResult<State> = {
	state: State;
	applied: boolean;
};

/**
 * Drain a mutable FIFO against one evolving working snapshot. Updates added by
 * an apply callback are processed in the same batch, and a failed update does
 * not discard later independent work.
 */
export const drainThingtimeMutationQueue = <State, Update>(
	initialState: State,
	queue: Update[],
	apply: (state: State, update: Update) => State,
	onError?: (error: unknown, update: Update) => void
): ThingtimeMutationDrainResult<State> => {
	let state = initialState;
	let applied = false;

	while (queue.length > 0) {
		const update = queue.shift();
		if (update === undefined) continue;

		try {
			state = apply(state, update);
			applied = true;
		} catch (error) {
			onError?.(error, update);
		}
	}

	return { state, applied };
};
