// Recovery uses the existing scheduled protected controller. It never builds
// PR code in the credentialed job and never interrupts an active preview.
export function recoverySourceIssue(run, payload, config, now = Date.now()) {
  if (Number(run?.id) !== payload.sourceRunId) return 'wrong-run';
  if (run?.event !== 'schedule' || run?.head_branch !== config.defaultBranch) return 'wrong-schedule';
  if (String(run.path ?? '').split('@')[0] !== '.github/workflows/develop-pr-preview.yml') return 'wrong-path';
  if (Number(run.repository?.id) !== config.repositoryId || Number(run.head_repository?.id) !== config.repositoryId) return 'wrong-repository';
  if (!['in_progress', 'completed'].includes(run.status)) return 'wrong-state';
  const age = now - Date.parse(run.created_at);
  if (!Number.isFinite(age) || age < -60_000 || age > 12 * 60 * 60_000) return 'expired';
  return null;
}

export async function previewWorkActive(request, repository, number) {
  for (const phase of ['worker', 'handoff']) {
    let queue;
    try { queue = await request(`/repos/${repository}/actions/concurrency_groups/develop-pr-preview-${phase}-${number}`); }
    catch (error) { if (error.status === 404) continue; throw error; }
    if (!Array.isArray(queue?.group_members) || queue.total_count !== queue.group_members.length) throw new Error('Incomplete preview queue inventory');
    if (queue.group_members.some((member) => ['pending', 'in_progress'].includes(member.status))) return true;
  }
  return false;
}

export function recoveryAttempt(statuses, now = Date.now()) {
  if (!Array.isArray(statuses) || statuses.length >= 100) throw new Error('Incomplete preview recovery history');
  const attempts = statuses.flatMap((status) => {
    const match = /^Preview recovery requested \(attempt ([1-3])\)$/.exec(status.description || '');
    if (!match) return [];
    const time = Date.parse(status.created_at);
    if (!Number.isFinite(time)) throw new Error('Invalid preview recovery timestamp');
    return [{ attempt: Number(match[1]), time }];
  });
  const last = Math.max(0, ...attempts.map((entry) => entry.attempt));
  if (last >= 3) return { allowed: false, reason: 'retry-limit' };
  if (attempts.some((entry) => now - entry.time < 30 * 60_000)) return { allowed: false, reason: 'cooldown' };
  return { allowed: true, attempt: last + 1 };
}

export async function reconcilePreviewInventory({ numbers, inspect }) {
  const failures = [];
  for (const number of numbers) {
    try { await inspect(number); }
    catch (error) { failures.push({ number, error }); }
  }
  if (failures.length) throw new AggregateError(failures.map((entry) => entry.error),
    `Preview recovery incomplete for PR(s): ${failures.map((entry) => entry.number).join(', ')}`);
}
