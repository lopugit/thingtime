// Shared wire contract for the admin editor and protected preview controller.
export const PREVIEW_RETENTION_KEY = 'Thingtime.CiPreviewRetention';
export const PREVIEW_RETENTION_REQUIREMENTS = { 'api.admin-ci-preview-retention': '1.0.0' } as const;
export type PreviewRetentionPolicy = {
  version: 1;
  enabled: boolean;
  noOpenPrGraceHours: number;
  pruneSupersededOpenPr: boolean;
  supersededGraceHours: number;
  inactivePullRequestDays: number | null;
};
export type PreviewRetentionSettings = { policy: PreviewRetentionPolicy; revision: string | null };
export const DEFAULT_PREVIEW_RETENTION: PreviewRetentionPolicy = {
  version: 1, enabled: true, noOpenPrGraceHours: 0,
  pruneSupersededOpenPr: false, supersededGraceHours: 24,
  inactivePullRequestDays: null
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const duration = (value: unknown, milliseconds: number, minimum = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && Number.isSafeInteger(value * milliseconds);
export const parsePreviewRetentionPolicy = (value: unknown): PreviewRetentionPolicy => {
  if (!record(value) || value.version !== 1 || typeof value.enabled !== 'boolean' ||
      typeof value.pruneSupersededOpenPr !== 'boolean' ||
      !duration(value.noOpenPrGraceHours, 3_600_000) || !duration(value.supersededGraceHours, 3_600_000) ||
      !(value.inactivePullRequestDays === null || duration(value.inactivePullRequestDays, 86_400_000, 1))) {
    throw new TypeError('Choose whole, non-negative grace hours and a positive inactivity period, or turn inactivity off.');
  }
  return {
    version: 1, enabled: value.enabled, noOpenPrGraceHours: value.noOpenPrGraceHours as number,
    pruneSupersededOpenPr: value.pruneSupersededOpenPr, supersededGraceHours: value.supersededGraceHours as number,
    inactivePullRequestDays: value.inactivePullRequestDays as number | null
  };
};
export const validPreviewRetentionRead = (value: unknown, repository: string, now = Date.now()) => {
  if (!record(value) || value.repository !== repository || value.ref !== 'github-actions' || typeof value.requestedAt !== 'string') return false;
  const time = Date.parse(value.requestedAt);
  return Number.isFinite(time) && Math.abs(now - time) <= 10 * 60_000;
};
export class PreviewRetentionConflict extends Error {
  constructor() { super('These settings changed in another session. Reload the saved policy before saving again.'); }
}
