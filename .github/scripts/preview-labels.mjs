// Durable, discoverable preview status. Timestamp labels are PR-scoped so
// renaming one never changes another PR's successful-build date.
import { setTimeout as delay } from 'node:timers/promises';
import { transientPreviewError } from './preview-comments.mjs';

const lanes = { develop: 'built', 'admin-develop': 'dev', production: 'prod' };
const colors = { queued: 'fbca04', building: 'fbca04', ready: '0e8a16', failed: 'd73a4a', removed: 'ededed' };
const encode = encodeURIComponent;
const prefix = (number, lane) => `tt-pv1:${number}:${lane}:`;

export const hasPreviewLabels = (labels, number, lane) => Array.isArray(labels) && labels.some((label) =>
  label.description?.startsWith(prefix(number, lane)) || label.description?.startsWith(`tt-preview-state:v1:${lane}:`));

export function previewBuildTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000) throw new Error('Invalid preview build time');
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZoneName: 'short' }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part('day')}/${part('month')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

export function deploymentBuiltAt(deployment) {
  for (const value of [deployment?.ready, deployment?.readyAt]) {
    if (typeof value === 'number' || typeof value === 'string') {
      const time = new Date(value).getTime();
      if (Number.isFinite(time) && time >= Date.UTC(2000, 0, 1)) return time;
    }
  }
  throw new Error('READY deployment has no verified completion timestamp');
}

export function previewBuiltLabel({ number, lane, sha, builtAt }) {
  if (!Number.isSafeInteger(number) || number <= 0 || !Object.hasOwn(lanes, lane) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Invalid preview label identity');
  }
  const stamp = new Date(builtAt).getTime();
  const name = `last preview ${lanes[lane]} ${previewBuildTime(stamp)} #${number}`;
  const description = `${prefix(number, lane)}${sha}:${stamp}`;
  if (name.length > 100 || description.length > 100) throw new Error('Preview label exceeds GitHub limits');
  return { name, description, color: colors.ready };
}

async function ensureLabel(request, repository, label) {
  const path = `/repos/${repository}/labels/${encode(label.name)}`;
  let current;
  try { current = await request(path); } catch (error) { if (error.status !== 404) throw error; }
  if (!current) {
    try { return await request(`/repos/${repository}/labels`, { method: 'POST', body: label, accept: [201], retries: 0 }); }
    catch (error) {
      // A concurrent creator or an ambiguous accepted POST is reconciled,
      // never blindly replayed.
      try { current = await request(path); } catch { throw error; }
    }
  }
  if (current?.description !== label.description) throw new Error('Preview label name belongs to different metadata');
  return current;
}

export async function syncPreviewLabels(options) {
  for (let attempt = 0; ; attempt++) {
    try { return await syncOnce(options); }
    catch (error) {
      if (attempt >= 2 || !transientPreviewError(error)) throw error;
      // Re-read the PR and label metadata after uncertain writes before
      // deciding what still needs changing; never replay a rename blindly.
      await (options.pause ?? delay)(250 * 2 ** attempt);
    }
  }
}

async function syncOnce({ request, repository, number, sha, lane = 'develop', status, builtAt }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(number) || number <= 0
    || !Object.hasOwn(lanes, lane) || !Object.hasOwn(colors, status) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Invalid preview label scope');
  }
  const pr = await request(`/repos/${repository}/pulls/${number}`);
  if (pr.head?.sha !== sha || (status !== 'removed' && pr.state !== 'open')) return { stale: true };
  const labels = pr.labels;
  if (!Array.isArray(labels)) throw new Error('Incomplete PR label inventory');
  // Cleanup must not add labels to unrelated PRs that never had a preview.
  if (status === 'removed' && !hasPreviewLabels(labels, number, lane)) return { absent: true };
  if (status === 'ready') {
    const next = previewBuiltLabel({ number, lane, sha, builtAt });
    const old = labels.filter((label) => label.description?.startsWith(prefix(number, lane)));
    if (old.length > 1) throw new Error('Ambiguous PR preview timestamp labels');
    if (old[0] && old[0].description !== next.description) {
      // A late recovery of an older deployment may not move the timestamp back.
      const previousTime = Number(old[0].description.split(':').at(-1));
      if (!Number.isFinite(previousTime)) throw new Error('Invalid existing preview timestamp');
      if (previousTime <= new Date(builtAt).getTime()) {
        const uses = await request(`/repos/${repository}/issues?state=all&labels=${encode(old[0].name)}&per_page=100`);
        if (!Array.isArray(uses) || uses.some((issue) => issue.number !== number)) throw new Error('PR-scoped preview label is used elsewhere');
        await request(`/repos/${repository}/labels/${encode(old[0].name)}`, {
          method: 'PATCH', body: { new_name: next.name, color: next.color, description: next.description }, retries: 0
        });
      }
    } else if (!old.length) {
      await ensureLabel(request, repository, next);
      await request(`/repos/${repository}/issues/${number}/labels`, { method: 'POST', body: { labels: [next.name] }, accept: [200], retries: 0 });
    }
  }
  const statePrefix = `tt-preview-state:v1:${lane}:`;
  const state = { name: `preview: ${lane} ${status}`, color: colors[status], description: `${statePrefix}${status}` };
  if (!labels.some((label) => label.name === state.name && label.description === state.description)) {
    await ensureLabel(request, repository, state);
    await request(`/repos/${repository}/issues/${number}/labels`, { method: 'POST', body: { labels: [state.name] }, accept: [200], retries: 0 });
  }
  for (const old of labels.filter((label) => label.description?.startsWith(statePrefix) && label.name !== state.name)) {
    await request(`/repos/${repository}/issues/${number}/labels/${encode(old.name)}`, { method: 'DELETE', accept: [200, 204, 404] });
  }
  return { stale: false };
}
