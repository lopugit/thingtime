import React from 'react';
import { Badge, Box, Button, Flex, Select, Text, Textarea } from '@chakra-ui/react';
import { Play } from 'lucide-react';

import type { ApiEndpointDoc, ApiHttpMethod } from '~/docs/apiDocs';
import { CodeBlock } from './docsCode';

// "Run it ▶" — the live API playground (claude-todo/10 ⌨️). Every endpoint
// already self-describes; this panel makes test==live tangible: edit the JSON
// body/query seeded from the docs' own examples, run the request with the
// browser's real session cookie, read the pretty response + status + timing.
// No Postman.

const MAX_SHOWN_RESPONSE_CHARS = 20_000;

type RunResult = {
	status: number;
	ok: boolean;
	durationMs: number;
	bodyText: string;
	truncated: boolean;
};

const prettyMaybeJson = (text: string): string => {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
};

const seedFor = (doc: ApiEndpointDoc, method: ApiHttpMethod): { query: string; body: string } => {
	const example = doc.requestExamples.find((entry) => entry.method === method) || doc.requestExamples[0];
	return {
		query: example?.query ? JSON.stringify(example.query, null, 2) : '',
		body: example?.body !== undefined ? JSON.stringify(example.body, null, 2) : ''
	};
};

export function ApiPlayground({ doc }: { doc: ApiEndpointDoc }) {
	const [method, setMethod] = React.useState<ApiHttpMethod>(doc.methods[0]);
	const seeded = React.useMemo(() => seedFor(doc, method), [doc, method]);
	const [queryText, setQueryText] = React.useState(seeded.query);
	const [bodyText, setBodyText] = React.useState(seeded.body);
	const [inputError, setInputError] = React.useState<string | null>(null);
	const [running, setRunning] = React.useState(false);
	const [result, setResult] = React.useState<RunResult | null>(null);
	const [runError, setRunError] = React.useState<string | null>(null);

	// switching method re-seeds the editors from that method's example
	const lastMethodRef = React.useRef(method);
	React.useEffect(() => {
		if (lastMethodRef.current === method) return;
		lastMethodRef.current = method;
		const next = seedFor(doc, method);
		setQueryText(next.query);
		setBodyText(next.body);
		setInputError(null);
	}, [method, doc]);

	const run = React.useCallback(async () => {
		setInputError(null);
		setRunError(null);

		let url = doc.endpoint;
		const query = queryText.trim();
		if (query) {
			try {
				const parsed = JSON.parse(query);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
				const params = new URLSearchParams();
				for (const [key, value] of Object.entries(parsed)) params.set(key, String(value));
				const qs = params.toString();
				if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
			} catch {
				setInputError('Query must be a JSON object of key → value pairs');
				return;
			}
		}

		const init: RequestInit = { method, credentials: 'same-origin' };
		const body = bodyText.trim();
		if (method !== 'GET' && body) {
			try {
				init.body = JSON.stringify(JSON.parse(body));
				init.headers = { 'Content-Type': 'application/json' };
			} catch {
				setInputError('Body must be valid JSON');
				return;
			}
		}

		setRunning(true);
		setResult(null);
		const started = performance.now();
		try {
			const resp = await fetch(url, init);
			const text = await resp.text();
			const pretty = prettyMaybeJson(text);
			setResult({
				status: resp.status,
				ok: resp.ok,
				durationMs: Math.max(1, Math.round(performance.now() - started)),
				bodyText: pretty.slice(0, MAX_SHOWN_RESPONSE_CHARS),
				truncated: pretty.length > MAX_SHOWN_RESPONSE_CHARS
			});
		} catch {
			setRunError('The request could not be sent — are you offline?');
		} finally {
			setRunning(false);
		}
	}, [doc.endpoint, method, queryText, bodyText]);

	return (
		<Box
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			mt={6}
			overflow="hidden"
		>
			<Flex align="center" bg="var(--tt-surface-alt, #f5f5f7)" gap={2} px={4} py={2} wrap="wrap">
				<Text fontFamily="mono" fontSize="12px" fontWeight="800" letterSpacing="0.06em">
					RUN IT ▶
				</Text>
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs">
					live, with your session cookie
				</Text>
				<Flex align="center" gap={2} ml="auto">
					{doc.methods.length > 1 && (
						<Select
							aria-label="HTTP method"
							onChange={(e) => setMethod(e.target.value as ApiHttpMethod)}
							size="xs"
							value={method}
							width="auto"
						>
							{doc.methods.map((entry) => (
								<option key={entry} value={entry}>
									{entry}
								</option>
							))}
						</Select>
					)}
					<Button
						colorScheme="green"
						isLoading={running}
						leftIcon={<Play size={13} />}
						onClick={run}
						size="xs"
					>
						Run {method}
					</Button>
				</Flex>
			</Flex>

			<Box px={4} py={3}>
				{method !== 'GET' && (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" mb={2}>
						⚠️ {method} runs for real against your account — same as the app itself (test == live).
					</Text>
				)}

				<Flex direction={{ base: 'column', xl: 'row' }} gap={3}>
					<Box flex="1" minW={0}>
						<Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
							Query (JSON object)
						</Text>
						<Textarea
							fontFamily="mono"
							fontSize="12px"
							minH="72px"
							onChange={(e) => setQueryText(e.target.value)}
							placeholder="{}"
							value={queryText}
						/>
					</Box>
					{method !== 'GET' && (
						<Box flex="1" minW={0}>
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
								Body (JSON)
							</Text>
							<Textarea
								fontFamily="mono"
								fontSize="12px"
								minH="72px"
								onChange={(e) => setBodyText(e.target.value)}
								placeholder="{}"
								value={bodyText}
							/>
						</Box>
					)}
				</Flex>

				{inputError && (
					<Text color="var(--tt-danger, #d6455a)" fontSize="sm" mt={2}>
						{inputError}
					</Text>
				)}
				{runError && (
					<Text color="var(--tt-danger, #d6455a)" fontSize="sm" mt={2}>
						{runError}
					</Text>
				)}

				{result && (
					<Box mt={3}>
						<Flex align="center" gap={2} mb={2} wrap="wrap">
							<Badge colorScheme={result.status >= 400 ? 'red' : result.status >= 300 ? 'yellow' : 'green'}>
								HTTP {result.status}
							</Badge>
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
								{result.durationMs} ms
							</Text>
							{result.truncated && (
								<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs">
									response truncated to {MAX_SHOWN_RESPONSE_CHARS.toLocaleString()} chars
								</Text>
							)}
						</Flex>
						<CodeBlock language="json">{result.bodyText}</CodeBlock>
					</Box>
				)}
			</Box>
		</Box>
	);
}
