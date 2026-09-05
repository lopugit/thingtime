// Both preview publishers share bounded ownership checks and no-op writes.
export function isManagedPreviewComment(comment, marker) {
  const login = String(comment?.user?.login ?? '').trim().toLowerCase();
  const trustedAuthor = login === 'github-actions[bot]' || (comment?.user?.type === 'User' && comment?.author_association === 'OWNER');
  return trustedAuthor && comment?.body?.startsWith(marker);
}

export async function upsertPreviewComment({ request, repository, number, marker, body, createIfMissing = true }) {
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
    await request(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body: nextBody } });
  } else {
    await request(`/repos/${repository}/issues/${number}/comments`, { method: 'POST', body: { body: nextBody }, accept: [201] });
  }
  return { changed: true };
}
