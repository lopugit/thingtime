import type { FeatureStackHeartbeat } from './featureStackRunCore';

export type StackActivity = {
	target: string;
	state: 'working' | 'queued' | 'waiting' | 'blocked' | 'failed' | 'merged' | 'skipped' | 'stopped' | 'unknown';
	title: string;
	detail: string;
	next: string;
	url?: string | null;
	updatedAt?: string | null;
};
type Target = { target: string; status: string; url?: string | null; updatedAt?: string | null };
const norm = (v: unknown) => String(v ?? '').toLowerCase();

export function stackActivities(targets: Target[], heartbeat: FeatureStackHeartbeat | null, runStatus: string, now = Date.now()): StackActivity[] {
	const stale = !heartbeat || now - Date.parse(heartbeat.at) > 12 * 60_000;
	return targets.map((pr) => {
		const worker = heartbeat?.targets.find((row) => row.target === pr.target);
		const state = norm(pr.status);
		const base = { target: pr.target, url: pr.url ?? worker?.jobUrl, updatedAt: pr.updatedAt ?? heartbeat?.at };
		if (state === 'merged')
			return {
				...base,
				state: 'merged',
				title: 'Merged',
				detail: 'The stack PR has merged into this target.',
				next: 'No further merge work for this target.'
			};
		if (state === 'skipped' || worker?.status === 'skipped')
			return {
				...base,
				state: 'skipped',
				title: 'Skipped',
				detail: 'No merge was performed for this target.',
				next: 'Check target compatibility or the skipped job before retrying.'
			};
		if (['paused', 'stopped', 'cancelled'].includes(norm(runStatus)))
			return {
				...base,
				state: 'stopped',
				title: 'Stopped',
				detail: 'This run is no longer doing work for this target.',
				next: 'Restart the saved stack to begin a fresh run.'
			};
		if (worker?.status === 'failure' || ['failure', 'failed', 'timed_out'].includes(norm(runStatus)))
			return {
				...base,
				state: 'failed',
				title: 'Worker failed',
				detail: worker?.phase ?? 'The workflow failed before this target was confirmed merged.',
				next: 'Inspect the failed job. After its cause is fixed, restart against the latest target.',
				url: worker?.jobUrl ?? pr.url
			};
		if (['conflicting', 'dirty'].includes(state) && worker?.status === 'in_progress' && !/waiting|published/i.test(worker.phase) && !stale)
			return {
				...base,
				state: 'working',
				title: 'Working on conflicting target',
				detail: worker.phase,
				next: 'The target PR still conflicts. The active worker must finish its repair and verification before it can merge.',
				url: worker.jobUrl ?? pr.url
			};
		if (state === 'conflicting' || state === 'dirty')
			return {
				...base,
				state: 'blocked',
				title: 'Blocked by merge conflicts',
				detail: 'The published stack PR conflicts with the current target branch.',
				next: 'Lopu must resolve the updated branch and rerun checks. A waiting merge job alone does not prove the resolver is working.'
			};
		if (state === 'closed')
			return {
				...base,
				state: 'blocked',
				title: 'Closed without merging',
				detail: 'The target PR closed without delivering the stack.',
				next: 'Review the PR outcome before restarting.'
			};
		if (worker && /waiting|published/i.test(worker.phase))
			return {
				...base,
				state: 'waiting',
				title: 'Waiting to merge',
				detail: worker.phase,
				next: 'GitHub must confirm mergeability and required checks/reviews. No conflict-editing work is shown by this step.'
			};
		if (worker?.status === 'queued' || worker?.status === 'waiting')
			return { ...base, state: 'queued', title: 'Queued', detail: worker.phase, next: 'Waiting for a GitHub runner or Lopu worker slot.' };
		if (worker?.status === 'in_progress' && !/waiting|published/i.test(worker.phase) && !stale)
			return {
				...base,
				state: 'working',
				title: 'Working',
				detail: worker.phase,
				next: 'The worker will report its next phase; successful publication still needs a merge.'
			};
		if (pr.url)
			return {
				...base,
				state: 'waiting',
				title: 'PR published',
				detail: 'The stack PR exists, but its merge is not confirmed.',
				next: 'Open the PR for current checks and reviews. Worker activity is not confirmed.'
			};
		return {
			...base,
			state: 'unknown',
			title: stale ? 'Awaiting fresh status' : 'Waiting for worker',
			detail: stale ? 'No recent worker heartbeat is available.' : 'The stack has not published a target PR yet.',
			next: 'Refresh or open the GitHub run for the latest job state.'
		};
	});
}

export function stackActivitySummary(rows: StackActivity[]) {
	const count = (state: StackActivity['state']) => rows.filter((row) => row.state === state).length;
	const eligible = rows.filter((row) => row.state !== 'skipped').length;
	const merged = count('merged');
	const parts = [
		`${merged}/${eligible} targets merged`,
		...(['working', 'queued', 'waiting', 'blocked', 'failed', 'stopped', 'unknown', 'skipped'] as const).flatMap((state) =>
			count(state) ? [`${count(state)} ${state === 'unknown' ? 'awaiting status' : state}`] : []
		)
	];
	return { summary: parts.join(' · '), percent: eligible ? Math.round((merged / eligible) * 100) : 0, finished: eligible > 0 && merged === eligible };
}
