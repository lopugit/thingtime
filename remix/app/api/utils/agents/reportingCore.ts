import { createHash } from 'node:crypto';

export const REPORT_ACTION_ROLES = {
  updateWorkItem: null, createProject: 'project', createTask: 'task', updateTask: 'task', createAgent: 'agent',
  addTodo: 'todo', completeTodo: 'todo', addProgress: 'progress', askQuestion: 'question', answerQuestion: 'question',
  recordMeasurements: 'task', recordTokenUsage: 'task', recordProgressPercent: 'task', recordStartTime: 'task', recordEndTime: 'task', readOverview: null
} as const;
export type ReportAction = keyof typeof REPORT_ACTION_ROLES;
export const REPORT_SCHEMA_ROLES = ['project', 'task', 'agent', 'todo', 'progress', 'question'] as const;
export type ReportingWorkspace = {
  subspaceId?: string; subspaceSlug?: string;
  pages: { overview: string; taskDetail: string };
  schemas: Record<typeof REPORT_SCHEMA_ROLES[number], string>;
  actions: Partial<Record<ReportAction, string>>;
};
export const reportingDigest = (value: unknown): string => {
  const stable = (entry: any): any => Array.isArray(entry) ? entry.map(stable) : entry && typeof entry === 'object'
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, stable(entry[key])])) : entry;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
};
export const reportingUuid = (value: string): string => {
  const hash = reportingDigest(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
export const privateReportingAcl = (acl: unknown): acl is string[] => Array.isArray(acl) && acl.includes('tt:user') && acl.every(entry =>
  typeof entry === 'string' && (entry === 'tt:user' || entry === 'tt:custom' || /^tt:user\/[^/]+(?:\/(?:write|comment))?$/.test(entry)));
export const validReportingWorkspace = (value: any): value is ReportingWorkspace => !!value && typeof value === 'object' &&
  !!value.pages && ['overview', 'taskDetail'].every(role => typeof value.pages[role] === 'string' && !!value.pages[role]) &&
  !!value.schemas && REPORT_SCHEMA_ROLES.every(role => typeof value.schemas[role] === 'string' && !!value.schemas[role]) &&
  new Set(Object.values(value.schemas)).size === REPORT_SCHEMA_ROLES.length &&
  !!value.actions && Object.keys(value.actions).length > 0 && Object.entries(value.actions).every(([name, id]) =>
    Object.hasOwn(REPORT_ACTION_ROLES, name) && typeof id === 'string' && !!id) &&
  (value.subspaceId === undefined || typeof value.subspaceId === 'string') &&
  (value.subspaceSlug === undefined || typeof value.subspaceSlug === 'string');
