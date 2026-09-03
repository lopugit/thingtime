// Pure, DOM-free core for the Lopu chat client (PRs/lopu-ai-assistant-design.md
// §2.3 event protocol, §3.1 streaming reducer): the client mirror of the
// NDJSON event union, the streaming-turn reducer, tool labels + links, the
// tiny markdown-ish parser the bubbles draw with, and the optimistic message
// builders the store commits when a turn ends. No React, no fetch — every
// export unit-tests in Node (lopuTurnCore.test.ts).

import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import type { ChatMessage } from '~/components/Messenger/messengerTypes';

// ——— the wire protocol (client mirror of api/utils/lopu/chatEvents.ts) ——————

export type LopuProvider = 'claude' | 'openai' | 'test' | 'fallback';

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

// Deliberately tiny: paragraphs, bullet lists, fenced code, inline code, bold
// and italic. NO raw HTML ever — the renderer draws text nodes only, so a
// model that emits `<script>` shows the literal characters.
export type LopuInline = { kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'strong'; text: string } | { kind: 'em'; text: string };

export type LopuMdBlock =
	| { kind: 'paragraph'; inlines: LopuInline[] }
	| { kind: 'heading'; level: 1 | 2 | 3; inlines: LopuInline[] }
	| { kind: 'list'; ordered: boolean; items: LopuInline[][] }
	| { kind: 'code'; lang: string | null; text: string; open: boolean };

const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(__[^_\n]+__)|(_[^_\n]+_)/g;

export const parseLopuInlines = (text: string): LopuInline[] => {
	const out: LopuInline[] = [];
	let last = 0;
	const source = text || '';
	for (const match of source.matchAll(INLINE_PATTERN)) {
		const index = match.index ?? 0;
		if (index > last) out.push({ kind: 'text', text: source.slice(last, index) });
		const token = match[0];
		if (token.startsWith('`')) out.push({ kind: 'code', text: token.slice(1, -1) });
		else if (token.startsWith('**') || token.startsWith('__')) out.push({ kind: 'strong', text: token.slice(2, -2) });
		else out.push({ kind: 'em', text: token.slice(1, -1) });
		last = index + token.length;
	}
	if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
	return out;
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
