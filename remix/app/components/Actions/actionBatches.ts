import { isSelectionKey } from './localUiAction';

export const ACTION_BATCH_ATTRIBUTE = 'data-tt-action-batch';

type ActionBatch = { input: string; size: number; selectionKey: string; context?: string | number };
type ActionResponse = { status?: unknown; result?: unknown; error?: unknown; [key: string]: unknown };
const MAX_REQUEST_BATCH = 1000;

export function readActionBatch(value: string): ActionBatch {
	const config = JSON.parse(value);
	if (!config || typeof config !== 'object' || Array.isArray(config) ||
		typeof config.input !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(config.input) ||
		['constructor', 'prototype', '__proto__'].includes(config.input) ||
		!isSelectionKey(config.selectionKey) ||
		(config.context !== undefined && !((typeof config.context === 'string' && config.context.trim()) || (typeof config.context === 'number' && Number.isFinite(config.context)))) ||
		!Number.isSafeInteger(config.size) || config.size < 1 || config.size > MAX_REQUEST_BATCH) {
		throw new Error('This button has an invalid Action batch configuration.');
	}
	return { input: config.input, size: config.size, selectionKey: config.selectionKey, context: config.context };
}

export async function runActionBatches(
	batch: ActionBatch,
	inputs: Record<string, unknown>,
	run: (chunk: Record<string, unknown>) => Promise<ActionResponse>
): Promise<ActionResponse> {
	const list = Object.prototype.hasOwnProperty.call(inputs, batch.input) ? inputs[batch.input] : undefined;
	if (!Array.isArray(list) || !list.length) throw new Error('Select at least one item before running this Action.');
	const snapshot = [...list];
	let completed = 0;
	let response: ActionResponse = {};
	while (completed < snapshot.length) {
		const slice = snapshot.slice(completed, completed + batch.size);
		try {
			response = await run({ ...inputs, [batch.input]: slice });
			if (response.status !== 'ok') throw new Error(typeof response.error === 'string' ? response.error : 'Action failed.');
		} catch (error) {
			const reason = error instanceof Error ? error.message : 'Action failed.';
			throw new Error(`Confirmed ${completed} of ${snapshot.length} selected items. Check the latest Action run before retrying. ${reason}`);
		}
		completed += slice.length;
	}
	const result = response.result && typeof response.result === 'object' && !Array.isArray(response.result) ? response.result : {};
	return { ...response, result: { ...result, message: `Processed ${completed} selected ${completed === 1 ? 'item' : 'items'}.`, batch: { completed, total: snapshot.length } } };
}
