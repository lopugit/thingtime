import { sleep } from 'workflow';
import { runLopuPart, finishLopuWorkflow } from './continuationSteps.server';

export async function runLopuContinuation(rootId: string) {
	'use workflow';
	let previous: string | null = null;
	let failures = 0;
	try {
		for (;;) {
			const result = await runLopuPart(rootId, previous, failures);
			if (result.pending) {
				await sleep(result.delay);
				continue;
			}
			if (!result.next) {
				await finishLopuWorkflow(rootId, result.reason === 'completed' ? 'completed' : result.reason === 'stopped' ? 'stopped' : 'needs-attention');
				return;
			}
			failures = result.reason === 'error' ? failures + 1 : 0;
			previous = result.next;
			await sleep(result.delay);
		}
	} catch (error) {
		console.warn('[lopu] durable continuation failed:', error instanceof Error ? error.name : 'UnknownError');
		await finishLopuWorkflow(rootId, 'needs-attention');
	}
}
