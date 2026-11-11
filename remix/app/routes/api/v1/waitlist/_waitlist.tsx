import { json } from '~/api/http';

import { pickFallbackMusing } from '~/api/utils/lopu/fallbacks';
import { joinWaitlist } from '~/api/utils/waitlist/waitlist';

const MAX_BODY_BYTES = 2048;

// POST /api/v1/waitlist — { email } — join the launch waitlist (landing hero).
export const action = async ({ request }: { request: Request }) => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Request too large' }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await joinWaitlist(request, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  // First contact becomes a gift: a fortune from Lopu's musing library
  // (time-rotated, RNG-free — the same picker the musing endpoint uses, so
  // seeded joins and real joins share one voice). claude-todo/10 ✨.
  return json({ ok: true, fortune: pickFallbackMusing() });
};
