export async function finishLopuWorkflow(rootId: string, status: 'completed' | 'needs-attention' | 'stopped') {
	'use step';
	const { getHomeThingsCollection } = await import('../mongodb/collections');
	const { AI_TASK_KIND } = await import('./backgroundTaskCore');
	const things = await getHomeThingsCollection();
	const row = await things.findOne({ shareId: rootId, thingtime: AI_TASK_KIND });
	if (!row) return;
	const finalStatus = row.cancelRequested ? 'stopped' : status;
	await things.updateOne(
		{ shareId: rootId, thingtime: AI_TASK_KIND },
		{
			$set: {
				'crystal.workflowStatus': finalStatus,
				updatedAt: new Date(),
				...(row.crystal.status === 'running'
					? { 'crystal.status': finalStatus, 'crystal.stage': finalStatus === 'stopped' ? 'Stopped' : 'Needs attention' }
					: {})
			},
			$unset: { uniqueKeys: '', workflowInput: '' }
		}
	);
	await import('./liveActivity').then((m) => m.refreshLopuLiveActivitiesForOwner(row.ownerId, row.taskScope)).catch(() => {});
}

/** One invocation executes at most one checkpoint. Step retries only observe a
 * previously claimed turn; they never replay an uncertain tool or provider call. */
export async function runLopuPart(
	rootId: string,
	previousRequestId: string | null,
	failures: number
): Promise<{ next: string | null; reason: string; delay: number; pending?: boolean }> {
	'use step';
	const { Binary } = await import('mongodb');
	const { getHomeThingsCollection } = await import('../mongodb/collections');
	const { AI_TASK_KIND, AI_TASK_HEADER } = await import('./backgroundTaskCore');
	const { resolveSessionUser } = await import('../auth/getCurrentUser');
	const { replyAsUser } = await import('~/routes/api/v1/lopu/chats/reply/_reply');
	const { executeBackgroundTask, startBackgroundTask } = await import('./backgroundTasks');
	const { canAutomaticallyResume, continuationContext, continuationRequestId, LOPU_CONTINUE_PROMPT } = await import('./continuationCore');

	const things = await getHomeThingsCollection();
	const root = await things.findOne({ shareId: rootId, thingtime: AI_TASK_KIND });
	let grant: { input: Record<string, any>; url: string; sessionId: string } | null = null;
	try {
		grant = root?.workflowInput instanceof Binary ? JSON.parse(Buffer.from(root.workflowInput.value()).toString('utf8')) : null;
	} catch {
		/* invalid private grant */
	}
	if (!root || root.cancelRequested || !grant) return { next: null, reason: 'stopped', delay: 0 };
	const user = await resolveSessionUser(grant.sessionId, root.ownerId);
	if (!user || user.temporary || user.accountKind !== 'user') return { next: null, reason: 'stopped', delay: 0 };
	const input = previousRequestId
		? {
				chatId: root.targetId,
				requestId: await continuationRequestId(root.targetId, previousRequestId),
				text: LOPU_CONTINUE_PROMPT,
				continueFromRequestId: previousRequestId,
				automaticContinuation: true,
				management: 'server',
				context: continuationContext(grant.input.context),
				...Object.fromEntries(['model', 'effort', 'speed', 'providerId'].filter((key) => key in grant.input).map((key) => [key, grant.input[key]]))
		  }
		: grant.input;
	const request = new Request(grant.url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', [AI_TASK_HEADER]: input.requestId },
		body: JSON.stringify(input)
	});
	let task: any = previousRequestId
		? await things.findOne({ ownerId: root.ownerId, thingtime: AI_TASK_KIND, taskScope: root.taskScope, 'crystal.requestId': input.requestId })
		: root;
	if (!task) {
		const accepted = await startBackgroundTask(request, (req) => replyAsUser(req, user), {
			user,
			scope: root.taskScope,
			rootTaskId: rootId,
			wait: true
		});
		if (accepted.status !== 202) return { next: null, reason: 'needs-attention', delay: 0 };
		const result = await accepted.json();
		task = await things.findOne({ shareId: result.task.id, thingtime: AI_TASK_KIND });
	} else if (task.crystal.status === 'running') {
		const claim = await things.updateOne(
			{ shareId: task.shareId, thingtime: AI_TASK_KIND, workerStarted: { $ne: true } },
			{ $set: { workerStarted: true } }
		);
		if (!claim.matchedCount) {
			if (new Date(task.deadlineAt).getTime() > Date.now()) return { next: null, reason: 'running', delay: 30_000, pending: true };
			// No verified boundary means the worker may have died inside a side effect.
			// Preserve its receipts and require review instead of running it twice.
			return { next: null, reason: 'needs-attention', delay: 0 };
		}
		await executeBackgroundTask(request, (req) => replyAsUser(req, user), task, user, JSON.stringify(input));
		task = await things.findOne({ shareId: task.shareId, thingtime: AI_TASK_KIND });
	}
	if (!task || task.cancelRequested || task.crystal.status === 'stopped') return { next: null, reason: 'stopped', delay: 0 };
	if (task.targetId && !root.targetId) await things.updateOne({ shareId: rootId, thingtime: AI_TASK_KIND }, { $set: { targetId: task.targetId } });
	const output = task.secure instanceof Binary ? Buffer.from(task.secure.value()).toString('utf8') : '';
	let done: any = null;
	for (const line of output.split('\n')) {
		try {
			const event = JSON.parse(line);
			if (event.type === 'done') done = event;
		} catch {
			/* partial transport frame */
		}
	}
	if (done?.assistantMessageId && canAutomaticallyResume(done) && failures < 5)
		return {
			next: input.requestId,
			reason: done.stopReason,
			delay: done.stopReason === 'error' ? Math.min(60_000, 3000 * 2 ** failures) : 1000
		};
	return { next: null, reason: task.crystal.status === 'completed' ? 'completed' : 'needs-attention', delay: 0 };
}
