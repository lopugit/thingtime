// Real LopuChatView + uploader + store; only HTTP/storage are synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { getLopuStoreSnapshot } from '../app/components/Lopu/lopuChatStore';
import { LopuDictationSettings } from '../app/components/Lopu/LopuDictationSettings';
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
				'api.lopu-chats-reply': { version: '1.15.0' },
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
    const [preferences, setPreferences] = React.useState({ hearMeOut: false, dictationSilenceSeconds: 5 });
    const [showSettings, setShowSettings] = React.useState(false);
    const [lastSetting, setLastSetting] = React.useState('');
    const setThingtime = React.useCallback((path: string, value: unknown) => { setLastSetting(`${path} = ${String(value)}`); setPreferences(previous => ({ ...previous, [path.split('.').at(-1)!]: value })); }, []);
    const [spokenReplies, setSpokenReplies] = React.useState(false);
    const [result, setResult] = React.useState('Ready');
    const [voiceMode, setVoiceMode] = React.useState(true);
    const [compact, setCompact] = React.useState(true);
    const [narrow, setNarrow] = React.useState(false);
    const run = async () => {
        try {
            setPreferences({ hearMeOut: true, dictationSilenceSeconds: 5 });
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
            setResult('PASS: live composer revisions; Hear me out does not auto-send; stop/resume; mode switch; error/retry; manual edits; cumulative browser results; recognizer restart; late callbacks fenced; explicit Send; rejected draft restored; retry once; spoken reply and cancellation without stalling Send.');
        } catch (error) { setResult('FAIL: ' + String(error)); } finally { setSpokenReplies(false); }
    };
    const runSilence = async () => {
        try {
            setResult('Running silence regression…');
            setPreferences({ hearMeOut: false, dictationSilenceSeconds: 5 });
            await until(() => !!field() && !field().disabled && !!mic());
            type('Typed prefix:'); await wait();
            mic().click(); await until(() => Recognition.instances.length > 0);
            const first = current(); first.emit('five seconds');
            await until(() => field().value === 'Typed prefix: five seconds');
            await wait(2200); assert(sendCount === 0 && !first.aborted, 'Sent or stopped before five seconds');
            first.emit('five seconds', true); // final repeats must not reset the window
            stage = 'five-second auto-send'; await until(() => !!reply);
            assert(first.aborted && sendCount === 1, 'Auto-send did not stop the mic exactly once');
            assert(reply!.body.message === 'Typed prefix: five seconds' || reply!.body.text === 'Typed prefix: five seconds', 'Auto-send lost the typed prefix');
            reply!.resolve(new Response('Synthetic rejection', { status: 503 })); reply = undefined;
            stage = 'restore auto-send rejection'; await until(() => field().value === 'Typed prefix: five seconds');
            setPreferences({ hearMeOut: false, dictationSilenceSeconds: 2 }); await wait();
            mic().click(); await until(() => current() !== first); current().emit('custom delay');
            await wait(1100); assert(sendCount === 1, 'Custom delay sent too soon');
            const beforeStop = current(); mic().click(); await wait(2300);
            assert(sendCount === 1 && beforeStop.aborted && field().value.endsWith('custom delay'), 'Stop sent or erased words');
            mic().click(); await until(() => current() !== beforeStop); current().emit('send this too');
            stage = 'custom auto-send'; await until(() => !!reply); assert(sendCount === 2, 'Custom silence did not send once');
            const expected = 'Typed prefix: five seconds custom delay send this too';
            assert(reply!.body.message === expected || reply!.body.text === expected, 'Resumed dictation sent the wrong draft');
            reply!.resolve(new Response('Synthetic rejection', { status: 503 })); reply = undefined;
            await until(() => field().value === expected);
            setPreferences({ hearMeOut: true, dictationSilenceSeconds: 2 }); await wait();
            const beforeHear = current(); mic().click(); await until(() => current() !== beforeHear);
            current().emit('hear me out'); await wait(10200);
            const prompt = () => { const el = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Send now?"]'); return el && getComputedStyle(el).visibility !== 'hidden' ? el : null; };
            assert(!!prompt() && sendCount === 2 && !current().aborted, 'Hear me out sent or stopped instead of asking');
            const keep = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Keep listening')!;
            keep.click(); stage = 'dismiss reminder'; await until(() => !prompt());
            await wait(10200); assert(!!prompt() && sendCount === 2, 'Reminder did not repeat');
            current().emit('hear me out with more detail'); stage = 'speech dismisses reminder'; await until(() => !prompt());
            await wait(10200); assert(!!prompt(), 'Prompt did not return after new silence');
            const promptSend = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Send now')!;
            const manualExpected = field().value; promptSend.click();
            stage = 'explicit prompt send'; await until(() => !!reply);
            assert(sendCount === 3 && current().aborted, 'Prompt send duplicated or kept the mic open');
            assert(reply!.body.message === manualExpected || reply!.body.text === manualExpected, 'Prompt sent an old draft');
            reply!.resolve(new Response('Synthetic rejection', { status: 503 })); reply = undefined;
            await until(() => field().value === manualExpected);
            setPreferences({ hearMeOut: false, dictationSilenceSeconds: 1 }); await wait();
            send().click(); stage = 'start a reply before dictating'; await until(() => !!reply);
            const finishWorking = accept(); await until(() => field().value === '' && getLopuStoreSnapshot().activeChatId === 'synthetic-chat' && !!document.querySelector('[data-streaming="true"]'));
            const beforeQueued = current(); mic().click(); await until(() => current() !== beforeQueued);
            current().emit('Dictated while Lopu works');
            stage = 'silence queues during a reply'; await until(() => current().aborted && field().value === '');
            assert(sendCount === 4, 'Silence bypassed the active reply queue');
            type('Fresh unsent draft'); await wait(); finishWorking();
            stage = 'queued voice delivery'; await until(() => !!reply);
            assert(sendCount === 5 && (reply!.body.message === 'Dictated while Lopu works' || reply!.body.text === 'Dictated while Lopu works'), 'Queued voice sent the wrong text');
            assert(field().value === 'Fresh unsent draft', 'Queued voice erased a newer draft');
            accept()();
            setResult('PASS: queue while replying preserves a newer draft; default five-second send; repeated final does not extend delay; custom delay; manual Stop cancels and preserves; rejected sends restore full draft; Hear me out never auto-sends; 10-second repeated prompt; speaking dismisses; explicit prompt sends once.');
        } catch (error) { setResult('FAIL: ' + String(error)); }
    };
    return <Box p={3}>
        <Button onClick={() => void run()}>Run dictation regression</Button>
        <Button onClick={() => void runSilence()}>Run silence regression</Button>
        <Button onClick={async () => {
            setShowSettings(false); setVoiceMode(true); setPreferences({ hearMeOut: true, dictationSilenceSeconds: 5 });
            setResult('Reminder preview — wait 10 seconds'); await wait();
            if (mic().getAttribute('data-phase') !== 'idle') mic().click();
            await wait(); mic().click(); await wait(); current().emit('Take your time. These words stay in the draft.');
        }}>Preview silence prompt</Button>
        <Button onClick={() => setShowSettings(value => !value)}>Toggle settings</Button>
        <Button onClick={() => setNarrow(value => !value)}>Toggle 390px width</Button>
        <Button onClick={() => setCompact(value => !value)}>Toggle page layout</Button>
        <Text role="status">{result}</Text>
        <Text fontSize="xs">{lastSetting}</Text>
        <Box width={narrow ? '390px' : '100%'} maxW="100%" height="calc(100dvh - 180px)" minH="400px" display="flex" border="1px solid #ddd">
            <ThingtimeContext.Provider value={{ Everything: { thingtime: { settings: { lopu: { ...preferences, spokenReplies } } }, loading: false, setThingtime } } as any}>
                {showSettings ? <Box p={3} width="100%"><Text fontWeight={600}>Voice transcription</Text><LopuDictationSettings renderRow={(label, control, hint) => <Box my={3}><Text>{label}</Text>{control}<Text fontSize="sm">{hint}</Text></Box>} /></Box> : <LopuVoiceSurface compact={compact} voiceMode={voiceMode} />}
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
