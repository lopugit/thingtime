import { getLibraryExample } from './catalog';
import { exampleSandbox } from './sandbox';
import { buildExampleRequest, parseExampleInput, readBoundedJson } from './request';
let started = false;
addEventListener('message', async (event) => {
	if (event.source !== parent || started || event.data?.type !== 'tt-library-start') return;
	const { exampleId, runId, input } = event.data;
	if (typeof exampleId !== 'string' || typeof runId !== 'string' || runId.length > 80) return;
	const example = getLibraryExample(exampleId);
	if (!example || example.request?.auth) return;
	started = true;
	const send = (ok: boolean, text: string) => parent.postMessage({ type: 'tt-library', runId, ok, text: text.slice(0, 65536) }, '*');
	try {
		const parsed = parseExampleInput(JSON.stringify(input));
		if (example.module) {
			const child = document.createElement('iframe');
			child.title = 'Isolated remote example';
			child.sandbox.add('allow-scripts');
			child.style.cssText = 'width:100%;height:340px;border:0';
			addEventListener('message', (message) => {
				if (
					message.source === child.contentWindow &&
					message.data?.type === 'tt-library' &&
					message.data.runId === runId &&
					typeof message.data.text === 'string'
				)
					send(message.data.ok === true, message.data.text);
			});
			child.srcdoc = exampleSandbox(example, parsed, runId);
			document.body.append(child);
		} else {
			const { url, headers } = buildExampleRequest(example, parsed);
			const value = await readBoundedJson(
				await fetch(url, { headers, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15000) })
			);
			send(true, JSON.stringify(value, null, 2));
		}
	} catch {
		send(false, 'The provider or remote module is unavailable. Check inputs, quota and browser access, then retry.');
	}
});
parent.postMessage({ type: 'tt-library-ready' }, '*');
