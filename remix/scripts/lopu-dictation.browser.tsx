// Real LopuChatView + uploader + store; only HTTP/storage are synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { LopuVoiceSurface } from '../app/components/Lopu/LopuVoiceControls';

Object.defineProperty(window, 'SharedWorker', { value: undefined });
const tasks = new Map<string, any>();
let sendCount = 0;
const requests: string[] = [];
let stage = 'initial render';
let reply: { body: any; resolve: (response: Response) => void } | undefined;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input, init) => {
	const url = new URL(String(input), location.origin);
	const path = url.pathname;
    requests.push(path);
	const body = JSON.parse(String(init?.body || '{}'));
	if (path.includes('well-known'))
		return json({
			schemaVersion: 1,
			origin: location.origin,
			features: {
				'api.attachment-uploads': { version: '1.4.1' },
				'api.lopu-chats-reply': { version: '1.14.2' },
				'api.lopu-background-tasks': { version: '1.3.0' }
			}
		});
	if (path.endsWith('/ai/models'))
		return json({
			ok: true,
			models: [
				{
					id: 'synthetic-model',
					label: 'Synthetic model',
					provider: 'openai',
					enabled: true,
					available: true,
					isDefault: true,
					efforts: ['low'],
					speeds: ['normal']
				}
			],
			defaults: { model: 'synthetic-model', effort: 'low', speed: 'normal' },
			providers: { openai: { configured: true } }
		});
	if (path.endsWith('/lopu/account')) return json({ ok: true, account: { verified: true, requireVerification: true, balanceMicros: 100000000 } });
	if (path.endsWith('/lopu/chats/reply'))
		return new Promise<Response>((resolve) => {
            sendCount++;
			reply = { body, resolve };
		});
	if (path.endsWith('/lopu/tasks') && url.searchParams.has('id')) {
		const entry = tasks.get(url.searchParams.get('id')!);
		const offset = Number(url.searchParams.get('offset') || 0);
		return json({
			ownerId: 'synthetic-dictation-regression',
			task: entry.task,
			output: entry.output.slice(offset),
			offset: entry.output.length,
			length: entry.output.length
		});
	}
	return json({ ok: true, ownerId: 'synthetic-dictation-regression', chats: [], messages: [], tasks: [], things: [] });
};
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check: () => boolean) => {
	for (let n = 0; n < 200; n++) {
		if (check()) return;
		await wait();
	}
	throw Error('Timed out: ' + stage + '; requests: ' + requests.slice(-10).join(', '));
};
const assert = (ok: unknown, message: string) => {
	if (!ok) throw Error(message);
};
const field = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Message Lopu"]')!;
const type = (value: string) => {
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), value);
	field().dispatchEvent(new Event('input', { bubbles: true }));
};
const send = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Send"]')!;
const accept = () => {
	const pending = reply!;
	reply = undefined;
	const task = {
		id: pending.body.requestId,
		requestId: pending.body.requestId,
		status: 'running',
		responseStatus: 200,
		contentType: 'application/x-ndjson',
		chatId: 'synthetic-chat'
	};
	const entry = {
		task,
		output:
			JSON.stringify({ type: 'meta', chatId: 'synthetic-chat', userMessageId: `u-${pending.body.requestId}`, requestId: pending.body.requestId }) +
			'\n'
	};
	tasks.set(task.id, entry);
	pending.resolve(new Response(JSON.stringify({ task }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
	return () => {
        entry.output += JSON.stringify({ type: 'delta', text: 'Synthetic spoken reply' }) + '\n';
		entry.output += JSON.stringify({ type: 'done', assistantMessageId: `a-${pending.body.requestId}`, messages: [], stopReason: 'end_turn' }) + '\n';
		task.status = 'completed';
	};
};

class Recognition {
    static instances: Recognition[] = [];
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: (() => void) | null = null;
    aborted = false;
    start() { Recognition.instances.push(this); }
    abort() { this.aborted = true; }
    emit(text: string, final = false) { this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: final }] }); }
}
window.SpeechRecognition = Recognition;
const spoken: SpeechSynthesisUtterance[] = [];
Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance: SpeechSynthesisUtterance) { spoken.push(utterance); } } });
const mic = () => document.querySelector<HTMLButtonElement>('.lopuMicButton')!;
const current = () => Recognition.instances.at(-1)!;

function App() {
    const [spokenReplies, setSpokenReplies] = React.useState(false);
    const [result, setResult] = React.useState('Ready');
    const [voiceMode, setVoiceMode] = React.useState(true);
    const [compact, setCompact] = React.useState(true);
    const [narrow, setNarrow] = React.useState(false);
    const run = async () => {
        try {
            setSpokenReplies(true);
            await until(() => !!field() && !field().disabled && !!mic());
            type('Typed prefix:'); await wait();
            mic().click(); await until(() => Recognition.instances.length > 0);
            current().emit('hello'); await until(() => field().value === 'Typed prefix: hello');
            current().emit('hello world', true); await until(() => field().value === 'Typed prefix: hello world');
            assert(sendCount === 0, 'Final recognition sent without Send');
            assert(!document.querySelector('.lopuVoiceDeck')?.textContent?.includes('hello world'), 'Separate interim popup remains');
            const first = current(), late = first.onresult!;
            mic().click(); await until(() => first.aborted);
            late({ resultIndex: 0, results: [{ 0: { transcript: 'late stale result' }, isFinal: true }] });
            await wait(); assert(field().value === 'Typed prefix: hello world', 'Stopping erased or changed the partial');
            setVoiceMode(false); await until(() => !mic());
            assert(field().value === 'Typed prefix: hello world', 'Typing mode lost the draft');
            setVoiceMode(true); await until(() => !!mic());
            mic().click(); await until(() => current() !== first);
            current().emit('second phrase'); await until(() => field().value.endsWith(' second phrase'));
            const interrupted = current();
            interrupted.onerror?.({ error: 'service-unavailable', message: 'Synthetic capture failure' });
            await until(() => interrupted.aborted);
            assert(field().value === 'Typed prefix: hello world second phrase', 'Failure erased dictation');
            mic().click(); await until(() => current() !== interrupted);
            current().emit('third phrase'); await until(() => field().value.endsWith(' third phrase'));
            const editedCapture = current(), lateEdit = editedCapture.onresult!;
            type('Manually corrected'); await until(() => editedCapture.aborted);
            lateEdit({ resultIndex: 0, results: [{ 0: { transcript: 'overwrite manual edit' }, isFinal: true }] });
            await wait(); assert(field().value === 'Manually corrected', 'Late speech overwrote typing');
            mic().click(); await until(() => current() !== editedCapture);
            current().onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'first sentence' }, isFinal: true }, { 0: { transcript: 'second' }, isFinal: false }] });
            await until(() => field().value === 'Manually corrected first sentence second');
            current().onresult?.({ resultIndex: 1, results: [{ 0: { transcript: 'first sentence' }, isFinal: true }, { 0: { transcript: 'second sentence' }, isFinal: true }] });
            await until(() => field().value === 'Manually corrected first sentence second sentence');
            const ended = current(); ended.onend?.(); await until(() => current() !== ended);
            current().emit('after restart'); await until(() => field().value.endsWith(' after restart'));
            const expected = field().value, sendingCapture = current(), lateSend = sendingCapture.onresult!;
            stage = 'send draft'; send().click(); await until(() => !!reply);
            assert(sendingCapture.aborted && sendCount === 1, 'Explicit Send did not stop exactly one capture');
            assert(reply!.body.message === expected || reply!.body.text === expected, 'Send differs from the editable draft');
            lateSend({ resultIndex: 0, results: [{ 0: { transcript: 'refill sent draft' }, isFinal: true }] });
            await wait(); assert(field().value === '', 'Late speech refilled the sent draft');
            reply!.resolve(new Response('Synthetic rejection', { status: 503 })); reply = undefined;
            stage = 'restore rejected draft'; await until(() => field().value === expected && !send().disabled);
            stage = 'send draft'; send().click(); await until(() => !!reply);
            assert(sendCount === 2, 'Retry duplicated the send');
            const finish = accept(); finish();
            stage = 'accepted retry'; await until(() => !!send() && field().value === '');
            stage = 'spoken reply'; await until(() => spoken.length === 1);
            const beforeStop = Recognition.instances.length;
            mic().click(); await until(() => mic().getAttribute('data-phase') === 'idle');
            assert(Recognition.instances.length === beforeStop, 'Stop speaking started another microphone capture');
            type('Message after cancelling speech'); await wait();
            stage = 'send after speech cancellation'; send().click(); await until(() => !!reply);
            assert(sendCount === 3, 'Cancelling speech blocked or duplicated the next Send');
            setSpokenReplies(false); await wait();
            accept()(); await until(() => !!send() && field().value === '');
            type('Ready for another voice message.');
            setResult('PASS: live composer revisions; no popup or auto-send; stop/resume; mode switch; error/retry; manual edits; cumulative browser results; recognizer restart; late callbacks fenced; explicit Send; rejected draft restored; retry once; spoken reply and cancellation without stalling Send.');
        } catch (error) { setResult('FAIL: ' + String(error)); } finally { setSpokenReplies(false); }
    };
    return <Box p={3}>
        <Button onClick={() => void run()}>Run dictation regression</Button>
        <Button onClick={() => setNarrow(value => !value)}>Toggle 390px width</Button>
        <Button onClick={() => setCompact(value => !value)}>Toggle page layout</Button>
        <Text role="status">{result}</Text>
        <Box width={narrow ? '390px' : '100%'} maxW="100%" height="740px" display="flex" border="1px solid #ddd">
            <ThingtimeContext.Provider value={{ Everything: { thingtime: { settings: { lopu: { spokenReplies } } }, loading: false } } as any}>
                <LopuVoiceSurface compact={compact} voiceMode={voiceMode} />
            </ThingtimeContext.Provider>
        </Box>
    </Box>;
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '/',
		loader: () => ({
			user: {
				id: 'synthetic-dictation-regression',
				username: 'synthetic',
				privateUploadsEnabled: true,
				publicUploadsEnabled: true,
				storage: { remainingBytes: 10000000, status: 'ready' }
			}
		}),
		Component: App
	}
]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={router} />
	</ChakraProvider>
);
