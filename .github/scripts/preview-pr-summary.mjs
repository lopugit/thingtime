// Keep the durable preview entry point above the author's PR description.
// Only the marked block is owned by the publisher; all other bytes survive.
const start = '<!-- thingtime-preview-summary:start -->';
const end = '<!-- thingtime-preview-summary:end -->';

export function previewSummaryBody(body, summary) {
  body ??= '';
  const starts = body.split(start).length - 1;
  const ends = body.split(end).length - 1;
  if (starts !== ends || starts > 1 || (starts && body.indexOf(end) < body.indexOf(start))) {
    throw new Error('Ambiguous preview summary markers; preserving PR description');
  }
  const block = `${start}\n${summary}\n${end}`;
  if (!starts) return `${block}\n\n${body}`;
  return body.slice(0, body.indexOf(start)) + block + body.slice(body.indexOf(end) + end.length);
}

export async function publishPreviewSummary({ request, repository, number, sha, summary }) {
  if (!/^[1-9][0-9]*$/.test(String(number)) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid preview snapshot');
  const path = `/repos/${repository}/pulls/${number}`;
  const current = await request(path);
  if (current.state !== 'open' || current.head?.sha !== sha) return { changed: false, stale: true };
  const body = previewSummaryBody(current.body, summary);
  if (body === current.body) return { changed: false };
  // Do not retry an uncertain write using a stale copy of the author's body.
  await request(path, { method: 'PATCH', body: { body }, retries: 0 });
  return { changed: true };
}
