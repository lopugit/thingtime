export async function finishLopuWorkflow(rootId: string, status: 'completed' | 'needs-attention' | 'stopped') {
 'use step';
 const { finalizeLopuWorkflow } = await import('./continuationFinalization.server');
 return finalizeLopuWorkflow(rootId, status);
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
 // Reserve the root before dispatch; finalization cancels this same row.
 // The reservation closes the gap before a child task is inserted/claimed.
 if (!task || (task.crystal.status === 'running' && !task.workerStarted)) {
  const reserved = await things.updateOne({shareId:rootId,ownerId:root.ownerId,taskScope:root.taskScope,thingtime:AI_TASK_KIND,
   cancelRequested:{$ne:true},'crystal.workflowStatus':'running',
   $or:[{activeWorkerRequestId:{$exists:false}},{activeWorkerRequestId:input.requestId}]},
   {$set:{activeWorkerRequestId:input.requestId}});
  if (!reserved.matchedCount) return {next:null,reason:'stopped',delay:0};
 }
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
			{
				shareId: task.shareId,
				ownerId: root.ownerId,
				taskScope: root.taskScope,
				thingtime: AI_TASK_KIND,
				'crystal.status': 'running',
				cancelRequested: { $ne: true },
				workerStarted: { $ne: true },
				...(!task.rootTaskId ? { 'crystal.workflowStatus': 'running' } : {})
			},
			{ $set: { workerStarted: true } }
		);
		if (!claim.matchedCount) {
   task = await things.findOne({ shareId: task.shareId, thingtime: AI_TASK_KIND });
   if (!task?.workerFinishedAt) {
    if (!task || task.cancelRequested || task.crystal.status !== 'running') {
     // A cancelled, unclaimed task cannot start; claimed executors must save
     // an acknowledgment before any matching reservation can be cleared.
     if (task?.cancelRequested && !task.workerStarted) await things.updateOne({shareId:rootId,thingtime:AI_TASK_KIND,activeWorkerRequestId:input.requestId},{$unset:{activeWorkerRequestId:''}});
     return { next: null, reason: 'stopped', delay: 0 };
    }
    if (new Date(task.deadlineAt).getTime() > Date.now()) return { next: null, reason: 'running', delay: 30_000, pending: true };
    return { next: null, reason: 'needs-attention', delay: 0 };
   }
   // Another delivery finished between our stale read and this claim. Fall
   // through to acknowledged-reservation cleanup and its saved checkpoint.
  } else {
   await executeBackgroundTask(request, (req) => replyAsUser(req, user), task, user, JSON.stringify(input));
   task = await things.findOne({ shareId: task.shareId, thingtime: AI_TASK_KIND });
  }
	}
 // A duplicate dispatch can reserve after another executor already finished.
 // Its persisted acknowledgment proves this matching reservation is safe to clear.
 if (task?.workerFinishedAt) await things.updateOne({shareId:rootId,ownerId:root.ownerId,taskScope:root.taskScope,thingtime:AI_TASK_KIND,activeWorkerRequestId:input.requestId},{$unset:{activeWorkerRequestId:''}});
	if (task?.crystal.status === 'running' && !task.cancelRequested) return new Date(task.deadlineAt).getTime() > Date.now() ? {next:null,reason:'running',delay:30_000,pending:true} : {next:null,reason:'needs-attention',delay:0};
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
