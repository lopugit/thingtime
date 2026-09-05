import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A successful push proves only the selected base was included. The base can
// advance immediately afterwards; send that new snapshot through normal admission.
export function postPublishRefRace(pr, { repository, number, headRef, baseRef, publishedSha, baseSha, liveBaseSha }) {
  if (pr?.state !== 'open' || pr.number !== Number(number)
    || pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository
    || pr.head.ref !== headRef || pr.base.ref !== baseRef || pr.head.sha !== publishedSha) return false;
  if ((pr.labels ?? []).some(({name}) => ['ai-merge-paused','no-ai-merge','ai-rebase-in-progress','ai-rebase-paused'].includes(name))) return false;
  return /^[a-f0-9]{40}$/.test(liveBaseSha ?? '') && liveBaseSha !== baseSha;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const request = path => JSON.parse(execFileSync('gh', ['api', path], {encoding:'utf8'}));
  const pr = request(`repos/${env.REPO}/pulls/${env.PR_NUMBER}`);
  // PR base.sha can lag the target ref even while GitHub reports DIRTY.
  const liveBaseSha = request(`repos/${env.REPO}/git/ref/heads/${encodeURIComponent(env.BASE_REF)}`).object.sha;
  const retry = postPublishRefRace(pr, {repository:env.REPO,number:env.PR_NUMBER,
    headRef:env.HEAD_REF,baseRef:env.BASE_REF,publishedSha:env.PUBLISHED_SHA,
    baseSha:env.EXPECTED_BASE_SHA,liveBaseSha});
  appendFileSync(env.GITHUB_OUTPUT, `retry=${retry}\nlive_sha=${retry ? liveBaseSha : ''}\n`);
}
