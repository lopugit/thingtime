// Both preview publishers share bounded ownership checks and no-op writes.
import { setTimeout as delay } from 'node:timers/promises';

export const transientPreviewError = (error) => [408, 429, 500, 502, 503, 504].includes(error?.status)
  || ['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name);

export async function publishPreviewNotifications(operations, { bestEffort = false } = {}) {
  const results = await Promise.allSettled(operations.map((operation) => operation()));
  const failures = results.filter((result) => result.status === 'rejected');
  if (!failures.length) return;
  if (!bestEffort) throw new AggregateError(failures.map((result) => result.reason), 'Preview GitHub status publication is incomplete');
  console.warn('::warning::Preview status publication is temporarily incomplete; continuing the build and retrying at the next phase.');
}

export async function upsertPreviewComment(options) {
  for (let attempt = 0; ; attempt++) {
    try { return await upsertOnce(options); }
    catch (error) {
      if (attempt >= 2 || !transientPreviewError(error)) throw error;
      // Re-read ownership and current content before retrying any mutation:
      // the preceding POST may have succeeded despite a lost response.
      await (options.pause ?? delay)(250 * 2 ** attempt);
    }
  }
}

export function isManagedPreviewComment(comment, marker) {
  const login = String(comment?.user?.login ?? '').trim().toLowerCase();
  const trustedAuthor = login === 'github-actions[bot]' || (comment?.user?.type === 'User' && comment?.author_association === 'OWNER');
  return trustedAuthor && comment?.body?.startsWith(marker);
}

async function upsertOnce({ request, repository, number, marker, body, createIfMissing = true }) {
  if (!/^[1-9][0-9]*$/u.test(String(number))) throw new Error('Invalid comment PR number');
  if (!/^<!-- thingtime-[\w:-]+ -->$/u.test(marker)) throw new Error('Invalid automation comment marker');
  let existing = null;
  for (let page = 1; page <= 10; page += 1) {
    const comments = await request(`/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(comments)) throw new Error('GitHub comments response was invalid');
    existing = [...comments].reverse().find(comment => isManagedPreviewComment(comment, marker)) ?? null;
    if (existing || comments.length < 100) break;
    if (page === 10) throw new Error('GitHub comment scan exceeded its safety bound');
  }
  const nextBody = `${marker}\n${body}`;
  if (existing?.body === nextBody || (!existing && !createIfMissing)) return { changed: false };
  if (existing) {
    await request(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body: nextBody }, retries: 0 });
  } else {
    await request(`/repos/${repository}/issues/${number}/comments`, { method: 'POST', body: { body: nextBody }, accept: [201], retries: 0 });
  }
  return { changed: true };
}
