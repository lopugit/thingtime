export const LOPU_CREDENTIAL_TYPE = 'claude-code-oauth-token' as const;
export const LOPU_CREDENTIAL_MAX_ITEMS = 8;
export const LOPU_CREDENTIAL_MAX_VALUE_BYTES = 32 * 1024;
export const LOPU_CREDENTIAL_FETCH_MAX_BYTES = 128 * 1024;
export const LOPU_CREDENTIAL_CLOCK_SKEW_MS = 5 * 60 * 1000;

const boundedText = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null);

export const normalizeCredentialName = (value: unknown) => {
  const name = boundedText(value, 80);
  const hasControlCharacter = name ? [...name].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) : true;
  return name && !hasControlCharacter ? name : null;
};

export const normalizeCredentialPlatform = (value: unknown) => {
	const platform = boundedText(value, 80);
	const hasControlCharacter = platform ? [...platform].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) : true;
	return platform && !hasControlCharacter ? platform : null;
};

export const credentialTypeForPlatform = (platform: string) => {
	const normalized = platform.toLowerCase();
	if (normalized === 'anthropic' || normalized === 'claude') return LOPU_CREDENTIAL_TYPE;
	if (normalized === 'openai') return 'openai-api-key';
	if (normalized === 'google' || normalized === 'gemini') return 'google-ai-api-key';
	return 'platform-token';
};

export const normalizeCredentialOrder = (value: unknown) => {
  if (!Array.isArray(value) || value.length > LOPU_CREDENTIAL_MAX_ITEMS) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const id = boundedText(entry, 160);
    if (!id || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
};

export const normalizeBootstrapCredentials = (value: unknown) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LOPU_CREDENTIAL_MAX_ITEMS) return null;
  const rows: Array<{ name: string; value: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const name = normalizeCredentialName((entry as Record<string, unknown>).name);
    const credential = (entry as Record<string, unknown>).value;
		if (!name || typeof credential !== 'string' || !credential.trim() || Buffer.byteLength(credential, 'utf8') > LOPU_CREDENTIAL_MAX_VALUE_BYTES)
			return null;
    if (rows.some((row) => row.name === name)) return null;
    rows.push({ name, value: credential.trim() });
  }
  return rows;
};

export type LopuCredentialFetchRequest = {
  repository: string;
  workflowRef: string;
  runId: string;
  runAttempt: string;
  nonce: string;
  requestedAt: Date;
};

export const parseLopuCredentialFetchRequest = (
  value: unknown,
  options: { repository: string; allowedRefs?: string[]; allowedWorkflowFiles?: string[]; now?: number }
): LopuCredentialFetchRequest | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const repository = boundedText(body.repository, 300);
  const workflowRef = boundedText(body.workflowRef, 300);
  const runId = boundedText(body.runId, 80);
  const runAttempt = boundedText(body.runAttempt, 20);
  const nonce = boundedText(body.nonce, 160);
  const requestedAt = new Date(boundedText(body.requestedAt, 80) ?? '');
  if (!repository || repository !== options.repository) return null;
  if (!workflowRef || !runId || !runAttempt || !nonce || !Number.isFinite(requestedAt.getTime())) return null;
  if (!/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) return null;
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(nonce)) return null;
  const match = workflowRef.match(/^([^/]+\/[^/]+)\/\.github\/workflows\/([^/@]+)@refs\/heads\/([^/]+)$/);
  if (!match || match[1] !== options.repository) return null;
  const allowedRefs = options.allowedRefs ?? ['github-actions'];
  const allowedWorkflowFiles = options.allowedWorkflowFiles ?? ['resolve-pr-conflicts.yml', 'rebase-pr-stacks.yml', 'all-branch.yml'];
  if (!allowedWorkflowFiles.includes(match[2]) || !allowedRefs.includes(match[3])) return null;
  if (Math.abs((options.now ?? Date.now()) - requestedAt.getTime()) > LOPU_CREDENTIAL_CLOCK_SKEW_MS) return null;
  return { repository, workflowRef, runId, runAttempt, nonce, requestedAt };
};
