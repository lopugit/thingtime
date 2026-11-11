import OpenAI from 'openai';
import { json, readJsonBody } from '~/api/http';
import { inspectThingsActor, resolveThingsActor } from '~/api/utils/auth/patTokens';
import { parseAiRespondInput, AI_RESPOND_MODEL, AI_RESPOND_MAX_OUTPUT_TOKENS } from '~/api/utils/ai/respondCore';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { assertLopuAccess, lopuAccessResponse } from '~/api/utils/lopu/access';
import { debitLopuUsage } from '~/api/utils/lopu/accounting';

const headers = { 'Cache-Control': 'private, no-store' };
const respond = (body: unknown, status = 200) => json(body, { status, headers });

// POST /api/v1/ai/respond: a PAT-only, one-prompt completion. The PAT's
// ai.complete scope is independent of Things and Lopu conversation access.
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') return respond({ ok: false, error: 'Method not allowed.' }, 405);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return respond({ ok: false, error: 'Use application/json.' }, 415);
  // This route does not accept ambient cookies, full sessions, or app grants.
  if (!request.headers.get('Authorization')?.startsWith('Bearer ')) return respond({ ok: false, error: 'A scoped AI token is required.' }, 401);
  const inspected = await inspectThingsActor(request, 'ai.complete');
  if (inspected.ok === false) return respond({ ok: false, error: inspected.error }, inspected.status);
  if (!inspected.actor.user || !inspected.actor.pat) return respond({ ok: false, error: 'A scoped AI token is required.' }, 401);
  let input: { prompt: string };
  try { input = parseAiRespondInput(await readJsonBody(request, 16 * 1024)); }
  catch { return respond({ ok: false, error: 'Send only a prompt of 1–4000 characters.' }, 400); }
  if (!process.env.OPENAI_API_KEY) return respond({ ok: false, error: 'AI text completion is unavailable.' }, 503);
  const user = inspected.actor.user;
  const limit = await enforceRateLimit(request, 'ai.complete', `user:${user.id}:token:${inspected.actor.pat.jti}`, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'AI text completion is temporarily rate limited.' }, rateLimitedResponseInit(limit));
  const access = await assertLopuAccess(user, { billing: 'thingtime', reserve: true });
  if (access.ok === false) return lopuAccessResponse(access);
  try {
    // Consume exactly one use after the body, provider, rate, and credit gates.
    const admitted = await resolveThingsActor(request, 'ai.complete');
    if (admitted.ok === false) return respond({ ok: false, error: admitted.error }, admitted.status);
    if (!admitted.actor.user || !admitted.actor.pat || admitted.actor.user.id !== user.id) return respond({ ok: false, error: 'AI token is unavailable.' }, 401);
    const startedAt = Date.now();
    try {
      const completion = await new OpenAI().chat.completions.create({
        model: AI_RESPOND_MODEL,
        messages: [
          { role: 'system', content: 'Answer the user directly and concisely. You have no access to their files, conversations, accounts, or tools.' },
          { role: 'user', content: input.prompt }
        ],
        max_tokens: AI_RESPOND_MAX_OUTPUT_TOKENS
      }, { signal: request.signal, timeout: 30_000 });
      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) return respond({ ok: false, error: 'AI returned no text.' }, 502);
      const usage = { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
      await debitLopuUsage(user.id, { surface: 'chat', billing: 'thingtime', provider: 'openai', model: AI_RESPOND_MODEL, usage, durationMs: Date.now() - startedAt });
      return respond({ ok: true, text });
    } catch {
      return respond({ ok: false, error: 'AI text completion failed.' }, 502);
    }
  } finally {
    if (access.release) await access.release().catch(() => null);
  }
};
