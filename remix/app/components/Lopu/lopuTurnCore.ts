// Pure, DOM-free core for the Lopu chat client (PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md
// §2.3 event protocol, §3.1 streaming reducer): the client mirror of the
// NDJSON event union, the streaming-turn reducer, tool labels + links, the
// tiny markdown-ish parser the bubbles draw with, and the optimistic message
// builders the store commits when a turn ends. No React, no fetch — every
// export unit-tests in Node (lopuTurnCore.test.ts).

import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import type { ChatMessage } from '~/components/Messenger/messengerTypes';

// ——— the wire protocol (client mirror of api/utils/lopu/chatEvents.ts) ——————

// 'vault' = one of the viewer's own Secure Vault providers (meta carries its
// providerLabel; the server never reveals the credential).
export type LopuProvider = 'claude' | 'openai' | 'test' | 'fallback' | 'vault';

export type LopuPatchTarget = 'active' | { id: string };

// §2.5 patch-op grammar (api/utils/lopu/pageOps.ts is the isomorphic authority)
export type LopuPageOp =
	| { op: 'insert'; containerId: string | null; index: number | 'end'; block: WebpageBlock }
	| { op: 'update'; id: string; patch: Partial<WebpageBlock> }
	| { op: 'replace'; id: string; block: WebpageBlock }
	| { op: 'remove'; id: string }
	| { op: 'move'; id: string; containerId: string | null; index: number }
	| { op: 'setBlocks'; blocks: WebpageBlock[] };

export type LopuThingLike = {
	id: string;
	thingtime?: string[];
	crystal?: Record<string, any> | null;
	updatedAt?: string;
	[key: string]: unknown;
};

export type LopuUsage = { inputTokens?: number; outputTokens?: number };

export type LopuTurnMeta = {
	chatId: string;
	userMessageId: string;
	requestId: string;
	model: string | null;
	effort: string | null;
	speed: string | null;
	provider: LopuProvider;
	label?: string | null;
	// a 'vault' turn names the viewer's provider (its display name + id)
	providerLabel?: string | null;
	providerId?: string | null;
};

export type LopuChatEvent =
	| ({ type: 'meta' } & LopuTurnMeta)
	| { type: 'delta'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool_use_start'; id: string; name: string }
	| { type: 'tool_input_delta'; id: string; name: string; partial: string }
	| { type: 'tool_use'; id: string; name: string; input: unknown }
	| { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; data?: unknown }
	| { type: 'patch'; id: string; target: LopuPatchTarget; ops: LopuPageOp[]; pageId?: string; persisted: boolean }
	| { type: 'thing'; id: string; kind: string; thing: LopuThingLike }
	| { type: 'navigate'; path: string }
	| { type: 'error'; message: string; retryable: boolean }
	| {
			type: 'done';
			assistantMessageId?: string | null;
			messages?: ChatMessage[];
			usage?: LopuUsage;
			stopReason?: string | null;
	  };

export const LOPU_EVENT_TYPES: ReadonlyArray<LopuChatEvent['type']> = [
	'meta',
	'delta',
	'thinking',
	'tool_use_start',
	'tool_input_delta',
	'tool_use',
	'tool_result',
	'patch',
	'thing',
	'navigate',
	'error',
	'done'
];

// A loose guard for lines coming off the wire: anything with a known `type`
// string is an event; unknown types are ignored by the reducer (forward
// compatible with new server events).
export const isLopuChatEvent = (value: unknown): value is LopuChatEvent =>
	!!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

// ——— turn state ————————————————————————————————————————————————————————————

export type LopuToolStatus = 'streaming' | 'running' | 'ok' | 'error';

export type LopuToolResult = { ok: boolean; summary: string; data?: unknown };

export type LopuPatchRecord = {
	id: string;
	target: LopuPatchTarget;
	ops: LopuPageOp[];
	pageId: string | null;
	persisted: boolean;
};

export type LopuThingRecord = { id: string; kind: string; thing: LopuThingLike };

export type LopuToolActivity = {
	id: string;
	name: string;
	status: LopuToolStatus;
	// the complete parsed input (tool_use) — null while streaming
	input: unknown;
	// the raw partial-JSON fragment accumulated from tool_input_delta events
	partialInput: string;
	result: LopuToolResult | null;
	patch: LopuPatchRecord | null;
	thing: LopuThingRecord | null;
	order: number;
};

// The assistant bubble interleaves prose and tool cards in stream order.
export type LopuTurnSegment = { kind: 'text'; text: string } | { kind: 'tool'; id: string };

export type LopuTurnStatus = 'streaming' | 'done' | 'error' | 'aborted';

export type LopuTurnState = {
	requestId: string;
	chatId: string | null;
	userMessageId: string;
	userText: string;
	startedAt: number;
	meta: LopuTurnMeta | null;
	text: string;
	thinking: string;
	segments: LopuTurnSegment[];
	tools: LopuToolActivity[];
	patches: LopuPatchRecord[];
	things: LopuThingRecord[];
	navigate: string | null;
	error: { message: string; retryable: boolean } | null;
	status: LopuTurnStatus;
	assistantMessageId: string | null;
	messages: ChatMessage[];
	usage: LopuUsage | null;
	stopReason: string | null;
	// bumps once per reduced event — cheap change detection for throttled paints
	sequence: number;
};

// The user row's id before `meta` names the persisted one — stable per turn
// so the optimistic bubble can be re-keyed in place.
export const pendingUserMessageId = (requestId: string): string => `pending-${requestId}`;

export const initialLopuTurn = (input: {
	requestId: string;
	chatId?: string | null;
	userText: string;
	startedAt?: number;
}): LopuTurnState => ({
	requestId: input.requestId,
	chatId: input.chatId ?? null,
	userMessageId: pendingUserMessageId(input.requestId),
	userText: input.userText,
	startedAt: input.startedAt ?? Date.now(),
	meta: null,
	text: '',
	thinking: '',
	segments: [],
	tools: [],
	patches: [],
	things: [],
	navigate: null,
	error: null,
	status: 'streaming',
	assistantMessageId: null,
	messages: [],
	usage: null,
	stopReason: null,
	sequence: 0
});

const bump = (state: LopuTurnState, patch: Partial<LopuTurnState>): LopuTurnState => ({
	...state,
	...patch,
	sequence: state.sequence + 1
});

const appendText = (segments: LopuTurnSegment[], text: string): LopuTurnSegment[] => {
	if (!text) return segments;
	const last = segments[segments.length - 1];
	if (last && last.kind === 'text') {
		return [...segments.slice(0, -1), { kind: 'text', text: last.text + text }];
	}
	return [...segments, { kind: 'text', text }];
};

const upsertTool = (
	tools: LopuToolActivity[],
	id: string,
	name: string,
	patch: (activity: LopuToolActivity) => LopuToolActivity
): LopuToolActivity[] => {
	const index = tools.findIndex((tool) => tool.id === id);
	if (index === -1) {
		const fresh: LopuToolActivity = {
			id,
			name,
			status: 'streaming',
			input: null,
			partialInput: '',
			result: null,
			patch: null,
			thing: null,
			order: tools.length
		};
		return [...tools, patch(fresh)];
	}
	const next = tools.slice();
	next[index] = patch(tools[index]);
	return next;
};

// The tool whose execution is in flight (or streamed most recently) — where
// an emitted patch/thing attaches when the event does not name a tool id we
// know (the executor emits patch/thing under the tool's own id, but a
// defensive fallback keeps the card wiring intact either way).
const activeToolIndex = (tools: LopuToolActivity[]): number => {
	for (let index = tools.length - 1; index >= 0; index -= 1) {
		if (tools[index].status === 'running' || tools[index].status === 'streaming') return index;
	}
	return tools.length - 1;
};

const attachToTool = (
	tools: LopuToolActivity[],
	id: string,
	patch: (activity: LopuToolActivity) => LopuToolActivity
): LopuToolActivity[] => {
	const byId = tools.findIndex((tool) => tool.id === id);
	const index = byId !== -1 ? byId : activeToolIndex(tools);
	if (index < 0) return tools;
	const next = tools.slice();
	next[index] = patch(tools[index]);
	return next;
};

/**
 * The pure streaming reducer: fold one NDJSON event into the turn. Never
 * throws; unknown event types leave the state untouched (aside from nothing —
 * not even the sequence bumps, so a noisy server can't force paints).
 */
export const reduceLopuTurn = (state: LopuTurnState, event: LopuChatEvent): LopuTurnState => {
	switch (event.type) {
		case 'meta': {
			const { type: _type, ...meta } = event;
			return bump(state, {
				meta,
				chatId: meta.chatId || state.chatId,
				userMessageId: meta.userMessageId || state.userMessageId
			});
		}
		case 'delta': {
			const text = typeof event.text === 'string' ? event.text : '';
			if (!text) return state;
			return bump(state, { text: state.text + text, segments: appendText(state.segments, text) });
		}
		case 'thinking': {
			const text = typeof event.text === 'string' ? event.text : '';
			if (!text) return state;
			return bump(state, { thinking: state.thinking + text });
		}
		case 'tool_use_start': {
			const known = state.tools.some((tool) => tool.id === event.id);
			return bump(state, {
				tools: upsertTool(state.tools, event.id, event.name, (tool) => ({ ...tool, name: event.name || tool.name, status: 'streaming' })),
				segments: known ? state.segments : [...state.segments, { kind: 'tool', id: event.id }]
			});
		}
		case 'tool_input_delta': {
			const partial = typeof event.partial === 'string' ? event.partial : '';
			const known = state.tools.some((tool) => tool.id === event.id);
			return bump(state, {
				tools: upsertTool(state.tools, event.id, event.name, (tool) => ({
					...tool,
					name: tool.name || event.name,
					status: tool.status === 'ok' || tool.status === 'error' ? tool.status : 'streaming',
					partialInput: tool.partialInput + partial
				})),
				segments: known ? state.segments : [...state.segments, { kind: 'tool', id: event.id }]
			});
		}
		case 'tool_use': {
			const known = state.tools.some((tool) => tool.id === event.id);
			return bump(state, {
				tools: upsertTool(state.tools, event.id, event.name, (tool) => ({
					...tool,
					name: event.name || tool.name,
					status: tool.status === 'ok' || tool.status === 'error' ? tool.status : 'running',
					input: event.input ?? tool.input
				})),
				segments: known ? state.segments : [...state.segments, { kind: 'tool', id: event.id }]
			});
		}
		case 'tool_result': {
			const known = state.tools.some((tool) => tool.id === event.id);
			const result: LopuToolResult = {
				ok: event.ok === true,
				summary: typeof event.summary === 'string' ? event.summary : '',
				...(event.data !== undefined ? { data: event.data } : {})
			};
			return bump(state, {
				tools: upsertTool(state.tools, event.id, event.name, (tool) => ({
					...tool,
					name: event.name || tool.name,
					status: result.ok ? 'ok' : 'error',
					result
				})),
				segments: known ? state.segments : [...state.segments, { kind: 'tool', id: event.id }]
			});
		}
		case 'patch': {
			const record: LopuPatchRecord = {
				id: event.id,
				target: event.target ?? 'active',
				ops: Array.isArray(event.ops) ? event.ops : [],
				pageId: typeof event.pageId === 'string' ? event.pageId : null,
				persisted: event.persisted === true
			};
			return bump(state, {
				patches: [...state.patches, record],
				tools: attachToTool(state.tools, event.id, (tool) => ({ ...tool, patch: record }))
			});
		}
		case 'thing': {
			if (!event.thing || typeof event.thing !== 'object') return state;
			const record: LopuThingRecord = { id: event.id, kind: event.kind, thing: event.thing };
			const things = state.things.some((entry) => entry.thing?.id === event.thing.id)
				? state.things.map((entry) => (entry.thing?.id === event.thing.id ? record : entry))
				: [...state.things, record];
			return bump(state, {
				things,
				tools: attachToTool(state.tools, event.id, (tool) => ({ ...tool, thing: record }))
			});
		}
		case 'navigate': {
			const path = typeof event.path === 'string' ? event.path : '';
			if (!isSiteRelativePath(path)) return state;
			return bump(state, { navigate: path });
		}
		case 'error': {
			return bump(state, {
				error: { message: typeof event.message === 'string' ? event.message : 'Lopu hit a snag', retryable: event.retryable === true },
				// an error event mid-stream is not the end of the turn — the server
				// still sends `done` after a final text hop; only a missing `done`
				// (see markLopuTurnFailed) ends it as failed
				tools: state.tools.map((tool) => (tool.status === 'streaming' || tool.status === 'running' ? { ...tool, status: 'error' } : tool))
			});
		}
		case 'done': {
			return bump(state, {
				status: 'done',
				assistantMessageId: typeof event.assistantMessageId === 'string' ? event.assistantMessageId : null,
				messages: Array.isArray(event.messages) ? event.messages : [],
				usage: event.usage && typeof event.usage === 'object' ? event.usage : null,
				stopReason: typeof event.stopReason === 'string' ? event.stopReason : null,
				tools: state.tools.map((tool) => (tool.status === 'streaming' || tool.status === 'running' ? { ...tool, status: 'error' } : tool))
			});
		}
		default:
			return state;
	}
};

/** The stream ended without `done` (network drop, non-OK response). */
export const markLopuTurnFailed = (state: LopuTurnState, message: string, retryable = true): LopuTurnState => {
	if (state.status !== 'streaming') return state;
	return bump(state, {
		status: 'error',
		error: state.error ?? { message, retryable },
		tools: state.tools.map((tool) => (tool.status === 'streaming' || tool.status === 'running' ? { ...tool, status: 'error' } : tool))
	});
};

/** The viewer pressed stop — keep what streamed, mark the rest as cut off. */
export const markLopuTurnAborted = (state: LopuTurnState): LopuTurnState => {
	if (state.status !== 'streaming') return state;
	return bump(state, {
		status: 'aborted',
		tools: state.tools.map((tool) => (tool.status === 'streaming' || tool.status === 'running' ? { ...tool, status: 'error' } : tool))
	});
};

export const isLopuTurnActive = (state: LopuTurnState | null | undefined): boolean => !!state && state.status === 'streaming';

// ——— navigation safety ——————————————————————————————————————————————————

// Only site-relative paths ever navigate (no protocol, no `//host`, no
// javascript:) — the server enforces the same rule on the `navigate` tool.
export const isSiteRelativePath = (path: string): boolean =>
	typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\s<>]/.test(path) && path.length <= 2048;

// ——— tool presentation ————————————————————————————————————————————————————

// present-tense (streaming/running) and past-tense (ok) labels per tool; the
// failure label is derived ("Couldn't …") so every tool reads consistently
const TOOL_LABELS: Record<string, [string, string]> = {
	search_things: ['Searching things', 'Searched things'],
	get_thing: ['Reading a thing', 'Read a thing'],
	list_my_things: ['Listing your things', 'Listed your things'],
	create_component: ['Building a component', 'Built a component'],
	update_component: ['Updating a component', 'Updated a component'],
	browse_components: ['Browsing components', 'Browsed components'],
	create_page: ['Creating a page', 'Created a page'],
	patch_page: ['Editing the page', 'Edited the page'],
	get_page: ['Reading the page', 'Read the page'],
	list_demos: ['Browsing demos', 'Browsed demos'],
	get_demo: ['Reading a demo', 'Read a demo'],
	create_action: ['Creating an action', 'Created an action'],
	run_action: ['Running an action', 'Ran an action'],
	list_actions: ['Listing your actions', 'Listed your actions'],
	install_suite: ['Installing a suite', 'Installed a suite'],
	create_schema: ['Creating a schema', 'Created a schema'],
	create_data: ['Saving data', 'Saved data'],
	update_thing: ['Updating a thing', 'Updated a thing'],
	delete_thing: ['Deleting a thing', 'Deleted a thing'],
	navigate: ['Opening a page', 'Opened a page']
};

const humanizeToolName = (name: string): string =>
	(name || 'tool')
		.replace(/[_-]+/g, ' ')
		.trim()
		.replace(/^\w/, (char) => char.toUpperCase());

export const toolLabel = (name: string, status: LopuToolStatus = 'running'): string => {
	const pair = TOOL_LABELS[name];
	const present = pair ? pair[0] : humanizeToolName(name);
	const past = pair ? pair[1] : humanizeToolName(name);
	if (status === 'ok') return past;
	if (status === 'error') return `Couldn't finish: ${present.replace(/^\w/, (char) => char.toLowerCase())}`;
	return present;
};

// Streaming tool inputs that LopuLivePreview can draw before the tool runs.
export const LIVE_PREVIEW_TOOLS: ReadonlySet<string> = new Set(['create_component', 'update_component', 'create_page', 'patch_page']);

export const TOOL_GLYPHS: Record<string, string> = {
	create_component: '🧩',
	update_component: '🧩',
	browse_components: '🧩',
	create_page: '📄',
	patch_page: '✏️',
	get_page: '📄',
	create_action: '⚡',
	run_action: '⚡',
	list_actions: '⚡',
	install_suite: '📦',
	create_schema: '🧬',
	create_data: '💎',
	search_things: '🔎',
	get_thing: '🔎',
	list_my_things: '🗂️',
	list_demos: '🎨',
	get_demo: '🎨',
	update_thing: '✏️',
	delete_thing: '🗑️',
	navigate: '🧭'
};

export const toolGlyph = (name: string): string => TOOL_GLYPHS[name] || '🔧';

export type LopuToolLink = { label: string; href: string };

const thingKind = (thing: LopuThingLike | null | undefined, fallback: string | null): string | null => {
	const declared = Array.isArray(thing?.thingtime) ? thing?.thingtime.find((kind) => typeof kind === 'string') : null;
	return declared || fallback;
};

const linkForThing = (thing: LopuThingLike | null | undefined, kind: string | null): LopuToolLink | null => {
	if (!thing || typeof thing.id !== 'string' || !thing.id) return null;
	const resolvedKind = thingKind(thing, kind);
	const crystal = thing.crystal || {};
	if (resolvedKind === 'webpage') {
		return { label: `Open ${crystal.name || 'the page'} in the builder`, href: `/builder?page=${encodeURIComponent(thing.id)}` };
	}
	if (resolvedKind === 'component') {
		const key = typeof crystal.componentKey === 'string' && crystal.componentKey ? crystal.componentKey : thing.id;
		return { label: `Open ${crystal.name || 'the component'}`, href: `/components/${encodeURIComponent(key)}` };
	}
	if (resolvedKind === 'action') {
		const key = typeof crystal.actionKey === 'string' && crystal.actionKey ? crystal.actionKey : thing.id;
		return { label: `Open ${crystal.name || 'the action'}`, href: `/actions/${encodeURIComponent(key)}` };
	}
	if (resolvedKind === 'schema') {
		return { label: `Open ${crystal.name || 'the schema'}`, href: `/schemas/${encodeURIComponent(thing.id)}` };
	}
	return { label: `Open ${crystal.name || 'the thing'}`, href: `/thing/${encodeURIComponent(thing.id)}` };
};

/**
 * Where a finished tool card links: the thing it created/updated, the page a
 * patch landed on, or a page named in the result data. Deduplicated by href.
 */
export const toolLinks = (activity: LopuToolActivity): LopuToolLink[] => {
	const links: LopuToolLink[] = [];
	const push = (link: LopuToolLink | null) => {
		if (link && !links.some((entry) => entry.href === link.href)) links.push(link);
	};
	push(linkForThing(activity.thing?.thing, activity.thing?.kind ?? null));
	if (activity.patch?.pageId) {
		push({ label: 'Open in the builder', href: `/builder?page=${encodeURIComponent(activity.patch.pageId)}` });
	}
	const data = activity.result?.data;
	if (data && typeof data === 'object') {
		const record = data as { thing?: LopuThingLike; pageId?: unknown; things?: unknown };
		if (record.thing && typeof record.thing === 'object') push(linkForThing(record.thing, null));
		if (typeof record.pageId === 'string' && record.pageId) {
			push({ label: 'Open in the builder', href: `/builder?page=${encodeURIComponent(record.pageId)}` });
		}
	}
	if (activity.name === 'navigate' && activity.input && typeof activity.input === 'object') {
		const path = (activity.input as { path?: unknown }).path;
		if (typeof path === 'string' && isSiteRelativePath(path)) push({ label: `Go to ${path}`, href: path });
	}
	return links;
};

// ——— chat titling ————————————————————————————————————————————————————————

export const LOPU_TITLE_MAX = 60;

/** A conversation title from its first message — one line, trimmed, capped. */
export const chatTitleFromText = (text: string): string => {
	const line = (text || '')
		.split('\n')
		.map((entry) => entry.trim())
		.find(Boolean);
	if (!line) return 'New chat';
	const collapsed = line.replace(/\s+/g, ' ');
	if (collapsed.length <= LOPU_TITLE_MAX) return collapsed;
	return `${collapsed.slice(0, LOPU_TITLE_MAX - 1).trimEnd()}…`;
};

// ——— markdown-ish rendering model ——————————————————————————————————————————

// Deliberately tiny: paragraphs, bullet lists, fenced code, inline code, bold,
// italic and `[label](/site-relative)` links. NO raw HTML ever — the renderer
// draws text nodes only, so a model that emits `<script>` shows the literal
// characters. A link that is not site-relative (another host, a scheme) is
// demoted to plain text "label (url)" — nothing ever leaves the site through
// a Lopu bubble.
export type LopuInline =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'strong'; text: string }
	| { kind: 'em'; text: string }
	| { kind: 'link'; text: string; href: string };

export type LopuMdBlock =
	| { kind: 'paragraph'; inlines: LopuInline[] }
	| { kind: 'heading'; level: 1 | 2 | 3; inlines: LopuInline[] }
	| { kind: 'list'; ordered: boolean; items: LopuInline[][] }
	| { kind: 'code'; lang: string | null; text: string; open: boolean };

// a link href may carry one level of parentheses ("/p?x=(1)", "javascript:alert(1)")
const INLINE_PATTERN = /(`[^`\n]+`)|(\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(__[^_\n]+__)|(_[^_\n]+_)/g;
const LINK_TOKEN = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/;

export const parseLopuInlines = (text: string): LopuInline[] => {
	const out: LopuInline[] = [];
	let last = 0;
	const source = text || '';
	for (const match of source.matchAll(INLINE_PATTERN)) {
		const index = match.index ?? 0;
		if (index > last) out.push({ kind: 'text', text: source.slice(last, index) });
		const token = match[0];
		if (token.startsWith('`')) out.push({ kind: 'code', text: token.slice(1, -1) });
		else if (token.startsWith('[')) {
			const link = LINK_TOKEN.exec(token);
			const label = link?.[1] ?? token;
			const href = link?.[2] ?? '';
			if (isSiteRelativePath(href)) out.push({ kind: 'link', text: label, href });
			else out.push({ kind: 'text', text: `${label} (${href})` });
		} else if (token.startsWith('**') || token.startsWith('__')) out.push({ kind: 'strong', text: token.slice(2, -2) });
		else out.push({ kind: 'em', text: token.slice(1, -1) });
		last = index + token.length;
	}
	if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
	return out;
};

// ——— code blocks: what the copy button copies and how the block is labelled ———

export type LopuCodeBlockInfo = {
	// the header label ("TS", "JSON", "CODE")
	label: string;
	// the exact text the copy button puts on the clipboard (no trailing newline)
	clipboardText: string;
	// copying makes sense only for a finished, non-empty block
	copyable: boolean;
	lines: number;
};

export const describeLopuCodeBlock = (block: Extract<LopuMdBlock, { kind: 'code' }>): LopuCodeBlockInfo => {
	const text = (block.text || '').replace(/\s+$/, '');
	const lang = (block.lang || '').trim();
	return {
		label: (lang || 'code').slice(0, 12).toUpperCase(),
		clipboardText: text,
		copyable: !block.open && text.length > 0,
		lines: text ? text.split('\n').length : 0
	};
};

const flushParagraph = (lines: string[], blocks: LopuMdBlock[]) => {
	const text = lines.join('\n').trim();
	if (text) blocks.push({ kind: 'paragraph', inlines: parseLopuInlines(text) });
	lines.length = 0;
};

/**
 * Parse assistant text into render blocks. Streaming-safe: an unterminated
 * fence renders as an open code block that keeps growing.
 */
export const parseLopuMarkdown = (text: string): LopuMdBlock[] => {
	const blocks: LopuMdBlock[] = [];
	const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
	let paragraph: string[] = [];
	let list: { ordered: boolean; items: LopuInline[][] } | null = null;
	const closeList = () => {
		if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
		list = null;
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const fence = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
		if (fence) {
			flushParagraph(paragraph, blocks);
			closeList();
			const code: string[] = [];
			let open = true;
			for (index += 1; index < lines.length; index += 1) {
				if (/^\s*```\s*$/.test(lines[index])) {
					open = false;
					break;
				}
				code.push(lines[index]);
			}
			blocks.push({ kind: 'code', lang: fence[1] || null, text: code.join('\n'), open });
			continue;
		}
		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			flushParagraph(paragraph, blocks);
			closeList();
			blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, inlines: parseLopuInlines(heading[2].trim()) });
			continue;
		}
		const bullet = /^\s*(?:[-*•]|(\d+)[.)])\s+(.+)$/.exec(line);
		if (bullet) {
			flushParagraph(paragraph, blocks);
			const ordered = bullet[1] !== undefined;
			if (!list || list.ordered !== ordered) {
				closeList();
				list = { ordered, items: [] };
			}
			list.items.push(parseLopuInlines(bullet[2].trim()));
			continue;
		}
		if (!line.trim()) {
			flushParagraph(paragraph, blocks);
			closeList();
			continue;
		}
		closeList();
		paragraph.push(line);
	}
	flushParagraph(paragraph, blocks);
	closeList();
	return blocks;
};

// ——— optimistic message builders ————————————————————————————————————————

export const LOPU_ASSISTANT_SOURCE = {
	access: 'lopu',
	provider: 'lopu',
	sourceId: 'lopu',
	label: 'Lopu',
	connector: 'thingtime',
	readOnly: true,
	role: 'assistant',
	authorName: 'Lopu'
} as const;

const baseMessage = (input: { id: string; chatId: string; authorId: string; text: string; createdAt: string }): ChatMessage => ({
	id: input.id,
	chatId: input.chatId,
	authorId: input.authorId,
	author: null,
	text: input.text,
	attachments: [],
	deleted: false,
	editedAt: null,
	threadRootId: null,
	replyToId: null,
	replyTo: null,
	systemType: null,
	systemMeta: null,
	reactionCounts: {},
	viewerReactions: [],
	threadCount: 0,
	threadLastAt: null,
	createdAt: input.createdAt
});

/** The viewer's row for a turn — id re-keys to the persisted one after `meta`. */
export const buildUserMessage = (turn: LopuTurnState, viewerId: string, chatId: string = turn.chatId || ''): ChatMessage =>
	baseMessage({
		id: turn.userMessageId,
		chatId,
		authorId: viewerId,
		text: turn.userText,
		createdAt: new Date(turn.startedAt).toISOString()
	});

/**
 * Lopu's rows for a finished turn: the server's persisted segments when
 * `done` carried them, else one optimistic row from what streamed (an aborted
 * or failed turn still shows the text that arrived, plus a short note).
 */
export const buildAssistantMessages = (turn: LopuTurnState, viewerId: string, now: number = Date.now()): ChatMessage[] => {
	if (turn.messages.length) return turn.messages;
	// nothing streamed → nothing to show (the toast already explained a failure)
	if (!turn.text.trim()) return [];
	const chatId = turn.chatId || '';
	const note =
		turn.status === 'aborted'
			? '\n\n_(stopped)_'
			: turn.status === 'error'
				? `\n\n_(${turn.error?.message || 'Lopu got cut off'})_`
				: '';
	const text = `${turn.text.trim()}${note}`.trim();
	if (!text) return [];
	const message = baseMessage({
		id: turn.assistantMessageId || `${turn.userMessageId}:assistant`,
		chatId,
		authorId: viewerId,
		text,
		createdAt: new Date(now).toISOString()
	});
	return [
		{
			...message,
			// flagged so a server page of messages replaces it instead of duplicating it
			systemMeta: { [LOPU_OPTIMISTIC_FLAG]: true },
			externalSource: LOPU_ASSISTANT_SOURCE as unknown as ChatMessage['externalSource']
		}
	];
};

export const LOPU_OPTIMISTIC_FLAG = 'lopuOptimistic';

export const isOptimisticLopuMessage = (message: Pick<ChatMessage, 'systemMeta'> | null | undefined): boolean =>
	!!message?.systemMeta && (message.systemMeta as Record<string, unknown>)[LOPU_OPTIMISTIC_FLAG] === true;

// ——— timeline ——————————————————————————————————————————————————————————————

export type LopuTimelineItem =
	| { kind: 'message'; message: ChatMessage; role: 'user' | 'assistant' }
	| { kind: 'turn'; turn: LopuTurnState };

/**
 * What the message list draws: persisted rows in order, with this session's
 * turns rendered as rich bubbles (tool cards, live previews) right after
 * their user row. A placed turn absorbs the Lopu rows that follow it — its
 * own persisted segments and any optimistic row — so a turn never shows
 * twice; a turn whose user row is not (yet) in the list is appended at the
 * end with its own optimistic user bubble. System rows are never drawn.
 */
export const buildLopuTimeline = (messages: ChatMessage[], turns: LopuTurnState[], viewerId: string): LopuTimelineItem[] => {
	const byUserMessageId = new Map<string, LopuTurnState>();
	for (const turn of turns) byUserMessageId.set(turn.userMessageId, turn);
	const placed = new Set<string>();
	const items: LopuTimelineItem[] = [];
	let absorbing = false;
	for (const message of messages) {
		if (message.systemType) continue;
		const assistant = isLopuAssistantMessage(message);
		if (assistant && absorbing) continue;
		absorbing = false;
		items.push({ kind: 'message', message, role: assistant ? 'assistant' : 'user' });
		const turn = byUserMessageId.get(message.id);
		if (turn && !assistant) {
			items.push({ kind: 'turn', turn });
			placed.add(turn.requestId);
			absorbing = true;
		}
	}
	for (const turn of turns) {
		if (placed.has(turn.requestId)) continue;
		items.push({ kind: 'message', message: buildUserMessage(turn, viewerId), role: 'user' });
		items.push({ kind: 'turn', turn });
	}
	return items;
};

/** Lopu's persisted rows carry the `lopu` external source with the assistant role. */
export const isLopuAssistantMessage = (message: Pick<ChatMessage, 'externalSource'> | null | undefined): boolean => {
	const source = message?.externalSource as { provider?: unknown; access?: unknown; role?: unknown } | null | undefined;
	if (!source || typeof source !== 'object') return false;
	return (source.provider === 'lopu' || source.access === 'lopu') && source.role === 'assistant';
};

// ——— persisted assistant meta (PublicChatMessage.lopu) ————————————————————

// What an assistant row remembers about the turn that produced it (design
// note §1.2: crystal.lopu projects onto the public message as `lopu`). Read
// defensively — older rows and user rows carry nothing.
export type LopuMessageToolCall = { name: string; ok: boolean; summary: string; thingId: string | null };

export type LopuMessageMeta = {
	role: 'user' | 'assistant' | null;
	model: string | null;
	effort: string | null;
	speed: string | null;
	provider: LopuProvider | null;
	providerLabel: string | null;
	toolCalls: LopuMessageToolCall[];
	stopReason: string | null;
	usage: LopuUsage | null;
};

const LOPU_PROVIDERS: ReadonlyArray<LopuProvider> = ['claude', 'openai', 'test', 'fallback', 'vault'];
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export const lopuMessageMeta = (message: unknown): LopuMessageMeta | null => {
	const raw = (message as { lopu?: unknown } | null | undefined)?.lopu;
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Record<string, unknown>;
	const calls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
	const toolCalls: LopuMessageToolCall[] = [];
	for (const call of calls) {
		if (!call || typeof call !== 'object') continue;
		const entry = call as Record<string, unknown>;
		if (typeof entry.name !== 'string' || !entry.name) continue;
		toolCalls.push({ name: entry.name, ok: entry.ok === true, summary: stringOrNull(entry.summary) ?? '', thingId: stringOrNull(entry.thingId) });
	}
	const provider = LOPU_PROVIDERS.includes(record.provider as LopuProvider) ? (record.provider as LopuProvider) : null;
	const usageRaw = record.usage && typeof record.usage === 'object' ? (record.usage as Record<string, unknown>) : null;
	return {
		role: record.role === 'assistant' || record.role === 'user' ? record.role : null,
		model: stringOrNull(record.model),
		effort: stringOrNull(record.effort),
		speed: stringOrNull(record.speed),
		provider,
		providerLabel: stringOrNull(record.providerLabel),
		toolCalls,
		stopReason: stringOrNull(record.stopReason),
		usage: usageRaw
			? {
					...(typeof usageRaw.inputTokens === 'number' ? { inputTokens: usageRaw.inputTokens } : {}),
					...(typeof usageRaw.outputTokens === 'number' ? { outputTokens: usageRaw.outputTokens } : {})
			  }
			: null
	};
};

// ——— provider / status copy ————————————————————————————————————————————————

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	claude: 'Claude',
	openai: 'ChatGPT',
	test: 'the test script',
	fallback: "Lopu's little book",
	vault: 'your provider'
};

const EFFORT_DISPLAY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
export const describeLopuEffortLabel = (effort: string | null | undefined): string => (effort ? EFFORT_DISPLAY[effort] || effort : '');

/** "via Claude Opus 5 · High · Fast" — the meta line under a turn (null when unknown). */
export const describeLopuTurnMeta = (meta: Pick<LopuTurnMeta, 'provider' | 'label' | 'model' | 'effort' | 'speed' | 'providerLabel'> | null | undefined): string | null => {
	if (!meta) return null;
	if (meta.provider === 'fallback') return `from ${PROVIDER_DISPLAY_NAMES.fallback}`;
	if (meta.provider === 'vault') {
		const bits = [meta.providerLabel || PROVIDER_DISPLAY_NAMES.vault];
		if (meta.model) bits.push(meta.model);
		return `via ${bits.join(' · ')}`;
	}
	const bits = [meta.label || meta.model || PROVIDER_DISPLAY_NAMES[meta.provider] || meta.provider];
	const effort = describeLopuEffortLabel(meta.effort);
	if (effort) bits.push(effort);
	if (meta.speed === 'fast') bits.push('Fast');
	return `via ${bits.join(' · ')}`;
};

export type LopuStatusInput = {
	// the composer's current choice
	model: string | null;
	effort: string | null;
	speed: string | null;
	providerId: string | null;
	// catalog rows (id → label) and the viewer's own providers (id → name)
	modelLabels: Record<string, string>;
	providerNames: Record<string, string>;
	streaming?: boolean;
	listening?: boolean;
};

/** The header's one-line status: "Listening…" / "Replying…" / "Claude Opus 5 · High · Fast" / "Acme proxy". */
export const describeLopuStatusLine = (input: LopuStatusInput): string => {
	if (input.listening) return 'Listening…';
	if (input.streaming) return 'Replying…';
	if (input.providerId) return input.providerNames[input.providerId] || 'Your provider';
	if (!input.model) return Object.keys(input.modelLabels).length ? 'Choosing a model' : 'Ready';
	const bits = [input.modelLabels[input.model] || input.model];
	const effort = describeLopuEffortLabel(input.effort);
	if (effort) bits.push(effort);
	if (input.speed === 'fast') bits.push('Fast');
	return bits.join(' · ');
};

// ——— tool rows ————————————————————————————————————————————————————————————

export const LOPU_TOOL_SUMMARY_MAX = 140;
export const LOPU_TOOL_DETAILS_MAX_CHARS = 16_000;

/** The one-line summary a compact tool row shows (first line, capped). */
export const toolRowSummary = (activity: Pick<LopuToolActivity, 'status' | 'result' | 'name'>): string => {
	const raw = activity.result?.summary || '';
	const line = raw
		.split('\n')
		.map((entry) => entry.trim())
		.find(Boolean);
	if (line) return line.length > LOPU_TOOL_SUMMARY_MAX ? `${line.slice(0, LOPU_TOOL_SUMMARY_MAX - 1).trimEnd()}…` : line;
	if (activity.status === 'error') return 'This step did not finish.';
	return '';
};

const prettyJson = (value: unknown): string | null => {
	if (value === undefined || value === null) return null;
	let text: string;
	try {
		text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	} catch {
		return null;
	}
	if (!text) return null;
	return text.length > LOPU_TOOL_DETAILS_MAX_CHARS ? `${text.slice(0, LOPU_TOOL_DETAILS_MAX_CHARS)}\n… (truncated)` : text;
};

export type LopuToolDetails = { input: string | null; result: string | null; hasDetails: boolean };

/** What the expandable details drawer shows: the tool input (complete, else the partial fragment) and the result. */
export const toolRowDetails = (activity: Pick<LopuToolActivity, 'input' | 'partialInput' | 'result'>): LopuToolDetails => {
	const input = activity.input !== null && activity.input !== undefined ? prettyJson(activity.input) : prettyJson(activity.partialInput || null);
	const result = activity.result ? prettyJson({ ok: activity.result.ok, summary: activity.result.summary, ...(activity.result.data !== undefined ? { data: activity.result.data } : {}) }) : null;
	return { input, result, hasDetails: !!(input || result) };
};

// ——— timeline decoration (grouping + time separators) ———————————————————————

export type LopuTimelineRow = {
	item: LopuTimelineItem;
	role: 'user' | 'assistant';
	// the row's timestamp (ms) when known
	at: number | null;
	// first row of a same-author run (draws the avatar / the flattened corner)
	first: boolean;
	// last row of a same-author run (draws the meta line)
	last: boolean;
	// a time separator label to draw above this row, when the gap is large
	separator: string | null;
};

export const LOPU_GROUP_GAP_MS = 5 * 60_000;
export const LOPU_SEPARATOR_GAP_MS = 20 * 60_000;

export const timelineItemTime = (item: LopuTimelineItem): number | null => {
	if (item.kind === 'turn') return Number.isFinite(item.turn.startedAt) ? item.turn.startedAt : null;
	const at = Date.parse(item.message.createdAt);
	return Number.isFinite(at) ? at : null;
};

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today · 2:14 PM", "Yesterday · 9:03 AM", "Mon 3 Aug · 2:14 PM" (locale-aware time). */
export const formatLopuSeparator = (at: number, now: number = Date.now()): string => {
	const date = new Date(at);
	const today = new Date(now);
	const yesterday = new Date(now - 86_400_000);
	let day: string;
	if (sameDay(date, today)) day = 'Today';
	else if (sameDay(date, yesterday)) day = 'Yesterday';
	else {
		const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) };
		day = date.toLocaleDateString(undefined, options);
	}
	return `${day} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

/**
 * Decorate the timeline for drawing: consecutive rows by the same author
 * within LOPU_GROUP_GAP_MS form a group (avatar on the first, meta on the
 * last), and a gap over LOPU_SEPARATOR_GAP_MS (or a day change) gets a time
 * separator. Pure; `format` is injectable for tests.
 */
export const decorateLopuTimeline = (
	items: LopuTimelineItem[],
	options?: { now?: number; format?: (at: number, now: number) => string; groupGapMs?: number; separatorGapMs?: number }
): LopuTimelineRow[] => {
	const now = options?.now ?? Date.now();
	const format = options?.format ?? formatLopuSeparator;
	const groupGap = options?.groupGapMs ?? LOPU_GROUP_GAP_MS;
	const separatorGap = options?.separatorGapMs ?? LOPU_SEPARATOR_GAP_MS;
	const rows: LopuTimelineRow[] = [];
	let previous: LopuTimelineRow | null = null;
	let lastAt: number | null = null;
	for (const item of items) {
		const role: 'user' | 'assistant' = item.kind === 'turn' ? 'assistant' : item.role;
		const at = timelineItemTime(item);
		let separator: string | null = null;
		if (at !== null && (lastAt === null || at - lastAt > separatorGap || !sameDay(new Date(at), new Date(lastAt)))) separator = format(at, now);
		const continues = !!previous && previous.role === role && !separator && (at === null || lastAt === null || at - lastAt <= groupGap);
		const row: LopuTimelineRow = { item, role, at, first: !continues, last: true, separator };
		if (continues && previous) previous.last = false;
		rows.push(row);
		previous = row;
		if (at !== null) lastAt = at;
	}
	return rows;
};

/** Merge rows by id, keeping the incoming order for new ones (oldest first). */
export const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[], replaceIds: Record<string, string> = {}): ChatMessage[] => {
	const rekeyed = current.map((message) => (replaceIds[message.id] ? { ...message, id: replaceIds[message.id] } : message));
	const byId = new Map<string, ChatMessage>();
	for (const message of rekeyed) byId.set(message.id, message);
	for (const message of incoming) byId.set(message.id, { ...(byId.get(message.id) || {}), ...message });
	return [...byId.values()].sort((a, b) => {
		const at = Date.parse(a.createdAt) || 0;
		const bt = Date.parse(b.createdAt) || 0;
		if (at !== bt) return at - bt;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
};
