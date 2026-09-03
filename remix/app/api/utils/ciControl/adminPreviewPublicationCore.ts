import type { CiPreviewEnvironment } from './previewPolicyCore';

export const ADMIN_PREVIEW_COMMENT_MARKER = '<!-- thingtime-admin-pr-previews -->';
export const ADMIN_PREVIEW_EXPECTED_DEPLOYMENT_SECONDS = 5 * 60;

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const safeHostname = (value: string): string => {
  const hostname = value.trim().toLowerCase();
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.length < 2 || labels.some((label) => !HOSTNAME_LABEL.test(label))) {
    throw new Error('Preview alias suffix is invalid');
  }
  return hostname;
};

export const adminPreviewPersistentHostname = (
  prNumber: number,
  environment: CiPreviewEnvironment,
  suffixes: { develop: string; production: string }
): string => {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Preview alias PR number is invalid');
  return `pr-${prNumber}.${safeHostname(suffixes[environment])}`;
};

export const adminPreviewSnapshotUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.startsWith('https://') ? value : `https://${value}`);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname.endsWith('.vercel.app')
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

export const adminPreviewExpectedReadyAt = (startedAt: Date | string | number): number => {
  const raw = startedAt instanceof Date ? startedAt.getTime() : typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  const startedAtMs = raw > 0 && raw < 10_000_000_000 ? raw * 1000 : raw;
  if (!Number.isFinite(startedAtMs) || startedAtMs < 1) throw new Error('Preview deployment start time is invalid');
  return Math.floor(startedAtMs / 1000) + ADMIN_PREVIEW_EXPECTED_DEPLOYMENT_SECONDS;
};

export type AdminPreviewCommentRow = {
  environment: CiPreviewEnvironment;
  status: string;
  snapshotUrl: string | null;
  persistentUrl: string;
  expectedReadyAt: number;
};

const statusPresentation = (value: string): string => {
  const status = value.trim().toLowerCase();
  if (status === 'ready') return '✅ Ready';
  if (status === 'error' || status === 'failed') return '❌ Failed';
  if (status === 'canceled' || status === 'cancelled') return '⚪ Canceled';
  return `🟡 ${status ? status[0].toUpperCase() + status.slice(1) : 'Queued'}`;
};

const environmentLabel = (environment: CiPreviewEnvironment) =>
  environment === 'develop' ? 'Develop' : 'Production / main';

const expectedReadyPresentation = (row: AdminPreviewCommentRow): string => {
  const status = row.status.trim().toLowerCase();
  if (status === 'ready') return '✅ Ready';
  if (status === 'error' || status === 'failed' || status === 'canceled' || status === 'cancelled') return '—';
  return `<t:${row.expectedReadyAt}:R> (<t:${row.expectedReadyAt}:t>)`;
};

export const adminPreviewCommentBody = (input: {
  prNumber: number;
  sha: string;
  rows: AdminPreviewCommentRow[];
}): string => {
  const rows = [...input.rows].sort(
    (left, right) => (left.environment === 'develop' ? 0 : 1) - (right.environment === 'develop' ? 0 : 1)
  );
  const content = rows.length
    ? [
        '| Environment | Status | Snapshot URL | Persistent URL | Expected ready |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(
          (row) =>
            `| ${environmentLabel(row.environment)} | ${statusPresentation(row.status)} | ${
              row.snapshotUrl ? `[Open snapshot](${row.snapshotUrl})` : 'Assigned when Vercel accepts the build'
            } | [Open persistent preview](${row.persistentUrl}) | ${expectedReadyPresentation(row)} |`
        ),
        '',
        'Expected PR-scoped URLs are published before the builds start. Snapshot URLs are immutable for this commit and appear after Vercel accepts each build. Each persistent URL moves only to the newest READY snapshot for that PR and environment.'
      ].join('\n')
    : 'No admin-selected preview environments are currently enabled for this PR.';
  return `${ADMIN_PREVIEW_COMMENT_MARKER}\n### 🦄 Thingtime PR previews\n\n- PR: #${input.prNumber}\n- Commit: \`${input.sha}\`\n\n${content}`;
};

export const adminPreviewRemovedCommentBody = (prNumber: number): string =>
  `${ADMIN_PREVIEW_COMMENT_MARKER}\n### 🧹 Thingtime PR previews removed\n\nThe PR-scoped Develop and Production/Main preview deployments and persistent aliases for PR #${prNumber} were removed when the pull request closed.`;

export const isOwnedAdminPreviewComment = (comment: any, githubAppId: number): boolean =>
  typeof comment?.body === 'string' &&
  comment.body.includes(ADMIN_PREVIEW_COMMENT_MARKER) &&
  (Number(comment?.performed_via_github_app?.id) === githubAppId || Number(comment?.app?.id) === githubAppId);
