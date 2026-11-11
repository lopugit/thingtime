// A deliberately small, stateless AI contract for scoped callers. No caller
// selected model, connection, system prompt, tool, URL, owner, or conversation.
export const AI_RESPOND_MODEL = 'gpt-4o-mini';
export const AI_RESPOND_MAX_OUTPUT_TOKENS = 500;
export const AI_RESPOND_MAX_PROMPT_CHARS = 4000;

export const parseAiRespondInput = (value: unknown): { prompt: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Send a JSON object with a prompt.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'prompt')) throw new TypeError('Only prompt is supported.');
  if (typeof record.prompt !== 'string') throw new TypeError('Prompt is required.');
  const prompt = record.prompt.trim();
  if (!prompt || Array.from(prompt).length > AI_RESPOND_MAX_PROMPT_CHARS) throw new TypeError('Prompt must contain 1–4000 characters.');
  return { prompt };
};
