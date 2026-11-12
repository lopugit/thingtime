import type { AiBackgroundTask } from '~/api/utils/lopu/backgroundTaskCore';

export type LopuDisplayTask = AiBackgroundTask & { resultTask: AiBackgroundTask };

/** A durable chain is one task, even when it has many saved execution parts. */
export const presentLopuTasks = (tasks: AiBackgroundTask[]): LopuDisplayTask[] => {
	const roots = new Map<string, AiBackgroundTask>();
	const latest = new Map<string, AiBackgroundTask>();
	for (const task of tasks) {
		const id = task.rootTaskId || task.id;
		if (!task.rootTaskId) roots.set(id, task);
		const prior = latest.get(id);
		if (!prior || task.createdAt > prior.createdAt) latest.set(id, task);
	}
	return [...latest]
		.map(([id, resultTask]) => {
			const root = roots.get(id) || resultTask;
			const status = root.workflowStatus || root.status;
			const stage =
				root.stage === 'Stopping' || root.stage === 'Waiting for worker to stop'
     ? root.stage
     : root.workflowStatus === 'running'
					? resultTask.status === 'running'
						? resultTask.stage
						: 'Continuing'
					: root.workflowStatus === 'completed'
					? 'Completed'
					: root.workflowStatus === 'stopped'
					? 'Stopped'
					: root.workflowStatus === 'needs-attention'
					? 'Needs attention'
					: root.stage;
			return {
				...root,
				status,
				stage,
				error: root.workflowStatus === 'running' || root.workflowStatus === 'completed' ? null : root.error || resultTask.error,
				resultTask
			};
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
