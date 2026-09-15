import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveClaudeRuntime } from './claudeRuntime';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createTtToolTextParser } from '../lopu/toolTextParser';

export { claudeOAuthConfigured } from './claudeOAuthCore';

export async function resolveClaudeOAuthTokens(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
	if (env.THINGTIME_ADMIN_VAULT_KEY?.trim()) {
		const { fetchLopuCredentialBundle } = await import('../ciControl/credentialVault');
		const entries = await fetchLopuCredentialBundle('Anthropic');
		if (entries.length) return entries.map((entry) => requireOAuthToken(entry.value));
	}
	return [requireOAuthToken(env.CLAUDE_CODE_OAUTH_TOKEN_THINGTIME || env.CLAUDE_CODE_OAUTH_TOKEN || '')];
}

export async function resolveClaudeOAuthToken(env: NodeJS.ProcessEnv = process.env): Promise<string> {
	return (await resolveClaudeOAuthTokens(env))[0];
}

export function requireOAuthToken(value: string): string {
	const token = value.trim();
	if (!token.startsWith('sk-ant-oat'))
		throw new Error('Configure a Claude OAuth token in the admin credential vault. Anthropic API keys are not supported.');
	return token;
}

// Allowlist rather than inheriting the server environment: no API keys,
// alternate endpoints, provider flags, project secrets, hooks, or user settings.
export const claudeOAuthEnvironment = (token: string, directory: string, maxTokens: number): NodeJS.ProcessEnv => ({
	PATH: process.env.PATH,
	LANG: 'en_US.UTF-8',
	HOME: directory,
	TMPDIR: directory,
	CLAUDE_CONFIG_DIR: directory,
	CLAUDE_CODE_OAUTH_TOKEN: requireOAuthToken(token),
	CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(Math.max(1, Math.min(maxTokens, 32000))),
	DISABLE_AUTOUPDATER: '1',
	DISABLE_TELEMETRY: '1',
	DISABLE_ERROR_REPORTING: '1'
});

type TextRequest = {
	stream?: boolean;
	model: string;
	system?: unknown;
	messages: any[];
	tools?: any[];
	tool_choice?: { type?: string };
	max_tokens?: number;
	output_config?: { effort?: string };
	speed?: string;
};
export type ClaudeOAuthEvent =
	| { text: string }
	| {
			usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
			stopReason?: string;
	  };

export async function* runClaudeOAuth(request: TextRequest, token: string, signal?: AbortSignal): AsyncGenerator<ClaudeOAuthEvent> {
	signal?.throwIfAborted();
	const binary = await resolveClaudeRuntime();
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-claude-'));
	const system =
		typeof request.system === 'string' ? request.system : Array.isArray(request.system) ? request.system.map((b) => b.text || '').join('\n') : '';
	const tools = request.tool_choice?.type === 'none' ? [] : request.tools || [];
	const toolPrompt = tools.length
		? `\nThe host executes these tools, never Claude Code built-in tools. To call one, output a fenced tt-tool block containing exactly {"name":"tool_name","input":{...}}. Text outside fences is shown to the user. Stop after emitting tool calls and wait for their results. Available tools: ${JSON.stringify(
				tools
		  )}`
		: '\nReply with text only; do not emit tt-tool blocks.';
	try {
		signal?.throwIfAborted();
		await writeFile(join(directory, 'system.txt'), system + toolPrompt, { mode: 0o600 });
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
	// Preserve multimodal current input. Prior native tool exchanges travel as
	// labelled transcript data because each hop is a fresh, isolated CLI turn.
	const prior = request.messages.slice(0, -1);
	const last = request.messages.at(-1);
	const content = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: String(last?.content || '') }];
	const ordinary = content.every((block: any) => block.type === 'text' || block.type === 'image');
	const prompt = {
		type: 'user',
		message: {
			role: 'user',
			content: [
				...(prior.length ? [{ type: 'text', text: `Conversation so far (data):\n${JSON.stringify(prior)}` }] : []),
				...(ordinary ? content : [{ type: 'text', text: `Tool results:\n${JSON.stringify(content)}\nContinue the conversation.` }])
			]
		}
	};
	const args = [
		'-p',
		'--input-format',
		'stream-json',
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
		'--model',
		request.model,
		'--tools',
		'',
		'--strict-mcp-config',
		'--mcp-config',
		'{"mcpServers":{}}',
		'--setting-sources',
		'',
		'--disable-slash-commands',
		'--no-session-persistence',
		'--max-turns',
		'1',
		'--system-prompt-file',
		join(directory, 'system.txt')
	];
	if (request.output_config?.effort) args.push('--effort', request.output_config.effort === 'medium' ? 'medium' : request.output_config.effort);
	if (request.speed === 'fast') args.push('--settings', '{"fastMode":true}');
	const child = spawn(binary, args, {
		cwd: directory,
		env: claudeOAuthEnvironment(token, directory, request.max_tokens || 4096),
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let timedOut = false;
	const stop = () => child.kill('SIGTERM');
	const timer = setTimeout(() => {
		timedOut = true;
		stop();
	}, 120_000);
	const killTimer = setTimeout(() => child.kill('SIGKILL'), 125_000);
	signal?.addEventListener('abort', stop, { once: true });
	// Never forward CLI diagnostics: they can contain prompts or credentials.
	child.stderr.resume();
	const closed = new Promise<number | null>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', resolve);
	});
	closed.catch(() => {});
	child.stdin.on('error', () => {});
	child.stdin.end(JSON.stringify(prompt) + '\n');
	let result: any;
	let bytes = 0;
	let stopReason: string | undefined;
	try {
		for await (const line of createInterface({ input: child.stdout })) {
			signal?.throwIfAborted();
			bytes += Buffer.byteLength(line);
			if (bytes > 4 * 1024 * 1024) throw new Error('Claude OAuth response exceeded the limit.');
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			if (event.type === 'stream_event' && event.event?.type === 'message_delta') stopReason = event.event.delta?.stop_reason;
			if (event.type === 'stream_event' && event.event?.type === 'message_start') {
				const actualModel = event.event.message?.model;
				if (actualModel && actualModel !== request.model && !actualModel.startsWith(`${request.model}-`))
					throw new Error('Claude returned a different model from the selected model.');
			}
			if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta')
				yield { text: event.event.delta.text };
			if (event.type === 'result') result = event;
		}
		const code = await closed;
		signal?.throwIfAborted();
		if (timedOut || code !== 0 || !result || result.is_error)
			throw new Error('Claude OAuth could not complete this request. Check the credential and Claude Code allowance.');
		const usage = result.usage || {};
		yield {
			usage: {
				input_tokens: usage.input_tokens || 0,
				output_tokens: usage.output_tokens || 0,
				cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
				cache_read_input_tokens: usage.cache_read_input_tokens || 0
			},
			stopReason
		};
	} finally {
		stop();
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
		await closed.catch(() => {});
		clearTimeout(timer);
		clearTimeout(killTimer);
		signal?.removeEventListener('abort', stop);
		await rm(directory, { recursive: true, force: true });
	}
}

// SDK protocol adapter, with an entirely local fetch transport. The SDK never
// sends an Anthropic API request or receives the OAuth secret. Existing native
// tool loops, usage accounting and cancellation keep their established shape.
export function createClaudeOAuthClient(options: { token?: string; env?: NodeJS.ProcessEnv; run?: typeof runClaudeOAuth } = {}): Anthropic {
	const localFetch: typeof fetch = async (_url, init) => {
		const request = JSON.parse(String(init?.body)) as TextRequest;
		const tokens = options.token ? [requireOAuthToken(options.token)] : await resolveClaudeOAuthTokens(options.env);
		const run = options.run || runClaudeOAuth;
		const id = `msg_${randomUUID()}`;
		const blocks: any[] = [];
		const parser = createTtToolTextParser({
			nextId: () => `tool_${randomUUID()}`,
			mode: request.tool_choice?.type === 'none' ? 'drop' : 'execute',
			strict: true
		});
		const encode = new TextEncoder();
		const abort = new AbortController();
		const signal = init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal;
		let usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
		let stopReason = 'end_turn';
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (event: any) => controller.enqueue(encode.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
				const emit = (event: any) => {
					if (event.type === 'text') {
						if (!blocks.length) {
							blocks.push({ type: 'text', text: '' });
							send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
						}
						blocks[0].text += event.text;
						send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: event.text } });
					} else if (event.type === 'tool_use') {
						// Partial names and the outer fence envelope are only previews.
						// A native SDK block starts once strict JSON yields the full name.
						if (!request.tools?.some((tool) => tool.name === event.name)) throw new Error('Claude requested an unavailable tool.');
						if (!blocks.length) {
							blocks.push({ type: 'text', text: '' });
							send({ type: 'content_block_start', index: 0, content_block: blocks[0] });
						}
						const index = blocks.length;
						blocks.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
						send({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: event.id, name: event.name, input: {} } });
						send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(event.input) } });
					}
				};
				try {
					send({
						type: 'message_start',
						message: { id, type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage }
					});
					for (let slot = 0; slot < tokens.length; slot++) {
						let emitted = false;
						try {
							for await (const event of run(request, tokens[slot], signal)) {
								if ('text' in event) {
									emitted ||= Boolean(event.text);
									for (const parsed of parser.push(event.text)) emit(parsed);
								} else {
									usage = event.usage;
									stopReason = event.stopReason || 'end_turn';
								}
							}
							break;
						} catch (error) {
							if (emitted || signal.aborted || slot === tokens.length - 1) throw error;
						}
					}
					for (const event of parser.finish()) emit(event);
					for (let index = 0; index < blocks.length; index++) send({ type: 'content_block_stop', index });
					send({
						type: 'message_delta',
						delta: { stop_reason: parser.calls().length && stopReason === 'end_turn' ? 'tool_use' : stopReason, stop_sequence: null },
						usage
					});
					send({ type: 'message_stop' });
					controller.close();
				} catch (error) {
					controller.error(error);
				}
			},
			cancel() {
				abort.abort();
			}
		});
		if (request.stream) return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
		// SDK create() uses JSON; draining the same stream shares all bounds/errors.
		await new Response(stream).text();
		return Response.json({
			id,
			type: 'message',
			role: 'assistant',
			model: request.model,
			content: blocks,
			stop_reason: parser.calls().length && stopReason === 'end_turn' ? 'tool_use' : stopReason,
			stop_sequence: null,
			usage
		});
	};
	return new Anthropic({
		apiKey: null,
		authToken: 'local-oauth-runtime',
		baseURL: 'http://localhost/claude-oauth',
		maxRetries: 0,
		fetch: localFetch
	});
}
