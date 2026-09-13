import { createHash, randomUUID } from 'node:crypto';
import { getCiControlCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { redactNotificationText } from '../errors/adminDiagnostic';
import { chatOnline, chatRunActive, STACK_CHAT_ID, STACK_CHAT_LEASE_MS } from './stackChatCore';
import { repositoryName } from './githubClient';

const KIND = 'ci-stack-chat-message';
const publicMessage = (row: any) => ({
	id: String(row.shareId),
	question: String(row.crystal.question),
	answer: row.crystal.answer ?? null,
	status: String(row.crystal.status),
	createdAt: new Date(row.createdAt).toISOString(),
	updatedAt: new Date(row.updatedAt).toISOString()
});
export const chatDispatch = async (runId: string) => {
	if (!STACK_CHAT_ID.test(runId)) throw new Error('Choose a valid stack run.');
	const db = await getCiControlCollection();
	const dispatch = await db.findOne({ thingtime: 'ci-dispatch', 'crystal.repository': repositoryName(), 'crystal.featureStackRunId': runId });
	if (!dispatch) throw new Error('Stack run not found.');
	return dispatch;
};
export const readStackChat = async (runId: string) => {
	const dispatch = await chatDispatch(runId);
	const db = await getCiControlCollection();
	const messages = await db.find({ thingtime: KIND, parentId: dispatch.shareId }).sort({ createdAt: -1, shareId: -1 }).limit(50).toArray();
	const stack = await db.findOne({
		shareId: dispatch.parentId,
		thingtime: 'ci-feature-stack',
		'crystal.lastDispatchId': dispatch.shareId,
		'crystal.status': { $nin: ['paused', 'stopped', 'archived'] }
	});
	const active = Boolean(stack) && chatRunActive(dispatch.crystal.runStatus ?? dispatch.crystal.status);
	return {
		runId,
		online: active && chatOnline(dispatch),
		supported: dispatch.crystal.chatProtocol === 1,
		active,
		lastSeenAt: dispatch.crystal.chatPollAt ?? null,
		workflowRunId: dispatch.crystal.workflowRunId ?? null,
		messages: messages.reverse().map(publicMessage)
	};
};
export const enqueueStackQuestion = async (input: { runId: string; requestId: string; question: string }, actorId: string) => {
	const dispatch = await chatDispatch(input.runId);
	const db = await getCiControlCollection();
	const id = `ci-stack-chat-${createHash('sha256')
		.update(JSON.stringify([input.runId, actorId, input.requestId]))
		.digest('hex')
		.slice(0, 48)}`;
	const question = redactNotificationText(input.question);
	const existing = await db.findOne({ shareId: id, thingtime: KIND });
	if (existing) {
		if (existing.crystal.question !== question) throw new Error('This message ID was already used for a different question.');
		return publicMessage(existing);
	}
	const stack = await db.findOne({
		shareId: dispatch.parentId,
		thingtime: 'ci-feature-stack',
		'crystal.lastDispatchId': dispatch.shareId,
		'crystal.status': { $nin: ['paused', 'stopped', 'archived'] }
	});
	if (!stack || !chatOnline(dispatch))
		throw new Error('The run responder is offline. Wait for its next check-in or start a run with the updated controller.');
	const now = new Date();
	const row = {
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.ciControl,
		shareId: id,
		thingtime: [KIND],
		parentId: dispatch.shareId,
		ownerId: 'system',
		acl: [],
		storageClass: 'control',
		targetId: null,
		tags: [],
		createdAt: now,
		updatedAt: now,
		expiresAt: new Date(now.getTime() + 90 * 86400_000),
		crystal: { repository: repositoryName(), runId: input.runId, actorId, question, answer: null, status: 'queued', attempts: 0 }
	};
	await db.updateOne({ shareId: id, thingtime: KIND }, { $setOnInsert: row }, { upsert: true });
	const stored = await db.findOne({ shareId: id, thingtime: KIND });
	if (stored?.crystal.question !== question) throw new Error('This message ID was already used for a different question.');
	return publicMessage(stored);
};

export const pollStackChat = async (input: { runId: string; workflowRunId: number; runAttempt: number; available: boolean; reply: any }) => {
	const dispatch = await chatDispatch(input.runId);
	const db = await getCiControlCollection();
	if (Number(dispatch.crystal.workflowRunId) !== input.workflowRunId) throw new Error('The responder does not match this stack run.');
	const oldAttempt = Number(dispatch.crystal.chatRunAttempt ?? 0);
	if (input.runAttempt < oldAttempt) throw new Error('This run attempt has been superseded.');
	const now = new Date();
	// Advance the attempt atomically; an older runner must never reclaim a newer runner's mailbox.
	const claimed = await db.updateOne(
		{
			shareId: dispatch.shareId,
			thingtime: 'ci-dispatch',
			$or: [{ 'crystal.chatRunAttempt': { $exists: false } }, { 'crystal.chatRunAttempt': { $lte: input.runAttempt } }]
		},
		{
			$set: {
				'crystal.chatProtocol': 1,
				'crystal.chatRunAttempt': input.runAttempt,
				'crystal.chatPollAt': now,
				'crystal.chatAvailable': input.available
			}
		}
	);
	if (!claimed.matchedCount) throw new Error('This run attempt has been superseded.');
	let replyAccepted = input.reply ? false : null;
	if (input.reply) {
		const receipt = await db.updateOne(
			{
				thingtime: KIND,
				shareId: input.reply.id,
				parentId: dispatch.shareId,
				'crystal.status': 'answering',
				'crystal.lease': input.reply.lease,
				'crystal.runAttempt': input.runAttempt,
				'crystal.leaseUntil': { $gt: now }
			},
			{
				$set: {
					'crystal.answer': redactNotificationText(input.reply.answer),
					'crystal.status': input.reply.status,
					'crystal.completedLease': input.reply.lease,
					updatedAt: now
				},
				$unset: { 'crystal.lease': '', 'crystal.leaseUntil': '' }
			}
		);
		replyAccepted = Boolean(
			receipt.matchedCount ||
				(await db.findOne({
					thingtime: KIND,
					shareId: input.reply.id,
					parentId: dispatch.shareId,
					'crystal.completedLease': input.reply.lease,
					'crystal.runAttempt': input.runAttempt,
					'crystal.status': input.reply.status
				}))
		);
	}
	const active = chatRunActive(dispatch.crystal.runStatus ?? dispatch.crystal.status);
	const stack = await db.findOne({
		shareId: dispatch.parentId,
		thingtime: 'ci-feature-stack',
		'crystal.lastDispatchId': dispatch.shareId,
		'crystal.status': { $nin: ['paused', 'stopped', 'archived'] }
	});
	if (!active || !stack || !input.available) return { message: null, replyAccepted };
	// Expired/crashed deliveries are retried twice, then become visibly failed instead of waiting forever.
	await db.updateMany(
		{
			thingtime: KIND,
			parentId: dispatch.shareId,
			'crystal.status': 'answering',
			'crystal.leaseUntil': { $lte: now },
			'crystal.attempts': { $gte: 2 }
		},
		{
			$set: {
				'crystal.status': 'failed',
				'crystal.answer': 'The responder disconnected before it could answer. Send a new question when it is online.',
				updatedAt: now
			}
		}
	);
	const lease = randomUUID();
	const row = await db.findOneAndUpdate(
		{
			thingtime: KIND,
			parentId: dispatch.shareId,
			$or: [{ 'crystal.status': 'queued' }, { 'crystal.status': 'answering', 'crystal.leaseUntil': { $lte: now }, 'crystal.attempts': { $lt: 2 } }]
		},
		{
			$set: {
				'crystal.status': 'answering',
				'crystal.lease': lease,
				'crystal.runAttempt': input.runAttempt,
				'crystal.leaseUntil': new Date(now.getTime() + STACK_CHAT_LEASE_MS),
				updatedAt: now
			},
			$inc: { 'crystal.attempts': 1 }
		},
		{ sort: { createdAt: 1, shareId: 1 }, returnDocument: 'after' }
	);
	if (!row) return { message: null, replyAccepted };
	// Fence a claim racing a newer workflow attempt before exposing its question.
	const currentAttempt = await db.findOne({ shareId: dispatch.shareId, thingtime: 'ci-dispatch', 'crystal.chatRunAttempt': input.runAttempt });
	if (!currentAttempt) {
		await db.updateOne({ shareId: row.shareId, 'crystal.lease': lease }, { $set: { 'crystal.leaseUntil': now } });
		throw new Error('This run attempt has been superseded.');
	}
	const history = await db
		.find({ thingtime: KIND, parentId: dispatch.shareId, 'crystal.status': 'answered' })
		.sort({ createdAt: -1 })
		.limit(4)
		.toArray();
	return {
		replyAccepted,
		message: {
			id: String(row.shareId),
			lease,
			question: row.crystal.question,
			history: history.reverse().map((item: any) => ({ question: item.crystal.question, answer: item.crystal.answer }))
		}
	};
};
