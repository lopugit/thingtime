export const AI_SOURCE_PROVIDERS = ['chatgpt', 'claude'] as const;

export type AiSourceProvider = (typeof AI_SOURCE_PROVIDERS)[number];
export type AiMessageRole = 'user' | 'assistant' | 'system' | 'unknown';

export type PublicExternalAiSource = {
  provider: AiSourceProvider;
  sourceId: string;
  label: string;
  connector: string;
  readOnly: true;
  role?: AiMessageRole;
  authorName?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const publicExternalAiSource = (value: unknown): PublicExternalAiSource | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const provider = AI_SOURCE_PROVIDERS.includes(raw.provider as AiSourceProvider)
    ? (raw.provider as AiSourceProvider)
    : null;
  const sourceId = text(raw.sourceId, 64);
  const label = text(raw.label, 80);
  const connector = text(raw.connector, 80);
  if (!provider || !sourceId || !label || !connector) return null;

  const role = ['user', 'assistant', 'system', 'unknown'].includes(String(raw.role))
    ? (raw.role as AiMessageRole)
    : undefined;
  const authorName = text(raw.authorName, 80) || null;
  const segmentIndex = Number.isSafeInteger(raw.segmentIndex) && Number(raw.segmentIndex) >= 0
    ? Number(raw.segmentIndex)
    : undefined;
  const segmentCount = Number.isSafeInteger(raw.segmentCount) && Number(raw.segmentCount) > 0
    ? Number(raw.segmentCount)
    : undefined;

  return {
    provider,
    sourceId,
    label,
    connector,
    readOnly: true,
    ...(role ? { role } : {}),
    ...(authorName ? { authorName } : {}),
    ...(segmentIndex !== undefined ? { segmentIndex } : {}),
    ...(segmentCount !== undefined ? { segmentCount } : {})
  };
};
