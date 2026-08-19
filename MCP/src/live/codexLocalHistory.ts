import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import type { LiveSessionEntry, LiveSessionPage } from './types.js';

type ThreadRow = {
	id?: unknown;
	rollout_path?: unknown;
};

const DEFAULT_STATE_PATH = join(homedir(), '.codex', 'state_5.sqlite');
const DEFAULT_SESSION_ROOT = join(homedir(), '.codex', 'sessions');
const MAX_ENTRIES = 20_000;
const MAX_MESSAGE_CHARS = 256_000;
const MAX_OPAQUE_CHARS = 512;
export const CODEX_INTERNAL_CONTEXT_MARKER =
	/(?:<\s*\/?\s*(?:system-reminder|local-command-caveat|codex_internal_context|environment_context|recommended_plugins|permissions(?:\s+instructions)?|apps_instructions|plugins_instructions|skills_instructions|agent-instructions|instructions|memory(?:_summary)?|multi_agent_mode|oai-mem-citation)(?:\s|>)|^\s*#\s*AGENTS\.md instructions\b)/imu;
export const CODEX_INTERNAL_CONTEXT_STREAM_MARKER =
	/(?:system-reminder|local-command-caveat|codex_internal_context|environment_context|recommended_plugins|apps_instructions|plugins_instructions|skills_instructions|agent-instructions|memory_summary|multi_agent_mode|oai-mem-citation|AGENTS\.md\s+instructions)/imu;

const exists = async (path: string): Promise<boolean> =>
	stat(path)
		.then(() => true)
		.catch(() => false);

export const cleanCodexVisibleText = (value: string, maximumCharacters = MAX_MESSAGE_CHARS): string => {
	if (CODEX_INTERNAL_CONTEXT_MARKER.test(value) || CODEX_INTERNAL_CONTEXT_STREAM_MARKER.test(value)) return '';
	return value.trim().slice(0, maximumCharacters);
};

const messageText = (content: unknown, role: 'user' | 'assistant'): string => {
	if (!Array.isArray(content) || content.length === 0) return '';
	const allowed = role === 'user' ? new Set(['text', 'input_text']) : new Set(['text', 'output_text']);
	const parts: string[] = [];
	for (const value of content) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
		const part = value as Record<string, unknown>;
		if (typeof part.type !== 'string' || !allowed.has(part.type) || typeof part.text !== 'string') return '';
		if (CODEX_INTERNAL_CONTEXT_MARKER.test(part.text)) return '';
		parts.push(part.text);
	}
	return cleanCodexVisibleText(parts.join('\n\n'));
};

const opaque = (value: unknown, fallback: string): string =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_OPAQUE_CHARS && !/[\0\r\n]/u.test(value) ? value : fallback;

const safeRolloutPath = async (path: string, root: string): Promise<string | null> => {
	if (!isAbsolute(path)) return null;
	try {
		const [resolvedPath, resolvedRoot] = await Promise.all([realpath(path), realpath(root)]);
		const child = relative(resolvedRoot, resolvedPath);
		if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return null;
		return resolvedPath;
	} catch {
		return null;
	}
};

const cursorEnd = (cursor: string | null | undefined, total: number): number => {
	if (!cursor) return total;
	const match = /^local:(\d+)$/.exec(cursor);
	if (!match) throw new Error('The local history cursor is invalid.');
	return Math.min(Number.parseInt(match[1], 10), total);
};

export class CodexLocalHistory {
	constructor(private readonly statePath = DEFAULT_STATE_PATH, private readonly sessionRoot = DEFAULT_SESSION_ROOT) {}

	async read(request: { sessionId: string; cursor?: string | null; limit?: number }): Promise<LiveSessionPage | null> {
		if (!(await exists(this.statePath))) return null;
		const database = new DatabaseSync(this.statePath, { readOnly: true });
		let row: ThreadRow | undefined;
		try {
			row = database.prepare('SELECT id, rollout_path FROM threads WHERE id = ? LIMIT 1').get(request.sessionId) as ThreadRow | undefined;
		} finally {
			database.close();
		}
		const rawPath = typeof row?.rollout_path === 'string' ? row.rollout_path : '';
		const path = rawPath ? await safeRolloutPath(rawPath, this.sessionRoot) : null;
		if (!path) return null;

		const entries: LiveSessionEntry[] = [];
		const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
		let currentTurnId = 'local-turn-0';
		let index = 0;
		try {
			for await (const line of lines) {
				if (!line.trim()) continue;
				let record: Record<string, unknown>;
				try {
					const parsed = JSON.parse(line) as unknown;
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
					record = parsed as Record<string, unknown>;
				} catch {
					continue;
				}
				const payload =
					record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? (record.payload as Record<string, unknown>) : null;
				if (record.type === 'turn_context') {
					currentTurnId = opaque(payload?.turn_id, `local-turn-${index}`);
					continue;
				}
				if (record.type !== 'response_item' || payload?.type !== 'message') continue;
				const role = payload.role;
				if (role !== 'user' && role !== 'assistant') continue;
				const text = messageText(payload.content, role);
				if (!text) continue;
				entries.push({
					id: opaque(payload.id, `local-message-${index}`),
					turnId: currentTurnId,
					type: 'message',
					role,
					text,
					status: 'complete',
					observedAt: typeof record.timestamp === 'string' ? record.timestamp : null
				});
				index += 1;
				if (entries.length >= MAX_ENTRIES) break;
			}
		} finally {
			lines.close();
		}

		const limit = Math.min(Math.max(request.limit ?? 30, 1), 100);
		const end = cursorEnd(request.cursor, entries.length);
		const start = Math.max(0, end - limit);
		return {
			sessionId: request.sessionId,
			entries: entries.slice(start, end),
			nextCursor: start > 0 ? `local:${start}` : null,
			backwardsCursor: end < entries.length ? `local:${end}` : null,
			source: 'local-fallback'
		};
	}
}
