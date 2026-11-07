#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Inspect prose, not quoted replies or fenced/indented code examples. Markers
// are suppression metadata, never evidence that grants permission to a user.
export function hasAutomationMarker(body) {
  let fence = null;
  for (const line of String(body ?? '').split(/\r?\n/u)) {
    if (/^\s*>/u.test(line)) continue;
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (boundary && boundary[1][0] === fence[0] && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null;
      continue;
    }
    if (boundary) { fence = boundary[1]; continue; }
    if (/^(?: {4}|\t)/u.test(line)) continue;
    if (/^\s*<!--\s*thingtime-/iu.test(line)) return true;
  }
  return false;
}

export function classifyConversation(eventName, event) {
  if (!['issue_comment', 'pull_request_review_comment'].includes(eventName)) return { eligible: false, reason: 'not-conversation' };
  if (eventName === 'issue_comment' && !event.issue?.pull_request) return { eligible: false, reason: 'not-pull-request' };
  if (!['created', 'edited'].includes(event.action)) return { eligible: false, reason: 'unsupported-action' };
  if (event.comment?.user?.type !== 'User') return { eligible: false, reason: 'not-human-author' };
  const body = event.comment.body;
  if (typeof body !== 'string' || !body.trim()) return { eligible: false, reason: 'empty-comment' };
  if (hasAutomationMarker(body) || hasAutomationMarker(event.changes?.body?.from)) return { eligible: false, reason: 'automation-marker' };
  if (event.action === 'edited' && event.changes?.body?.from === body) return { eligible: false, reason: 'unchanged-comment' };
  return { eligible: true, reason: 'human-conversation' };
}

export async function classifyQueuedConversation({ dispatchId, repository, prNumber, readComment }) {
  if (!/^lopu-review:(?:issue-comment|inline-comment):/u.test(dispatchId ?? '')) return { eligible: true, reason: 'not-conversation-dispatch' };
  const match = dispatchId.match(/^lopu-review:(issue-comment|inline-comment):([1-9][0-9]*):([1-9][0-9]*)$/u);
  if (!match || !/^[\w.-]+\/[\w.-]+$/u.test(repository) || !/^[1-9][0-9]*$/u.test(prNumber)) throw new Error('Invalid conversation dispatch scope');
  const kind = match[1] === 'issue-comment' ? 'issues' : 'pulls';
  const comment = await readComment(`repos/${repository}/${kind}/comments/${match[2]}`);
  if (!comment) return { eligible: false, reason: 'comment-deleted' };
  const url = kind === 'issues' ? comment.issue_url : comment.pull_request_url;
  if (String(comment.id) !== match[2] || url !== `https://api.github.com/repos/${repository}/${kind}/${prNumber}`) throw new Error('Conversation dispatch no longer matches its PR');
  return classifyConversation(kind === 'issues' ? 'issue_comment' : 'pull_request_review_comment', { action: 'created', issue: { pull_request: {} }, comment });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = process.argv.includes('--queued')
    ? await classifyQueuedConversation({ dispatchId: process.env.REVIEW_DISPATCH_ID, repository: process.env.REPO, prNumber: process.env.SELECTED_PR, readComment: async path => {
      try {
        return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
      } catch (error) {
        if (/\(HTTP 404\)/u.test(String(error.stderr))) return null;
        throw new Error('Could not verify queued conversation; refusing model work');
      }
    } })
    : classifyConversation(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
  appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${result.eligible}\n`);
  console.log(`Lopu conversation admission: ${result.reason}`);
}
