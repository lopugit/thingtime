/// <reference lib="webworker" />
import { observeAiTask, type AiTaskRequest } from './aiTaskTransport';
// Every open page retains a port. Closing the submitting page does not stop
// its observer while another Thingtime page still owns this SharedWorker.
const scope = self as unknown as SharedWorkerGlobalScope;
scope.onconnect = (event) => {
	const port = event.ports[0];
	port.onmessage = async ({ data }: MessageEvent<{ id: string; input: AiTaskRequest }>) => {
		if (!data?.input || !data.id) return;
		const send = (frame: unknown) => {
			try {
				port.postMessage({ id: data.id, frame });
			} catch {
				/* owner closed its page */
			}
		};
		try {
			await observeAiTask(data.input, send);
		} catch (error) {
			send({ type: 'error', message: error instanceof Error ? error.message : 'Task connection interrupted.' });
		}
	};
	port.start();
};
