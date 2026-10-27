import { json } from '../../http';
import { getHomeThingsCollection } from '../mongodb/collections';
import { getLopuChat } from '../messenger/lopuChats';
import { AI_TASK_KIND, type AiTaskDiagnostics, type AiTaskWorkerEvidence } from './backgroundTaskCore';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
// Include only evidence fields. Never fetch grants, endpoints, prompts or output.
const projection = { _id: 0, shareId: 1, rootTaskId: 1, targetId: 1,
  'crystal.requestId': 1, workerStarted: 1, workerFinishedAt: 1,
  workflowRunId: 1, workflowGatewayDeploymentId: 1, workflowFinalStatus: 1,
  workflowFinalizedAt: 1, activeWorkerRequestId: 1 };
const idValue = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : null;
const timestamp = (value: unknown): string | null => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
const workerEvidence = (row: any): AiTaskWorkerEvidence => ({ id: idValue(row.shareId), requestId: idValue(row.crystal?.requestId),
  workerStarted: typeof row.workerStarted === 'boolean' ? row.workerStarted : null, workerFinishedAt: timestamp(row.workerFinishedAt) });

/** Called only after taskViewer verifies full-account, expected-owner and origin.
 * Every linked read repeats owner/data scope and chain membership. No mutation,
 * provider query, output read or assertion that an absent receipt means stopped.
 * Reads may race normal saves: this is evidence for review, never a drain grant. */
export const readBackgroundTaskDiagnostics = async (_request: Request, ownerId: string, scope: string, id: string) => {
  const things = await getHomeThingsCollection();
  const filter = { ownerId, thingtime: AI_TASK_KIND, taskScope: scope };
  const unavailable = () => json({ ok: false, error: 'Task not found.' }, { status: 404, headers });
  const selected = await things.findOne({ ...filter, shareId: id }, { projection });
  if (!selected) return unavailable();
  const rootId = selected.rootTaskId || selected.shareId;
  const root = selected.rootTaskId ? await things.findOne({ ...filter, shareId: rootId, rootTaskId: { $exists: false } }, { projection }) : selected;
  if (!root) return unavailable();
  const chain = { ...filter, $or: [{ shareId: rootId, rootTaskId: { $exists: false } }, { rootTaskId: rootId }] };
  const reserved = root.activeWorkerRequestId ? await things.findOne({ ...chain, 'crystal.requestId': root.activeWorkerRequestId }, { projection }) : null;
  const unacknowledged = await things.findOne({ ...chain, workerStarted: true, workerFinishedAt: { $exists: false } }, { projection });
  for (const chatId of new Set([selected, root, reserved, unacknowledged].map(row => row?.targetId).filter(Boolean))) {
    if ((await getLopuChat(ownerId, chatId)).ok === false) return unavailable();
  }
  const claim = await things.findOne({ ...filter, shareId: rootId, 'uniqueKeys.0': { $exists: true } }, { projection: { _id: 0, shareId: 1 } });
  const finalStatus = ['completed', 'needs-attention', 'stopped'].includes(root.workflowFinalStatus) ? root.workflowFinalStatus : null;
  const diagnostics: AiTaskDiagnostics = {
    taskId: id, rootTaskId: rootId, observedAt: new Date().toISOString(), consistency: 'non-atomic-read',
    workflowRunId: idValue(root.workflowRunId), workflowGatewayDeploymentId: idValue(root.workflowGatewayDeploymentId),
    workflowFinalStatus: finalStatus, workflowFinalizedAt: timestamp(root.workflowFinalizedAt),
    conversationClaimRecorded: !!claim,
    activeWorkerRequestId: idValue(root.activeWorkerRequestId), rootWorker: workerEvidence(root),
    reservedWorker: reserved ? workerEvidence(reserved) : null, unacknowledgedWorker: unacknowledged ? workerEvidence(unacknowledged) : null
  };
  return json({ ok: true, ownerId, contextKey: scope, diagnostics }, { headers });
};
