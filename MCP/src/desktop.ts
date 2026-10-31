import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import { importArchiveBytes } from './importer.js';
import type { Conversation, Message, Snapshot } from './model.js';

export type DesktopSourceId = 'chatgpt' | 'claude' | 'claude-thingtime';
export type DesktopProvider = 'chatgpt' | 'claude';

export type DesktopSourceDescriptor = {
  sourceId: DesktopSourceId;
  provider: DesktopProvider;
  label: string;
  description: string;
  installed: boolean;
  localAvailable: boolean;
  exportSupported: true;
  localDetail: string | null;
};

export type SyncGroup = { id: string; name: string; kind: 'workspace' | 'project' | 'group' };
export type SyncConversation = {
  id: string;
  title: string;
  groupId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
export type SyncMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'unknown';
  authorName: string | null;
  text: string;
  createdAt: string | null;
};

type SyncRecord =
  | { kind: 'group'; value: SyncGroup }
  | { kind: 'conversation'; value: SyncConversation }
  | { kind: 'message'; value: SyncMessage };

export type PreparedDesktopSync = {
  source: {
    provider: DesktopProvider;
    sourceId: DesktopSourceId;
    label: string;
    connector: string;
    mode: 'local' | 'export';
  };
  records: SyncRecord[];
  totals: { groups: number; conversations: number; messages: number };
};

export type DesktopSyncBatch = {
  source: PreparedDesktopSync['source'];
  groups: SyncGroup[];
  conversations: SyncConversation[];
  messages: SyncMessage[];
  final: boolean;
  totals: PreparedDesktopSync['totals'];
  progress: { completed: number; total: number };
  nextCursor: number;
};

const HOME = homedir();
const APP_SUPPORT = join(HOME, 'Library', 'Application Support');
const CHATGPT_STATE = join(HOME, '.codex', 'state_5.sqlite');
const CLAUDE_TRANSCRIPTS = join(HOME, '.claude', 'projects');
const MAX_VISIBLE_MESSAGE_CHARS = 256_000;
const MAX_WALKED_FILES = 100_000;
const MAX_BATCH_BYTES = 600 * 1024;

const SOURCE_CONFIG: Record<DesktopSourceId, {
  provider: DesktopProvider;
  label: string;
  appPaths: string[];
  sessionRoot: string | null;
  description: string;
}> = {
  chatgpt: {
    provider: 'chatgpt',
    label: 'ChatGPT',
    appPaths: ['/Applications/ChatGPT.app', join(HOME, 'Applications', 'ChatGPT.app')],
    sessionRoot: null,
    description: 'ChatGPT Work/Codex conversations stored locally by the desktop app.'
  },
  claude: {
    provider: 'claude',
    label: 'Claude',
    appPaths: ['/Applications/Claude.app', join(HOME, 'Applications', 'Claude.app')],
    sessionRoot: join(APP_SUPPORT, 'Claude', 'claude-code-sessions'),
    description: 'Local Claude Cowork and Claude Code sessions for the main desktop profile.'
  },
  'claude-thingtime': {
    provider: 'claude',
    label: 'Claude Thingtime',
    appPaths: [join(HOME, 'Applications', 'Claude Thingtime.app'), '/Applications/Claude Thingtime.app'],
    sessionRoot: join(APP_SUPPORT, 'claude-thingtime', 'claude-code-sessions'),
    description: 'Local Claude Cowork and Claude Code sessions for the Thingtime desktop profile.'
  }
};

const exists = async (path: string): Promise<boolean> => stat(path).then(() => true).catch(() => false);
const hash = (...parts: unknown[]): string => createHash('sha256').update(parts.map(String).join('\0')).digest('hex');
const shortId = (prefix: string, ...parts: unknown[]): string => `${prefix}-${hash(...parts).slice(0, 40)}`;
const bounded = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';

const isoDate = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(number as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const cleanVisibleText = (value: string): string => {
  let text = value
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<codex_internal_context>[\s\S]*?<\/codex_internal_context>/gi, '')
    .trim();
  if (/^<(environment_context|codex_internal_context|recommended_plugins)(\s|>)/i.test(text)) return '';
  if (text.length > MAX_VISIBLE_MESSAGE_CHARS) text = text.slice(0, MAX_VISIBLE_MESSAGE_CHARS);
  return text;
};

const contentText = (content: unknown): string => {
  if (typeof content === 'string') return cleanVisibleText(content);
  if (!Array.isArray(content)) return '';
  return cleanVisibleText(
    content
      .filter((part): part is Record<string, unknown> => !!part && typeof part === 'object')
      .filter((part) => part.type === 'text' || part.type === 'input_text' || part.type === 'output_text')
      .map((part) => typeof part.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n\n')
  );
};

const walkFiles = async (
  root: string,
  accept: (path: string, name: string) => boolean,
  maxFiles = MAX_WALKED_FILES
): Promise<string[]> => {
  if (!(await exists(root))) return [];
  const found: string[] = [];
  const pending = [root];
  let visited = 0;
  while (pending.length && visited < maxFiles) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > maxFiles) break;
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && accept(path, entry.name)) found.push(path);
    }
  }
  return found;
};

export async function discoverDesktopSources(): Promise<{ sources: DesktopSourceDescriptor[] }> {
  const sources = await Promise.all(
    (Object.keys(SOURCE_CONFIG) as DesktopSourceId[]).map(async (sourceId) => {
      const config = SOURCE_CONFIG[sourceId];
      const installed = (await Promise.all(config.appPaths.map(exists))).some(Boolean);
      const localAvailable = sourceId === 'chatgpt'
        ? await exists(CHATGPT_STATE)
        : !!config.sessionRoot && await exists(config.sessionRoot);
      return {
        sourceId,
        provider: config.provider,
        label: config.label,
        description: config.description,
        installed,
        localAvailable,
        exportSupported: true as const,
        localDetail: localAvailable ? 'Local visible conversation history is available.' : null
      };
    })
  );
  return { sources };
}

const parseJsonLines = async (
  path: string,
  onRecord: (record: Record<string, any>, index: number) => void
): Promise<void> => {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && typeof record === 'object') onRecord(record, index++);
      } catch {
        // One malformed event must not discard the rest of a local transcript.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
};

const scanChatGpt = async (): Promise<{ groups: SyncGroup[]; conversations: SyncConversation[]; messages: SyncMessage[] }> => {
  if (!(await exists(CHATGPT_STATE))) return { groups: [], conversations: [], messages: [] };
  const database = new DatabaseSync(CHATGPT_STATE, { readOnly: true });
  let threads: Record<string, any>[] = [];
  let sections: Record<string, any>[] = [];
  try {
    threads = database.prepare('SELECT * FROM threads ORDER BY updated_at ASC').all() as Record<string, any>[];
    try {
      sections = database.prepare('SELECT * FROM thread_sections').all() as Record<string, any>[];
    } catch {
      sections = [];
    }
  } finally {
    database.close();
  }
  const sectionById = new Map(sections.map((row) => [String(row.id), bounded(row.name, 80)]));
  const groupById = new Map<string, SyncGroup>();
  const conversations: SyncConversation[] = [];
  const messages: SyncMessage[] = [];

  for (const thread of threads) {
    const threadId = bounded(thread.id, 512);
    const rolloutPath = typeof thread.rollout_path === 'string' ? thread.rollout_path : '';
    if (!threadId || !rolloutPath || !(await exists(rolloutPath))) continue;
    const sectionId = thread.thread_section_id || thread.section_id || null;
    const cwd = typeof thread.cwd === 'string' ? thread.cwd : '';
    const groupSeed = sectionId ? `section:${sectionId}` : cwd ? `cwd:${cwd}` : '';
    const groupId = groupSeed ? shortId('chatgpt-workspace', groupSeed) : null;
    if (groupId && !groupById.has(groupId)) {
      groupById.set(groupId, {
        id: groupId,
        name: (sectionId && sectionById.get(String(sectionId))) || bounded(basename(cwd), 80) || 'ChatGPT Work',
        kind: sectionId ? 'group' : 'workspace'
      });
    }
    conversations.push({
      id: threadId,
      title: bounded(thread.title, 80) || 'Untitled ChatGPT work',
      groupId,
      createdAt: isoDate(thread.created_at),
      updatedAt: isoDate(thread.updated_at)
    });
    await parseJsonLines(rolloutPath, (record, index) => {
      if (record.type !== 'response_item') return;
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
      if (payload.type !== 'message' || (payload.role !== 'user' && payload.role !== 'assistant')) return;
      const text = contentText(payload.content);
      if (!text) return;
      messages.push({
        id: bounded(payload.id, 512) || shortId('codex-message', threadId, record.timestamp || '', index),
        conversationId: threadId,
        role: payload.role,
        authorName: payload.role === 'assistant' ? 'ChatGPT' : null,
        text,
        createdAt: isoDate(record.timestamp || payload.created_at)
      });
    });
  }
  return { groups: Array.from(groupById.values()), conversations, messages };
};

const scanClaude = async (
  sourceId: 'claude' | 'claude-thingtime'
): Promise<{ groups: SyncGroup[]; conversations: SyncConversation[]; messages: SyncMessage[] }> => {
  const config = SOURCE_CONFIG[sourceId];
  if (!config.sessionRoot || !(await exists(config.sessionRoot))) return { groups: [], conversations: [], messages: [] };
  const metadataFiles = await walkFiles(config.sessionRoot, (_path, name) => name.endsWith('.json'));
  const metadata: Record<string, any>[] = [];
  for (const path of metadataFiles) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && (parsed.cliSessionId || parsed.sessionId)) metadata.push(parsed);
    } catch {
      // Ignore stale partial metadata entries.
    }
  }
  const wantedTranscripts = new Set(metadata.map((entry) => String(entry.cliSessionId || '')).filter(Boolean));
  const transcriptFiles = await walkFiles(
    CLAUDE_TRANSCRIPTS,
    (_path, name) => name.endsWith('.jsonl') && wantedTranscripts.has(name.slice(0, -'.jsonl'.length))
  );
  const transcriptById = new Map(transcriptFiles.map((path) => [basename(path, '.jsonl'), path]));
  const seenConversations = new Set<string>();
  const groupById = new Map<string, SyncGroup>();
  const conversations: SyncConversation[] = [];
  const messages: SyncMessage[] = [];

  for (const entry of metadata) {
    const rawId = bounded(entry.cliSessionId || entry.sessionId, 512);
    if (!rawId || seenConversations.has(rawId)) continue;
    seenConversations.add(rawId);
    const cwd = typeof entry.originCwd === 'string' ? entry.originCwd : typeof entry.cwd === 'string' ? entry.cwd : '';
    const projectName = bounded(entry.projectName, 80) || bounded(basename(cwd), 80) || `${config.label} sessions`;
    const groupId = cwd ? shortId('claude-project', cwd) : shortId('claude-project', sourceId, projectName);
    if (!groupById.has(groupId)) groupById.set(groupId, { id: groupId, name: projectName, kind: 'project' });
    conversations.push({
      id: rawId,
      title: bounded(entry.title || entry.name, 80) || 'Untitled Claude session',
      groupId,
      createdAt: isoDate(entry.createdAt || entry.created_at),
      updatedAt: isoDate(entry.updatedAt || entry.updated_at || entry.lastActivityAt)
    });
    const transcript = transcriptById.get(String(entry.cliSessionId || ''));
    if (!transcript) continue;
    await parseJsonLines(transcript, (record, index) => {
      if ((record.type !== 'user' && record.type !== 'assistant') || record.isSidechain === true || record.isMeta === true) return;
      const payload = record.message && typeof record.message === 'object' ? record.message : record;
      const role = payload.role === 'assistant' || record.type === 'assistant' ? 'assistant' : 'user';
      const text = contentText(payload.content);
      if (!text) return;
      messages.push({
        id: bounded(record.uuid || payload.id, 512) || shortId('claude-message', rawId, record.timestamp || '', index),
        conversationId: rawId,
        role,
        authorName: role === 'assistant' ? config.label : null,
        text,
        createdAt: isoDate(record.timestamp || payload.created_at)
      });
    });
  }
  return { groups: Array.from(groupById.values()), conversations, messages };
};

const snapshotText = (message: Message): string => {
  const text = message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text || '')
    .filter(Boolean)
    .join('\n\n');
  const attachments = message.attachments.map((attachment) => `[Attachment: ${attachment.name}]`).join('\n');
  return cleanVisibleText([text, attachments].filter(Boolean).join('\n\n'));
};

const snapshotGroup = (conversation: Conversation, label: string): SyncGroup | null => {
  const rawId = typeof conversation.metadata.groupId === 'string'
    ? conversation.metadata.groupId
    : conversation.source.workspaceId;
  if (!rawId) return null;
  const kind = conversation.metadata.groupKind === 'workspace' || conversation.metadata.groupKind === 'group'
    ? conversation.metadata.groupKind
    : 'project';
  return {
    id: String(rawId),
    name: bounded(conversation.metadata.groupName, 80) || `${label} ${kind}`,
    kind
  };
};

const scanSnapshot = (snapshot: Snapshot, label: string) => {
  const groupById = new Map<string, SyncGroup>();
  const conversations: SyncConversation[] = [];
  const messages: SyncMessage[] = [];
  for (const conversation of snapshot.conversations) {
    const group = snapshotGroup(conversation, label);
    if (group) groupById.set(group.id, group);
    conversations.push({
      id: conversation.id,
      title: bounded(conversation.title, 80) || 'Untitled chat',
      groupId: group?.id || null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    });
    for (const message of conversation.messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const text = snapshotText(message);
      if (!text) continue;
      messages.push({
        id: message.id,
        conversationId: conversation.id,
        role: message.role,
        authorName: message.authorName || (message.role === 'assistant' ? label : null),
        text,
        createdAt: message.createdAt
      });
    }
  }
  return { groups: Array.from(groupById.values()), conversations, messages };
};

const prepared = (
  sourceId: DesktopSourceId,
  connector: string,
  mode: 'local' | 'export',
  data: { groups: SyncGroup[]; conversations: SyncConversation[]; messages: SyncMessage[] }
): PreparedDesktopSync => {
  const config = SOURCE_CONFIG[sourceId];
  const groups = Array.from(new Map(data.groups.map((group) => [group.id, group])).values());
  const conversations = Array.from(new Map(data.conversations.map((conversation) => [conversation.id, conversation])).values());
  const messages = Array.from(
    new Map(data.messages.map((message) => [`${message.conversationId}:${message.id}`, message])).values()
  );
  return {
    source: { provider: config.provider, sourceId, label: config.label, connector, mode },
    records: [
      ...groups.map((value): SyncRecord => ({ kind: 'group', value })),
      ...conversations.map((value): SyncRecord => ({ kind: 'conversation', value })),
      ...messages.map((value): SyncRecord => ({ kind: 'message', value }))
    ],
    totals: { groups: groups.length, conversations: conversations.length, messages: messages.length }
  };
};

export async function prepareDesktopSync(input: {
  sourceId: DesktopSourceId;
  mode: 'local' | 'export';
  archivePath?: string | null;
}): Promise<PreparedDesktopSync> {
  const config = SOURCE_CONFIG[input.sourceId];
  if (!config) throw new Error('Unknown AI desktop source');
  if (input.mode === 'export') {
    if (!input.archivePath) throw new Error('Choose an official provider export first');
    const bytes = await readFile(input.archivePath);
    const snapshot = importArchiveBytes(bytes, null);
    if (config.provider === 'chatgpt' && !/chatgpt/i.test(snapshot.sourceApp)) {
      throw new Error('That export does not look like ChatGPT history');
    }
    if (config.provider === 'claude' && !/claude/i.test(snapshot.sourceApp)) {
      throw new Error('That export does not look like Claude history');
    }
    return prepared(input.sourceId, snapshot.connector, 'export', scanSnapshot(snapshot, config.label));
  }
  if (input.sourceId === 'chatgpt') return prepared(input.sourceId, 'codex-local', 'local', await scanChatGpt());
  return prepared(input.sourceId, 'claude-code-local', 'local', await scanClaude(input.sourceId));
}

export function nextDesktopSyncBatch(sync: PreparedDesktopSync, cursor = 0): DesktopSyncBatch {
  const groups: SyncGroup[] = [];
  const conversations: SyncConversation[] = [];
  const messages: SyncMessage[] = [];
  let bytes = Buffer.byteLength(JSON.stringify(sync.source)) + 1024;
  let nextCursor = Math.max(0, Math.floor(cursor));
  while (nextCursor < sync.records.length) {
    const record = sync.records[nextCursor];
    const recordBytes = Buffer.byteLength(JSON.stringify(record.value)) + 32;
    const capReached =
      (record.kind === 'group' && groups.length >= 80) ||
      (record.kind === 'conversation' && conversations.length >= 120) ||
      (record.kind === 'message' && messages.length >= 240);
    if (capReached || (bytes + recordBytes > MAX_BATCH_BYTES && groups.length + conversations.length + messages.length > 0)) break;
    if (recordBytes > MAX_BATCH_BYTES) throw new Error('One imported message is too large for a safe sync batch');
    if (record.kind === 'group') groups.push(record.value);
    else if (record.kind === 'conversation') conversations.push(record.value);
    else messages.push(record.value);
    bytes += recordBytes;
    nextCursor += 1;
  }
  return {
    source: sync.source,
    groups,
    conversations,
    messages,
    final: nextCursor >= sync.records.length,
    totals: sync.totals,
    progress: { completed: nextCursor, total: sync.records.length },
    nextCursor
  };
}
