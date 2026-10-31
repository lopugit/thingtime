import { INVALID_PAGINATION_CURSOR, MAX_PAGINATION_CURSOR_CHARS } from '~/schemas/paginationCursor';

/** Public, inert projections for saved Builder pages. Never forward raw crystals. */
export const OVERVIEW_ROLES = ['task', 'project', 'agent', 'question', 'progress', 'todo'] as const;
export type OverviewRole = (typeof OVERVIEW_ROLES)[number];
export type OverviewThing = { id: string; crystal: Record<string, unknown>; createdAt?: string; updatedAt?: string };
export type OverviewInput = { view: string; q: string; status: string; projectId: string; taskId: string; cursor: string; schemas: Partial<Record<OverviewRole, string>>; scanStart?: Partial<Record<OverviewRole, string | null>>;
	activeStatuses?: string[]; blockedStatuses?: string[]; completeStatuses?: string[] };
export type OverviewRow = ReturnType<typeof overviewRow>;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const measurement = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const date = (value: unknown): string | null => { const raw = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : text(value); return raw && Number.isFinite(Date.parse(raw)) ? raw : null; };

const chatHref = (value: unknown): string => {
  const raw = text(value);
  // URL parsers strip tabs/newlines before resolving an authority. Reject
  // controls before checking the authored prefix so /<tab>/ cannot become //.
  if (!raw || raw.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(raw)) return '';
  try {
    const url = new URL(raw, 'https://thingtime.invalid');
    return url.protocol === 'https:' && !url.username && !url.password && (raw.startsWith('https://') || (raw.startsWith('/') && !raw.startsWith('//'))) ? raw : '';
  } catch { return ''; }
};

export class OverviewError extends Error {
	constructor(public status: number, message: string) { super(message); }
}

const defaultStatuses = {
	active: ['active', 'in-progress', 'running'],
	blocked: ['blocked', 'needs-attention', 'waiting-approval', 'waiting-question'],
	complete: ['complete', 'completed', 'done']
};
const statusGroups = (input: OverviewInput) => ({ active: input.activeStatuses ?? defaultStatuses.active, blocked: input.blockedStatuses ?? defaultStatuses.blocked, complete: input.completeStatuses ?? defaultStatuses.complete });
export const overviewContext = (input: OverviewInput) => JSON.stringify([input.schemas, input.view, input.q, input.status, input.projectId, input.taskId, statusGroups(input)]);
export const overviewCursor = (input: OverviewInput, after?: string, scanStart = input.scanStart) => Buffer.from(JSON.stringify({ context: overviewContext(input), ...(after ? { after } : {}), ...(scanStart ? { scanStart } : {}) })).toString('base64url');
export function decodeOverviewCursor(input: OverviewInput): { after?: string; scanStart?: OverviewInput['scanStart'] } {
	try {
		const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
		if (decoded.context !== overviewContext(input) || (decoded.after !== undefined && typeof decoded.after !== 'string')) throw new Error();
		if (decoded.scanStart !== undefined && (!decoded.scanStart || typeof decoded.scanStart !== 'object' || Array.isArray(decoded.scanStart) || Object.entries(decoded.scanStart).some(([role,cursor]) => !OVERVIEW_ROLES.includes(role as OverviewRole) || (cursor !== null && typeof cursor !== 'string')))) throw new Error();
		if (!decoded.after && !decoded.scanStart) throw new Error();
		return decoded;
	} catch { throw new OverviewError(409, 'Overview pagination changed. Return to the first page.'); }
}

export function parseOverviewInput(params: URLSearchParams): OverviewInput {
	const cursor = params.get('cursor') || '';
	if (cursor.length > MAX_PAGINATION_CURSOR_CHARS || cursor === INVALID_PAGINATION_CURSOR) throw new OverviewError(400, 'Overview pagination token exceeds the transport budget');
	const schemas: OverviewInput['schemas'] = {};
	for (const role of OVERVIEW_ROLES) {
		const value = params.get(`${role}Schema`);
		if (value) {
			if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || value.length > 512) throw new OverviewError(400, 'Invalid overview schema reference');
			schemas[role] = value;
		}
	}
	if (!schemas.task) throw new OverviewError(400, 'Choose a task schema for this overview');
	const statuses = (key: string, fallback: string[]) => {
		if (params.getAll(key).length > 1) throw new OverviewError(400, `Send ${key} once as comma-separated status values`);
		const raw = params.get(key);
		if (raw === null) return [...fallback];
		if (Array.from(raw).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new OverviewError(400, `Invalid ${key} status values`);
		if (!raw.trim()) return [];
		const values = raw.split(',').map(value => value.trim());
		if (values.some(value => !value)) throw new OverviewError(400, `Invalid ${key} status values`);
		return [...new Set(values)].sort();
	};
	return { schemas, view: params.get('view') || 'hierarchy', q: params.get('q') || '', status: params.get('status') || '', projectId: params.get('projectId') || '', taskId: params.get('taskId') || '', cursor,
		activeStatuses: statuses('activeStatuses', defaultStatuses.active), blockedStatuses: statuses('blockedStatuses', defaultStatuses.blocked), completeStatuses: statuses('completeStatuses', defaultStatuses.complete) };
}

export function overviewRow(thing: OverviewThing, role: OverviewRole) {
	const c = thing.crystal;
	const usage = measurement(c.tokenUsage ?? c.totalTokens);
	const progress = measurement(c.progress);
	const startedAt = date(c.startedAt), endedAt = date(c.endedAt ?? c.completedAt);
	return { id: thing.id, title: text(c.title) || text(c.name), description: text(c.description) || text(c.body), body: text(c.body), answer: text(c.answer),
		chatUrl: chatHref(c.chatUrl), externalId: text(c.externalId), model: text(c.model), reasoningEffort: text(c.reasoningEffort),
		recordType: text(c.recordType) || (role === 'agent' ? 'agent' : `agent-${role}`), status: text(c.status), done: typeof c.done === 'boolean' ? c.done : null,
		projectId: text(c.projectId), parentId: text(c.parentId), agentId: text(c.agentId), taskId: text(c.taskId) || text(c.parentId),
		hierarchyParentId: text(c.parentId) || (role === 'agent' ? text(c.taskId) || text(c.projectId) : role === 'task' ? text(c.projectId) : ''),
		progress, tokenUsage: usage, startedAt, endedAt, createdAt: date(c.createdAt ?? thing.createdAt), updatedAt: date(thing.updatedAt),
		hasTokenUsage: usage !== null, hasProgress: progress !== null, hasStartedAt: startedAt !== null, hasEndedAt: endedAt !== null,
		depth: 0, orphan: false, unresolvedParent: false, cycle: false, questionCount: 0, reportCount: 0 };
}

/** Iterative traversal preserves every row, including detached children and cycles. */
export function hierarchyRows(rows: OverviewRow[]): OverviewRow[] {
	const byId = new Map(rows.map(row => [row.id, row]));
	const children = new Map<string, OverviewRow[]>();
	for (const row of rows) { const key = byId.has(row.hierarchyParentId) ? row.hierarchyParentId : ''; const siblings = children.get(key) || []; siblings.push(row); children.set(key, siblings); }
	const visited = new Set<string>(), output: OverviewRow[] = [];
	const walk = (start: OverviewRow, cycle: boolean) => {
		const stack = [{ row: start, depth: 0, projectId: start.projectId }];
		while (stack.length) {
			const { row, depth, projectId } = stack.pop()!;
			if (visited.has(row.id)) continue;
			visited.add(row.id);
			output.push({ ...row, projectId: row.projectId || projectId, depth, orphan: !!row.hierarchyParentId && !byId.has(row.hierarchyParentId), cycle });
			const inherited = row.recordType === 'agent-project' ? row.id : row.projectId || projectId;
			for (const child of [...(children.get(row.id) || [])].reverse()) if (!visited.has(child.id)) stack.push({ row: child, depth: depth + 1, projectId: inherited });
		}
	};
	for (const row of children.get('') || []) walk(row, false);
	for (const row of rows) if (!visited.has(row.id)) walk(row, true);
	return output;
}

export function buildOverview(input: OverviewInput, records: Record<OverviewRole, OverviewThing[]>, complete: boolean, measuredAt: string) {
	const normalized = Object.fromEntries(OVERVIEW_ROLES.map(role => [role, records[role].map(row => overviewRow(row, role))])) as Record<OverviewRole, OverviewRow[]>;
	const reports = normalized.progress, questions = normalized.question;
	const childCount = (rows: OverviewRow[]) => { const out = new Map<string, number>(); for (const row of rows) { const parent = row.taskId || row.parentId; out.set(parent, (out.get(parent) || 0) + 1); } return out; };
	const questionCounts = childCount(questions), reportCounts = childCount(reports);
	const allRows = hierarchyRows([...normalized.project, ...normalized.task.map(row => ({ ...row, questionCount: questionCounts.get(row.id) || 0, reportCount: reportCounts.get(row.id) || 0 })), ...normalized.agent]).map(row => !complete && row.orphan ? { ...row, orphan: false, unresolvedParent: true } : row);
	const taskIds = new Set(normalized.task.map(row => row.id));
	const taskRows = allRows.filter(row => taskIds.has(row.id));
	const agentIds = new Set(normalized.agent.map(row => row.id));
	const agentRows = allRows.filter(row => agentIds.has(row.id));
	const taskById = new Map(taskRows.map(row => [row.id, row]));
	const matches = (row: OverviewRow) => (!input.status || input.status === 'all' || row.status === input.status) && (!input.projectId || row.projectId === input.projectId || row.id === input.projectId) && (!input.q || `${row.title}\n${row.description}`.toLocaleLowerCase().includes(input.q.toLocaleLowerCase()));
	const tasks = taskRows.filter(matches);
	const selected = taskRows.find(row => row.id === input.taskId) || null;
	// Relational child records store only parentId. Resolve their scope through
	// already-authorized task projections; never fetch a hidden parent or rely
	// on a caller-supplied projectId to grant access. Global status filters refer
	// to the parent's task status; question/todo state is retained on each row.
	const forSelected = (rows: OverviewRow[]) => rows.map(row => {
		const parent = taskById.get(row.taskId || row.parentId);
		return { row: { ...row, projectId: row.projectId || parent?.projectId || '', chatUrl: row.chatUrl || parent?.chatUrl || '', externalId: row.externalId || parent?.externalId || '' }, parent };
	}).filter(({ row, parent }) => input.taskId ? row.taskId === input.taskId || row.parentId === input.taskId :
		(!input.projectId || row.projectId === input.projectId) &&
		(!input.status || input.status === 'all' || (parent?.status || row.status) === input.status) &&
		(!input.q || `${row.title}\n${row.description}\n${parent?.title || ''}\n${parent?.description || ''}`.toLocaleLowerCase().includes(input.q.toLocaleLowerCase()))
	).map(({ row }) => row);
	const selectedQuestions = forSelected(questions), selectedReports = forSelected(reports), selectedTodos = forSelected(normalized.todo);
	const source = input.view === 'agents' ? agentRows.filter(matches) : input.view === 'projects' ? normalized.project.filter(matches) : input.view === 'reports' ? selectedReports : input.view === 'questions' ? selectedQuestions : input.view === 'kanban' ? tasks : allRows.filter(matches);
	let start = 0;
	if (input.cursor) {
		try {
			const decoded = decodeOverviewCursor(input);
			if (!decoded.after) throw new Error();
			const index = source.findIndex(row => row.id === decoded.after);
			if (index < 0) throw new Error();
			start = index + 1;
		} catch { throw new OverviewError(409, 'Overview pagination changed. Return to the first page.'); }
	}
	// A processing page, never a maximum record count. Ancestors need not be on
	// the same page; depth and parentId remain present and no child is dropped.
	const rows = source.slice(start, start + 50);
	const nextCursor = start + rows.length < source.length ? overviewCursor(input, rows[rows.length - 1].id) : null;
	const values = tasks.flatMap(row => row.tokenUsage === null ? [] : [row.tokenUsage]);
	const statuses = [...new Set(tasks.map(row => row.status))];
	const groups = statusGroups(input);
	return { view: input.view, q: input.q, status: input.status, projectId: input.projectId,
		statusGroups: groups,
		stats: { projects: normalized.project.length, tasks: tasks.length, agents: normalized.agent.length, active: tasks.filter(row => groups.active.includes(row.status)).length,
			blocked: tasks.filter(row => groups.blocked.includes(row.status)).length, questions: selectedQuestions.filter(row => !['answered','complete','resolved'].includes(row.status)).length,
			complete: tasks.filter(row => groups.complete.includes(row.status)).length, tokenUsage: values.length ? values.reduce((sum, value) => sum + value, 0) : null },
		rows, projects: normalized.project, agents: agentRows, selected, todos: selectedTodos,
		columns: statuses.map(status => ({ status, count: tasks.filter(row => row.status === status).length, rows: rows.filter(row => taskIds.has(row.id) && row.status === status) })),
		reports: selectedReports, questions: selectedQuestions, nextCursor, measuredAt,
		coverage: { complete, countsScope: complete ? 'all-authorized-records' : 'scanned-authorized-records', countsLabel: complete ? 'Authorized records; task counts follow the current filters' : 'Partial scan; counts are lower bounds, not totals', matchedRows: source.length, pageSize: 50 } };
}
