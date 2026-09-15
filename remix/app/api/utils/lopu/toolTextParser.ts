import { parsePartialJson } from '~/utils/partialJson';
import type { LopuProviderEvent } from './chatEvents';

export type TtToolTextParser = {
	push: (chunk: string) => LopuProviderEvent[];
	finish: () => LopuProviderEvent[];
	calls: () => Array<{ id: string; name: string; input: unknown }>;
	rawText: () => string;
};

const FENCE_OPEN = /```[ \t]*tt-tool[ \t]*\r?\n?/;
const FENCE_MARKERS = ['```tt-tool', '``` tt-tool'];

const partialMarkerSuffix = (buffer: string): number => {
	let longest = 0;
	for (const marker of FENCE_MARKERS) {
		const max = Math.min(marker.length - 1, buffer.length);
		for (let length = max; length > 0; length--) {
			if (marker.startsWith(buffer.slice(buffer.length - length))) {
				longest = Math.max(longest, length);
				break;
			}
		}
	}
	return longest;
};

export const createTtToolTextParser = (options: { nextId: () => string; mode: 'execute' | 'drop'; strict?: boolean }): TtToolTextParser => {
	let buffer = '';
	let raw = '';
	let state: 'text' | 'fence' = 'text';
	let body = '';
	let current: { id: string; name: string | null; started: boolean; inputEmitted: number } | null = null;
	const calls: Array<{ id: string; name: string; input: unknown }> = [];

	const inputSlice = (text: string): string => {
		const key = text.indexOf('"input"');
		if (key === -1) return '';
		const colon = text.indexOf(':', key + 7);
		return colon === -1 ? '' : text.slice(colon + 1);
	};

	const progress = (): LopuProviderEvent[] => {
		if (!current || options.mode === 'drop') return [];
		const out: LopuProviderEvent[] = [];
		if (!current.started) {
			const parsed = parsePartialJson(body);
			const name = parsed.value && typeof parsed.value === 'object' ? (parsed.value as any).name : null;
			if (typeof name === 'string' && name.trim()) {
				current.name = name.trim();
				current.started = true;
				out.push({ type: 'tool_use_start', id: current.id, name: current.name });
			}
		}
		if (current.started) {
			const input = inputSlice(body);
			if (input.length > current.inputEmitted) {
				out.push({ type: 'tool_input_delta', id: current.id, name: current.name!, partial: input.slice(current.inputEmitted) });
				current.inputEmitted = input.length;
			}
		}
		return out;
	};

	const closeFence = (): LopuProviderEvent[] => {
		const out: LopuProviderEvent[] = [];
		const call = current;
		current = null;
		state = 'text';
		if (!call) return out;
		if (options.mode === 'drop') {
			out.push({ type: 'text', text: '(tool call skipped — the tool budget for this turn is spent)' });
			body = '';
			return out;
		}
		if (options.strict) {
			try {
				JSON.parse(body);
			} catch {
				throw new Error('Claude returned incomplete tool arguments.');
			}
		}
		let parsed = parsePartialJson(body);
		// a fence body that arrived JSON-escaped ({\"name\":…} — the reply was a
		// JSON string literal on the wire) decodes to the real object
		if ((!parsed.value || typeof parsed.value !== 'object') && /\\"/.test(body)) {
			try {
				const decoded = JSON.parse(`"${body.replace(/\r?\n/g, '\\n')}"`);
				if (typeof decoded === 'string') parsed = parsePartialJson(decoded);
			} catch {
				// keep the original parse result
			}
		}
		const value = parsed.value && typeof parsed.value === 'object' ? (parsed.value as any) : {};
		// the documented shape is { name, input }; models on text-mode endpoints
		// also reach for OpenAI-ish spellings, so read those too
		const nameCandidate = [value.name, value.tool, value.tool_name, value.function?.name, value.function].find(
			(entry) => typeof entry === 'string' && entry.trim()
		);
		const name = typeof nameCandidate === 'string' ? nameCandidate.trim() : call.name || 'unknown_tool';
		const inputCandidate = [value.input, value.arguments, value.args, value.parameters, value.params, value.function?.arguments].find(
			(entry) => entry !== undefined && entry !== null
		);
		const input =
			inputCandidate && typeof inputCandidate === 'object'
				? inputCandidate
				: typeof inputCandidate === 'string'
				? (() => {
						const inner = parsePartialJson(inputCandidate).value;
						return inner && typeof inner === 'object' ? inner : {};
				  })()
				: {};
		if (!call.started) out.push({ type: 'tool_use_start', id: call.id, name });
		out.push({ type: 'tool_use', id: call.id, name, input });
		calls.push({ id: call.id, name, input });
		body = '';
		return out;
	};

	const push = (chunk: string): LopuProviderEvent[] => {
		raw += chunk;
		buffer += chunk;
		const out: LopuProviderEvent[] = [];
		for (;;) {
			if (state === 'text') {
				const match = FENCE_OPEN.exec(buffer);
				if (match) {
					const before = buffer.slice(0, match.index);
					if (before) out.push({ type: 'text', text: before });
					buffer = buffer.slice(match.index + match[0].length);
					state = 'fence';
					body = '';
					current = { id: options.nextId(), name: null, started: false, inputEmitted: 0 };
					continue;
				}
				const hold = partialMarkerSuffix(buffer);
				const emit = buffer.slice(0, buffer.length - hold);
				if (emit) out.push({ type: 'text', text: emit });
				buffer = buffer.slice(buffer.length - hold);
				return out;
			}
			const close = buffer.indexOf('```');
			if (close === -1) {
				// hold back a possible partial closing marker
				const hold = buffer.endsWith('``') ? 2 : buffer.endsWith('`') ? 1 : 0;
				body += buffer.slice(0, buffer.length - hold);
				buffer = buffer.slice(buffer.length - hold);
				out.push(...progress());
				return out;
			}
			body += buffer.slice(0, close);
			buffer = buffer.slice(close + 3);
			out.push(...progress());
			out.push(...closeFence());
		}
	};

	const finish = (): LopuProviderEvent[] => {
		const out: LopuProviderEvent[] = [];
		if (state === 'text') {
			if (buffer) out.push({ type: 'text', text: buffer });
			buffer = '';
			return out;
		}
		if (options.strict) throw new Error('Claude stopped before completing a tool call.');
		// the model was cut off inside a fence — close it with what we have
		body += buffer;
		buffer = '';
		out.push(...progress());
		out.push(...closeFence());
		return out;
	};

	return { push, finish, calls: () => [...calls], rawText: () => raw };
};
