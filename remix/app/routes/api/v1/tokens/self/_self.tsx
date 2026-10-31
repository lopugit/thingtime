import { json } from '~/api/http';

import { resolvePatIntrospection } from '~/api/utils/auth/patTokens';

// GET /api/v1/tokens/self — free introspection for the token holder (an AI or
// script): who am I, what can I do, when do I expire, how many uses are left.
// Deliberately does NOT consume a use — a 1-use token would otherwise burn its
// only call on the question. Bearer PAT only.
export const loader = async ({ request }: { request: Request }) => {
  const result = await resolvePatIntrospection(request);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, token: result.token, user: result.user });
};
