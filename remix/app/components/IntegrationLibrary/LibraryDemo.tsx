import { libraryBuilderHref, libraryExamplePageId } from '~/library/builderLinks';
import React from 'react';
import { validateSdkInput } from '~/library/sdkSandbox';
import { Box, Button, Flex, FormControl, FormLabel, Input, Text, Textarea } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { getLibraryExample, type LibraryExample } from '~/library/catalog';
import { buildExampleRequest, LIBRARY_REQUEST_REQUIREMENT, parseExampleInput } from '~/library/request';

export function LibraryDemo({ example, initialInput }: { example: LibraryExample; initialInput?: string }) {
	const user = useCurrentUser();
	const [input, setInput] = React.useState(initialInput || JSON.stringify(example.input, null, 2));
	const [apiKey, setApiKey] = React.useState('');
	const [showKey, setShowKey] = React.useState(false);
	const [result, setResult] = React.useState('');
	const [error, setError] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [frame, setFrame] = React.useState<{ id: string; input: Record<string, unknown>; browserKey?: string } | null>(null);
	const iframe = React.useRef<HTMLIFrameElement>(null);
	const controller = React.useRef<AbortController | null>(null);
	const active = React.useRef<string | null>(null);
	const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const finish = React.useCallback(() => {
		active.current = null;
		setBusy(false);
		if (timer.current) clearTimeout(timer.current);
	}, []);
	React.useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source === iframe.current?.contentWindow && event.data?.type === 'tt-library-ready' && frame && active.current === frame.id) {
				iframe.current?.contentWindow?.postMessage(
					{
						type: 'tt-library-start',
						runId: frame.id,
						exampleId: example.id,
						input: frame.input,
						...(example.sdk ? { browserKey: frame.browserKey } : {})
					},
					'*'
				);
				return;
			}
			if (
				event.source !== iframe.current?.contentWindow ||
				event.data?.type !== 'tt-library' ||
				event.data.runId !== active.current ||
				typeof event.data.text !== 'string'
			)
				return;
			if (event.data.ok === true) setResult(event.data.text.slice(0, 65536));
			else {
				setFrame(null);
				setError(
					example.sdk
						? 'The map SDK could not finish. Check API activation, billing, browser key restrictions and inputs, then retry.'
						: 'The remote demo failed or timed out. Check the inputs, then retry.'
				);
			}
			finish();
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [finish, frame, example.id, example.sdk]);
	React.useEffect(
		() => () => {
			controller.current?.abort();
			active.current = null;
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);
	React.useEffect(() => {
		setApiKey('');
		setShowKey(false);
		setResult('');
		setFrame(null);
		controller.current?.abort();
		finish();
	}, [user?.id, finish]);
	React.useEffect(() => {
		if (initialInput) setInput(initialInput);
	}, [initialInput]);
	const cancel = () => {
		controller.current?.abort();
		setFrame(null);
		finish();
	};
	const run = async () => {
		if (active.current) return;
		const id = crypto.randomUUID();
		active.current = id;
		setBusy(true);
		setError('');
		try {
			const parsed = parseExampleInput(input);
			if (example.module || example.sdk || !example.request?.auth) {
				if (example.sdk) validateSdkInput(example, parsed, apiKey.trim());
				setFrame({ id, input: parsed, ...(example.sdk ? { browserKey: apiKey.trim() } : {}) });
				timer.current = setTimeout(() => {
					if (active.current !== id) return;
					setFrame(null);
					setError('The demo timed out. Retry when the CDN is available.');
					finish();
				}, 25000);
				return;
			}
			controller.current = new AbortController();
			const signal = AbortSignal.any([controller.current.signal, AbortSignal.timeout(15000)]);
			let value: unknown;
			if (example.request?.auth) {
				// Validate before sending. The credential never enters an iframe, URL,
				// persisted Thing, request log, analytics event or generated source.
				buildExampleRequest(example, parsed, apiKey);
				if (!user?.id) throw new Error('Sign in to run an example with an API key.');
				await requireThingtimeCapability(...LIBRARY_REQUEST_REQUIREMENT);
				if (active.current !== id) return;
				const response = await fetch('/api/v1/library/request', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ exampleId: example.id, input: parsed, apiKey }),
					signal
				});
				const data = await response.json();
				if (!response.ok || !data.ok) throw new Error(data.error || 'API request failed.');
				value = data.result;
			}
			if (active.current === id) setResult(JSON.stringify(value, null, 2).slice(0, 65536));
		} catch (failure) {
			if (active.current === id)
				setError(
					failure instanceof Error && !/fetch|network|abort/i.test(failure.message)
						? failure.message
						: 'Request unavailable. The provider may be offline, rate limited, or disallow browser requests. Try again later.'
				);
		} finally {
			if (example.request?.auth && active.current === id) finish();
		}
		// Invalid package JSON fails before a frame is mounted.
		if (active.current === id) finish();
	};
	return (
		<Box minW={0} data-library-demo={example.id}>
			<FormControl>
				<FormLabel fontSize="sm" htmlFor={`input-${example.id}`}>
					Example inputs · JSON
				</FormLabel>
				<Textarea
					id={`input-${example.id}`}
					value={input}
					onChange={(event) => setInput(event.target.value)}
					spellCheck={false}
					rows={7}
					maxLength={16384}
					fontFamily="mono"
					fontSize="sm"
					bg="var(--tt-surface-raised, white)"
				/>
			</FormControl>
			{(example.request?.auth || example.sdk) && (
				<Box mt={4} p={4} border="1px solid var(--tt-border, #e5e5e9)" borderRadius="12px">
					<FormControl>
						<FormLabel htmlFor={`key-${example.id}`} fontSize="sm">
							{example.credentialLabel || `${example.provider} API key`} {example.provider === 'Stripe' ? '(test mode)' : ''}
						</FormLabel>
						<Flex gap={2}>
							<Input
								id={`key-${example.id}`}
								name="library-api-key"
								type={showKey ? 'text' : 'password'}
								value={apiKey}
								autoComplete="off"
								spellCheck={false}
								maxLength={4096}
								onChange={(event) => setApiKey(event.target.value)}
								placeholder="Enter your own key"
							/>
							<Button size="sm" onClick={() => setShowKey((x) => !x)} aria-pressed={showKey}>
								{showKey ? 'Hide' : 'Show'}
							</Button>
							<Button
								size="sm"
								onClick={() => {
									cancel();
									setApiKey('');
									setResult('');
									setError('');
								}}
							>
								Clear
							</Button>
						</Flex>
					</FormControl>
					<Text fontSize="xs" mt={2} color="var(--tt-muted, #73737d)">
						{example.sdk
							? 'This restricted browser key is sent directly to the map provider in an isolated frame. Never use a private server secret. Clear removes the map and key.'
							: 'Used for this request through Thingtime’s server. Kept only in this open demo; never saved with the example. Provider quotas may apply.'}
					</Text>
					<Flex gap={3} mt={2} flexWrap="wrap">
						<a href={example.sdk?.accountUrl || example.request?.accountUrl} target="_blank" rel="noreferrer">
							Get a key / account ↗
						</a>
						{!user?.id && !example.sdk && <Link to="/login">Sign in to run</Link>}
					</Flex>
				</Box>
			)}
			{example.setup && (
				<Text fontSize="sm" mt={3}>
					{example.setup}
				</Text>
			)}
			<Flex gap={2} my={4} alignItems="center" flexWrap="wrap">
				<Button
					colorScheme="gray"
					bg="var(--tt-ink, #18181b)"
					color="var(--tt-surface, white)"
					onClick={run}
					isDisabled={busy || (!!example.sdk && !apiKey.trim()) || (!!example.request?.auth && (!apiKey.trim() || !user?.id))}
				>
					{busy ? 'Running…' : example.module || example.sdk ? 'Load & run example' : 'Fetch live data'}
				</Button>
				{busy && <Button onClick={cancel}>Cancel</Button>}
				<Button
					variant="ghost"
					onClick={() => {
						cancel();
						setInput(JSON.stringify(example.input, null, 2));
						setResult('');
						setError('');
						setApiKey('');
					}}
				>
					Reset inputs
				</Button>
			</Flex>
			<Text fontSize="xs" color="var(--tt-muted, #73737d)" mb={3}>
				{example.sdk
					? `Loads ${example.provider} from its official SDK host only when you run it.`
					: example.module
					? `Loads ${example.provider} remotely from esm.sh only when you run it.`
					: `${example.request?.method || 'GET'} · ${new URL(example.request!.url).hostname} · read-only request`}
			</Text>
			{error && (
				<Text role="alert" color="red.600" fontSize="sm" mb={3}>
					{error}
				</Text>
			)}
			{frame && (
				<iframe
					key={frame.id}
					ref={iframe}
					title={`${example.title} preview`}
					sandbox="allow-scripts"
					referrerPolicy={example.sdk ? 'origin' : 'no-referrer'}
					src={example.sdk ? '/library/sdk.html' : '/library/sandbox.html'}
					style={{
						width: '100%',
						height: example.sdk ? 420 : example.visual ? 340 : 0,
						border: example.visual ? '1px solid #e5e5e9' : 'none',
						borderRadius: 12,
						display: example.visual ? 'block' : 'none'
					}}
				/>
			)}
			<Box mt={3}>
				<Text fontSize="xs" fontWeight={700} mb={2}>
					RESULT
				</Text>
				<Box
					as="pre"
					aria-live="polite"
					data-library-result
					p={4}
					borderRadius="12px"
					bg="var(--tt-surface-sunken, #f1f1f4)"
					fontSize="12px"
					maxH="360px"
					overflow="auto"
					whiteSpace="pre-wrap"
					overflowWrap="anywhere"
				>
					{result || 'Run the example to see real output here.'}
				</Box>
			</Box>
		</Box>
	);
}

// Saved markup can choose a curated example, never source, remote URLs or keys.
export default function EmbeddedLibraryExample({ exampleId, inputJson }: { exampleId?: unknown; inputJson?: unknown }) {
	const example = typeof exampleId === 'string' ? getLibraryExample(exampleId) : undefined;
	if (!example) return <Text>Choose a valid library example.</Text>;
	return (
		<Box p={3} minW={0} border="1px solid var(--tt-border, #e5e5e9)" borderRadius="12px">
			<Text fontWeight={700} mb={3}>
				{example.provider} · {example.title}
			</Text>
			<LibraryDemo
				key={`${example.id}:${typeof inputJson === 'string' ? inputJson : ''}`}
				example={example}
				initialInput={typeof inputJson === 'string' && inputJson.length <= 16384 ? inputJson : undefined}
			/>
			<Button
				as={Link}
				to={libraryBuilderHref(libraryExamplePageId(example.id))}
				variant="link"
				size="sm"
				mt={4}
				whiteSpace="normal"
				textAlign="left"
			>
				Open this example in Builder →
			</Button>
		</Box>
	);
}
