import { randomUUID } from 'node:crypto';
import { resolveThingsActor, revalidateThingsActor } from '../auth/patTokens';
import { findUserById } from '../auth/users';
import { canManageCharacters, createCharacter } from '../auth/characters';
import { characterIdentity } from '../auth/characterCore';
import { resolvePublicOrigin } from '../auth/publicOrigin';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { getThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { newThingDoc } from '../messenger/shared';
import { findSubspaceById, findSubspaceBySlug, accessOf, canModerate, isActiveMember, membershipOf } from '../subspaces/gate';
import { listSubspaces, mutateMember } from '../subspaces/subspaces';
import { createThing, getThing, updateThing, viewerOf, type Viewer } from '../things/things';
import { runAction, type ActionOperationPolicy } from '../actions/execute';
import { REPORT_ACTION_ROLES, privateReportingAcl, reportingDigest, reportingUuid, validReportingWorkspace, type ReportAction, type ReportingWorkspace } from './reportingCore';

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const scope = 'agents.report';
const ref = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const safeBinding = (binding: any) => ({ id: binding.shareId, externalTaskId: binding.crystal.externalTaskId,
  characterId: binding.crystal.characterId, parentTaskId: binding.crystal.parent?.taskId || null, sharedTaskId: binding.crystal.parent?.sharedTaskId || binding.crystal.records?.taskId || null, coordinationPostId: binding.crystal.coordinationPostId || null, workspace: binding.crystal.workspace, records: binding.crystal.records || {} });
const requireOk = (result: any) => { if (!result || result.ok === false) throw new ReportingError(result?.status || 503, result?.error || 'Reporting dependency unavailable'); return result; };
class ReportingError extends Error { constructor(public status: number, message: string) { super(message); } }

/** The scope delegates only this closed task workflow. No session/token is
 * minted, and the Character is never returned as a general account actor. */
export async function agentReporting(request: Request, input: any) {
  try {
    if (isCustomMongoEndpointActive()) return fail(400, 'Private agent reporting requires the home database; custom database selection is not supported');
    const publicOrigin = resolvePublicOrigin(request).origin;
    if (!input || !ref(input.externalTaskId) || !ref(input.origin) || input.origin !== publicOrigin)
      return fail(400, 'origin must match this selected origin and externalTaskId is required');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.get('Origin') && request.headers.get('Origin') !== publicOrigin))
      return fail(403, 'Same-origin request required');
    const admitted = requireOk(await resolveThingsActor(request, scope)).actor;
    if (!admitted.user) return fail(401, 'Sign in with the owning account or an agents.report token');
    if (admitted.pat && (admitted.pat.onlyCreatedThings || !['all', 'private'].includes(admitted.pat.visibility)))
      return fail(403, 'Private reporting requires a non-sandbox agents.report token with private visibility');
    const ownerId = admitted.user.id;
    const owner = await findUserById(ownerId);
    if (!canManageCharacters(owner)) return fail(403, 'Private reporting requires the owning account');
    const ownerViewer = viewerOf(admitted.user, admitted.pat);
    const assertOwner = async () => {
      const latest = requireOk(admitted.pat ? await revalidateThingsActor(request, scope, admitted.pat) : await resolveThingsActor(request, scope));
      if (latest.actor.user?.id !== ownerId) throw new ReportingError(401, 'Reporting credential was revoked or changed');
    };
    const things = await getThingsCollection();
    const key = reportingDigest([ownerId, publicOrigin, input.externalTaskId]);
    const filter = { thingtime: 'agent-reporting-binding', ownerId, ...thingUniqueKeyFilter('agentReportingBinding', key) };
    let binding = await things.findOne(filter as any);
    if (input.operation === 'prepare') {
      if (!validReportingWorkspace(input.workspace) || !ref(input.displayName)) return fail(400, 'A displayName and exact saved workspace references are required');
      const workspace: ReportingWorkspace = structuredClone(input.workspace);
      const parentExternalTaskId = input.parentExternalTaskId === undefined ? null : input.parentExternalTaskId;
      if (parentExternalTaskId !== null && (!ref(parentExternalTaskId) || parentExternalTaskId === input.externalTaskId)) return fail(400, 'parentExternalTaskId must name a different prepared task');
      if (binding && (binding.crystal.parentExternalTaskId || null) !== parentExternalTaskId) return fail(409, 'This task is already bound to a different parent');
      let parentBinding: any = null;
      if (parentExternalTaskId) {
        parentBinding = await things.findOne({ thingtime: 'agent-reporting-binding', ownerId,
          ...thingUniqueKeyFilter('agentReportingBinding', reportingDigest([ownerId, publicOrigin, parentExternalTaskId])) } as any);
        if (!parentBinding?.crystal.prepared || !parentBinding.crystal.records?.taskId || !parentBinding.crystal.records?.projectId ||
            reportingDigest(parentBinding.crystal.workspaceRequest) !== reportingDigest(workspace)) return fail(409, 'The parent must be a prepared task with project and task records in this exact workspace');
        await verifyBinding(parentBinding, ownerId, ownerViewer);
      }

      if (binding && reportingDigest(binding.crystal.workspaceRequest) !== reportingDigest(workspace)) return fail(409, 'This task is already bound to different workspace references');
      // Verify every exact reference before creating the Character or changing ACLs.
      await verifyWorkspace(ownerId, ownerViewer, workspace);
      const subspace = await resolveReportingSubspace(ownerViewer, workspace);
      if (!subspace || accessOf(subspace) !== 'private' || !canModerate(await membershipOf(String(subspace.shareId), ownerId)))
        return fail(403, 'The existing private Thingtime Agents subspace requires owner or moderator access');
      if (!binding) {
        await assertOwner();
        const created = requireOk(await createCharacter(owner, { requestId: reportingUuid(key), displayName: input.displayName, loginMode: 'switch' }));
        const characterId = created.character.user.id;
        const doc = { ...newThingDoc('agent-reporting-binding', { ownerId, shareId: `agent-reporting-${randomUUID()}`,
          uniqueKeys: [thingUniqueKey('agentReportingBinding', key)], crystal: { externalTaskId: input.externalTaskId,
            origin: publicOrigin, characterId, workspaceRequest: workspace, workspace: { ...workspace, subspaceId: String(subspace.shareId) },
            parentExternalTaskId, ...(parentBinding ? { parent: { bindingId: parentBinding.shareId, characterId: parentBinding.crystal.characterId,
              taskId: parentBinding.crystal.records.taskId, projectId: parentBinding.crystal.records.projectId,
              projectCharacterId: parentBinding.crystal.parent?.projectCharacterId || parentBinding.crystal.characterId,
              sharedTaskId: parentBinding.crystal.parent?.sharedTaskId || parentBinding.crystal.records.taskId } } : {}),
            records: parentBinding ? { projectId: parentBinding.crystal.records.projectId } : {} } }), storageClass: 'control' };
        try { await things.insertOne(doc as any); binding = doc; }
        catch (error: any) { if (error?.code !== 11000) throw error; binding = await things.findOne(filter as any); if (!binding) throw error; }
      }
      if ((binding.crystal.parentExternalTaskId || null) !== parentExternalTaskId) return fail(409, 'This task is already bound to a different parent');
      if (reportingDigest(binding.crystal.workspaceRequest) !== reportingDigest(workspace)) return fail(409, 'This task is already bound to different workspace references');
      if (binding.crystal.prepared === true) {
        await assertOwner(); await verifyBinding(binding, ownerId, ownerViewer);
        return { ok: true, binding: safeBinding(binding) };
      }
      const character = await requireLiveCharacter(binding, ownerId);
      const existing = await membershipOf(String(subspace.shareId), String(character._id));
      if (existing && !isActiveMember(existing)) return fail(403, 'Task Character membership was revoked; reporting will not re-enable it');
      if (!existing) { await assertOwner(); requireOk(await mutateMember(ownerViewer, { id: String(subspace.shareId), userId: String(character._id), action: 'add' }, { insertOnly: true })); }
      // Explicit agents.report consent covers read grants only to the exact
      // supplied owner-private references. It never changes their visibility.
      for (const id of referenceIds(workspace)) {
        await assertOwner();
        const current = await requirePrivateReference(ownerId, ownerViewer, id);
        const grant = `tt:user/${character.username}`;
        if (!current.acl.includes(grant) && !current.acl.includes(`${grant}/write`))
          requireOk(await updateThing(ownerViewer, id, { acl: [...new Set([...current.acl, 'tt:custom', grant])] }, { expectedUpdatedAt: current.updatedAt instanceof Date ? current.updatedAt.toISOString() : current.updatedAt }));
      }
      if (binding.crystal.parent) {
        const parent = binding.crystal.parent;
        const parentCharacter = await requireLiveCharacter(parentBinding, ownerId);
        const projectCharacter = await requireLiveCharacter({ crystal: { characterId: parent.projectCharacterId } }, ownerId);
        for (const [id, actor] of [[parent.projectId, projectCharacter], [parent.taskId, parentCharacter]] as const) {
          await assertOwner();
          const grantViewer: Viewer = { id: String(actor._id), username: actor.username };
          const current = await requirePrivateReference(String(actor._id), grantViewer, id, 'data');
          const grant = `tt:user/${character.username}`;
          if (!current.acl.includes(grant)) requireOk(await updateThing(grantViewer, id, { acl: [...new Set([...current.acl, 'tt:custom', grant])] },
            { expectedUpdatedAt: current.updatedAt instanceof Date ? current.updatedAt.toISOString() : current.updatedAt }));
        }
      }
      await verifyBinding(binding, ownerId, ownerViewer);
      await things.updateOne(filter as any, { $set: { 'crystal.prepared': true } });
      return { ok: true, binding: safeBinding(binding) };
    }
    if (!binding) return fail(404, 'Prepare this stable task identity first');
    const verified = await verifyBinding(binding, ownerId, ownerViewer);
    await assertOwner();
    if (input.operation === 'get') {
      const ids = input.recordIds === undefined ? Object.values(binding.crystal.records || {}) : input.recordIds;
      if (!Array.isArray(ids) || !ids.every(ref)) return fail(400, 'recordIds must be an array of exact task record IDs');
      const records = [];
      const readPolicy = reportingPolicy(things, binding, verified.character, owner.username, 'readOverview', '');
      for (const id of [...new Set(ids)] as string[]) {
        await assertOwner(); await readPolicy.access(id, 'read');
        records.push(requireOk(await getThing(ownerViewer, id)).thing);
      }
      const activeId = binding.crystal.activeOperation;
      const active = activeId ? await things.findOne({ thingtime: 'agent-reporting-operation', ownerId, targetId: binding.shareId,
        ...thingUniqueKeyFilter('agentReportingOperation', reportingDigest([binding.shareId, activeId])) } as any) : null;
      const coordinationPost = binding.crystal.coordinationPostId ? requireOk(await getThing(ownerViewer, binding.crystal.coordinationPostId)).thing : null;
      return { ok: true, binding: safeBinding(binding), records, coordinationPost,
        activeOperation: activeId ? { requestId: activeId, status: active?.crystal.status || 'unknown',
          createdIds: active?.crystal.createdIds || [], mutationAttempted: active?.crystal.mutationAttempted === true } : null };

    }
    if (input.operation === 'coordinate') return await coordinateReporting({ things, binding, filter, ownerId, ownerViewer, character: verified.character, viewer: verified.viewer, assertOwner, input });
    if (input.operation !== 'report') return fail(400, 'operation must be prepare, get, report or coordinate');
    if (!ref(input.requestId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
        !Object.hasOwn(REPORT_ACTION_ROLES, input.actionName) || !input.inputs || typeof input.inputs !== 'object' || Array.isArray(input.inputs))
      return fail(400, 'A stable UUID requestId, reporting actionName and object inputs are required');
    const actionName = input.actionName as ReportAction;
    if (actionName === 'readOverview') return fail(409, 'Use get for independently authorized task record readback; this endpoint does not execute HTTP Actions');
    const actionId = binding.crystal.workspace.actions[actionName];
    if (!actionId) return fail(409, 'This saved workspace has no configured Action for that reporting operation');
    const receiptKey = reportingDigest([binding.shareId, input.requestId]);
    const receiptFilter = { thingtime: 'agent-reporting-operation', ownerId, ...thingUniqueKeyFilter('agentReportingOperation', receiptKey) };
    const digest = reportingDigest([actionName, input.inputs]);
    const prior = await things.findOne(receiptFilter as any);
    if (prior) return receiptResponse(prior, digest, binding);
    // A task-wide lock serializes different operations as well as duplicate
    // request IDs. No timeout takeover: an interrupted write is ambiguous.
    const locked = await things.updateOne({ ...filter, 'crystal.activeOperation': { $exists: false } } as any, { $set: { 'crystal.activeOperation': input.requestId } });
    if (!locked.modifiedCount) return fail(409, 'Another reporting operation is active or has an uncertain outcome; inspect its receipt before continuing');
    let receipt: any;
    let mutationAttempted = false;
    try {
      binding = await things.findOne({ ...filter, 'crystal.activeOperation': input.requestId } as any);
      if (!binding) throw new ReportingError(409, 'Reporting task changed before execution');
      const raced = await things.findOne(receiptFilter as any);
      if (raced) { receipt = raced; return receiptResponse(raced, digest, binding); }
      receipt = { ...newThingDoc('agent-reporting-operation', { ownerId, targetId: binding.shareId,
        uniqueKeys: [thingUniqueKey('agentReportingOperation', receiptKey)], crystal: { requestId: input.requestId, digest, status: 'pending', actionName } }), storageClass: 'control' };
      try { await things.insertOne(receipt); } catch (error: any) { if (error?.code !== 11000) throw error; return receiptResponse(await things.findOne(receiptFilter as any), digest, binding); }
      const policy = reportingPolicy(things, binding, verified.character, owner.username, actionName, input.requestId, async ids => {
        mutationAttempted = true;
        await things.updateOne(receiptFilter as any, { $set: { 'crystal.mutationAttempted': true, 'crystal.createdIds': ids } });
      });
      const result = await runAction(verified.viewer, { action: actionId, inputs: input.inputs }, undefined, {
        assertAuthorized: async () => { await assertOwner(); await verifyBinding(binding, ownerId, ownerViewer); }, operationPolicy: policy
      });
      if (result.ok === false || result.status !== 'ok') {
        await things.updateOne(receiptFilter as any, { $set: { 'crystal.status': 'failed', 'crystal.noDataEffects': !mutationAttempted, updatedAt: new Date() } });
        return fail(result.ok === false ? result.status : 409, ('error' in result && result.error) || 'Saved reporting Action did not complete; this request will not be replayed');
      }
      // Read all new rows independently; do not trust a saved Action's return
      // value to nominate a foreign task or substitute a public artifact.
      const ids = policy.createdIds;
      const records = { ...binding.crystal.records };
      for (const id of ids) {
        const doc = await things.findOne({ shareId: id, ownerId: String(verified.character._id), thingtime: 'data' } as any);
        if (!doc || !privateReportingAcl(doc.acl) || !(await getThing(ownerViewer, id)).ok) throw new ReportingError(409, 'Reporting readback failed');
        for (const role of ['project', 'task', 'agent'] as const) if (doc.crystal?.schemaId === binding.crystal.workspace.schemas[role]) records[`${role}Id`] = id;
      }
      await assertOwner(); await verifyBinding(binding, ownerId, ownerViewer);
      await things.updateOne(filter as any, { $set: { 'crystal.records': records, updatedAt: new Date() } });
      binding.crystal.records = records;
      await things.updateOne(receiptFilter as any, { $set: { 'crystal.status': 'complete', 'crystal.result': { ids }, updatedAt: new Date() } });
      return { ok: true, binding: safeBinding(binding), receipt: { requestId: input.requestId, status: 'complete', result: { ids } } };
    } finally {
      // Release only complete operations or failures proven to precede every
      // data mutation. Ambiguous outcomes require explicit reconciliation.
      if (receipt) {
        const final = await things.findOne(receiptFilter as any);
        if (final?.crystal.status === 'complete' || (final?.crystal.status === 'failed' && final.crystal.noDataEffects === true)) await things.updateOne({ ...filter, 'crystal.activeOperation': input.requestId } as any, { $unset: { 'crystal.activeOperation': '' } });
      }
    }
  } catch (error) {
    if (error instanceof ReportingError) return fail(error.status, error.message);
    return fail(503, 'Private reporting could not complete; inspect the stable request receipt before retrying');
  }
}

function receiptResponse(receipt: any, digest: string, binding: any) {
  if (receipt.crystal.digest !== digest) return fail(409, 'This requestId belongs to a different immutable reporting payload');
  if (receipt.crystal.status !== 'complete') return fail(409, `Reporting operation is ${receipt.crystal.status}; it will not be replayed`);
  return { ok: true, binding: safeBinding(binding), receipt: { requestId: receipt.crystal.requestId, status: 'complete', result: receipt.crystal.result } };
}
const referenceIds = (workspace: ReportingWorkspace): string[] => [...new Set([...Object.values(workspace.pages), ...Object.values(workspace.schemas), ...Object.values(workspace.actions)])] as string[];
async function requirePrivateReference(ownerId: string, viewer: Viewer, id: string, kind?: string) {
  const raw = await (await getThingsCollection()).findOne({ shareId: id, ownerId } as any);
  if (!raw || raw.appId || raw.targetId || !privateReportingAcl(raw.acl) || (kind && !raw.thingtime.includes(kind)) || !(await getThing(viewer, id)).ok)
    throw new ReportingError(403, 'Reporting references must be exact, accessible, owner-private saved Things of the expected kind');
  return raw;
}
async function verifyWorkspace(ownerId: string, viewer: Viewer, workspace: ReportingWorkspace) {
  for (const id of Object.values(workspace.pages)) await requirePrivateReference(ownerId, viewer, id, 'webpage');
  for (const id of Object.values(workspace.schemas)) await requirePrivateReference(ownerId, viewer, id, 'schema');
  for (const id of Object.values(workspace.actions)) await requirePrivateReference(ownerId, viewer, id!, 'action');
}
async function requireLiveCharacter(binding: any, ownerId: string) {
  const character = await findUserById(binding.crystal.characterId);
  const identity = characterIdentity(character);
  if (!character || identity?.ownerId !== ownerId || identity.loginMode !== 'switch' || identity.disabled)
    throw new ReportingError(403, 'Task Character is disabled, revoked, or no longer owned by this account');
  return character;
}
async function verifyBinding(binding: any, ownerId: string, ownerViewer: Viewer) {
  const character = await requireLiveCharacter(binding, ownerId);
  const workspace: ReportingWorkspace = binding.crystal.workspace;
  const subspace = await findSubspaceById(workspace.subspaceId);
  if (!subspace || accessOf(subspace) !== 'private' || !canModerate(await membershipOf(workspace.subspaceId!, ownerId)) ||
      !isActiveMember(await membershipOf(workspace.subspaceId!, String(character._id)))) throw new ReportingError(403, 'Private coordination membership or administration was revoked');
  await verifyWorkspace(ownerId, ownerViewer, workspace);
  const viewer: Viewer = { id: String(character._id), username: character.username };
  for (const id of referenceIds(workspace)) if (!(await getThing(viewer, id)).ok) throw new ReportingError(403, 'Task Character workspace access was revoked');
  if (binding.crystal.parent) {
    const parent = binding.crystal.parent;
    const parentBinding = await (await getThingsCollection()).findOne({ shareId: parent.bindingId, thingtime: 'agent-reporting-binding', ownerId } as any);
    if (!parentBinding?.crystal.prepared || parentBinding.crystal.characterId !== parent.characterId || parentBinding.crystal.records?.taskId !== parent.taskId ||
        parentBinding.crystal.records?.projectId !== parent.projectId || parent.projectCharacterId !== (parentBinding.crystal.parent?.projectCharacterId || parentBinding.crystal.characterId) || reportingDigest(parentBinding.crystal.workspaceRequest) !== reportingDigest(binding.crystal.workspaceRequest))
      throw new ReportingError(403, 'Parent task binding is no longer available in this private workspace');
    const parentCharacter = await requireLiveCharacter(parentBinding, ownerId);
    const projectCharacter = await requireLiveCharacter({ crystal: { characterId: parent.projectCharacterId } }, ownerId);
    await requirePrivateReference(String(projectCharacter._id), { id: String(projectCharacter._id), username: projectCharacter.username }, parent.projectId, 'data');
    if (!isActiveMember(await membershipOf(workspace.subspaceId!, String(projectCharacter._id)))) throw new ReportingError(403, 'Project Character membership was revoked');
    if (!isActiveMember(await membershipOf(workspace.subspaceId!, String(parentCharacter._id)))) throw new ReportingError(403, 'Parent task Character membership was revoked');
    for (const id of [parent.projectId, parent.taskId]) if (!(await getThing(viewer, id)).ok) throw new ReportingError(403, 'Child task access to its exact parent roots was revoked');
  }
  return { character, viewer };
}
async function resolveReportingSubspace(viewer: Viewer, workspace: ReportingWorkspace) {
  if (workspace.subspaceId) return findSubspaceById(workspace.subspaceId);
  if (workspace.subspaceSlug) return findSubspaceBySlug(workspace.subspaceSlug);
  const page = requireOk(await listSubspaces(viewer, { mine: true, q: 'Thingtime Agents', limit: 50 }));
  const exact = page.subspaces.filter((entry: any) => entry.name === 'Thingtime Agents');
  if (exact.length !== 1 || page.nextCursor) throw new ReportingError(409, 'The existing private Thingtime Agents subspace could not be identified uniquely; pass its exact ID');
  return findSubspaceById(exact[0].id);
}

function reportingPolicy(things: any, binding: any, character: any, ownerUsername: string, actionName: ReportAction, requestId: string, onAttempt: (ids: string[]) => Promise<void> = async () => {}): ActionOperationPolicy & { createdIds: string[] } {
  const workspace: ReportingWorkspace = binding.crystal.workspace;
  const schemaIds = Object.values(workspace.schemas);
  const createdIds: string[] = [];
  const role = REPORT_ACTION_ROLES[actionName];
  const records = binding.crystal.records || {};
  const primaryUpdate = actionName === 'updateWorkItem' || actionName.startsWith('record');
  const creates = ['createProject', 'createTask', 'createAgent', 'addTodo', 'addProgress', 'askQuestion'].includes(actionName);
  return {
    createdIds,
    step: async op => { if (!['return', 'compute', 'fail', 'things.get', 'things.search', 'things.update', 'things.create'].includes(op)) throw new ReportingError(403, 'This operation is outside private reporting'); },
    create: async (schemaId, values, step) => {
      if (!creates || !role || schemaId !== workspace.schemas[role] || (['project', 'task', 'agent'].includes(role) && records[`${role}Id`])) throw new ReportingError(409, 'This task already has that reporting record or the Action creates the wrong schema');
      if (createdIds.length) throw new ReportingError(403, 'A reporting operation creates one relational record');
      const id = reportingUuid(`${binding.shareId}:${requestId}:${step}`);
      const crystal: Record<string, unknown> = { ...values };
      if (role !== 'project' && records.projectId) crystal.projectId = records.projectId;
      if (role !== 'project' && !records.projectId && crystal.projectId) throw new ReportingError(403, 'Reporting project must belong to this binding');
      if (role !== 'project' && role !== 'task') {
        if (!records.taskId) throw new ReportingError(409, 'Create the task before its child reporting records');
        crystal.taskId = binding.crystal.parent?.sharedTaskId || records.taskId; crystal.parentId = records.taskId;
      }
      if (['todo', 'progress', 'question'].includes(role!) && records.agentId) crystal.agentId = records.agentId;
      else if (crystal.agentId) throw new ReportingError(403, 'Reporting agent must belong to this binding');
      if (role === 'project' && (crystal.parentId || crystal.projectId || crystal.taskId)) throw new ReportingError(403, 'Project roots cannot refer to foreign reporting records');
      if (role === 'task' && !records.projectId && crystal.projectId) throw new ReportingError(403, 'Task project must belong to this reporting binding');
      if (role === 'task' && !binding.crystal.parent) delete crystal.taskId;
      if (role === 'task' && binding.crystal.parent) { crystal.parentId = binding.crystal.parent.taskId; crystal.taskId = binding.crystal.parent.sharedTaskId; }
      if (role === 'task' && crystal.parentId && crystal.parentId !== (binding.crystal.parent?.taskId || records.projectId)) throw new ReportingError(403, 'Task parent must belong to this reporting binding');
      createdIds.push(id);
      await onAttempt([...createdIds]);
      return { shareId: id, acl: ['tt:user', 'tt:custom', `tt:user/${ownerUsername}/write`], crystal };
    },
    access: async (id, operation) => {
      const parentRoot = binding.crystal.parent && [binding.crystal.parent.projectId, binding.crystal.parent.taskId].includes(id);
      if (parentRoot && operation !== 'read') throw new ReportingError(403, 'Child reporting cannot update parent task or project roots');
      const doc = await things.findOne({ shareId: id, ownerId: parentRoot ? (id === binding.crystal.parent.projectId ? binding.crystal.parent.projectCharacterId : binding.crystal.parent.characterId) : String(character._id), thingtime: 'data' });
      if (!doc || !schemaIds.includes(doc.crystal?.schemaId) || !privateReportingAcl(doc.acl)) throw new ReportingError(403, 'Reporting may access only this task Character’s private workspace records');
      if (operation === 'update' && (creates || (!primaryUpdate && (!role || doc.crystal.schemaId !== workspace.schemas[role])) || (primaryUpdate && !(['project', 'task', 'agent'] as const).some(key => workspace.schemas[key] === doc.crystal.schemaId)))) throw new ReportingError(403, 'This Action updates the wrong reporting role');
      if (operation === 'update' && (primaryUpdate || ['project', 'task', 'agent'].includes(role!)) && !Object.values(records).includes(id)) throw new ReportingError(403, 'This record is not bound to the task');
    },
    update: async (id, values) => {
      const doc = await things.findOne({ shareId: id, ownerId: String(character._id), thingtime: 'data' });
      for (const field of ['parentId', 'projectId', 'taskId', 'agentId', 'schema', 'schemaId'])
        if (Object.hasOwn(values, field) && values[field] !== doc?.crystal?.[field]) throw new ReportingError(403, 'Reporting cannot reparent or relabel a workspace record');
      await onAttempt([...createdIds]);
    },
    search: async (schema, searchScope) => { if ((searchScope && searchScope !== 'own') || !schemaIds.includes(String(schema))) throw new ReportingError(403, 'Reporting search requires an exact workspace schema and own scope'); }
  };
}

/** Coordination follows the existing private-subspace contract. It never
 * changes subspace visibility; a later deliberate owner visibility change
 * retains its ordinary product semantics, and further reporting is refused. */
async function coordinateReporting(context: {
  things: any; binding: any; filter: any; ownerId: string; ownerViewer: Viewer; character: any; viewer: Viewer;
  assertOwner: () => Promise<void>; input: any;
}) {
  const { things, filter, ownerId, ownerViewer, character, viewer, assertOwner, input } = context;
  let binding = context.binding;
  if (!ref(input.requestId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
      !ref(input.title) || !ref(input.text) || !input.renderComponent || typeof input.renderComponent !== 'object' || Array.isArray(input.renderComponent))
    return fail(400, 'Coordination requires a stable UUID requestId, title, text and explicit renderComponent');
  if (input.renderComponent.id !== undefined) {
    if (!ref(input.renderComponent.id)) return fail(400, 'renderComponent.id must reference an accessible saved Component');
    const component = requireOk(await getThing(viewer, input.renderComponent.id)).thing;
    if (!component.thingtime.includes('component') || !(await getThing(ownerViewer, input.renderComponent.id)).ok)
      return fail(403, 'The task Character and owner require access to the saved render Component');
  }
  const digest = reportingDigest({ operation: 'coordinate', title: input.title, text: input.text, renderComponent: input.renderComponent });
  const receiptKey = reportingDigest([binding.shareId, input.requestId]);
  const receiptFilter = { thingtime: 'agent-reporting-operation', ownerId, ...thingUniqueKeyFilter('agentReportingOperation', receiptKey) };
  const prior = await things.findOne(receiptFilter as any);
  if (prior) return receiptResponse(prior, digest, binding);
  const locked = await things.updateOne({ ...filter, 'crystal.activeOperation': { $exists: false } } as any, { $set: { 'crystal.activeOperation': input.requestId } });
  if (!locked.modifiedCount) return fail(409, 'Another reporting operation is active or has an uncertain outcome; inspect its receipt before continuing');
  let receipt: any, attempted = false;
  try {
    binding = await things.findOne({ ...filter, 'crystal.activeOperation': input.requestId } as any);
    if (!binding) throw new ReportingError(409, 'Reporting task changed before coordination');
    const raced = await things.findOne(receiptFilter as any);
    if (raced) { receipt = raced; return receiptResponse(raced, digest, binding); }
    receipt = { ...newThingDoc('agent-reporting-operation', { ownerId, targetId: binding.shareId,
      uniqueKeys: [thingUniqueKey('agentReportingOperation', receiptKey)], crystal: { requestId: input.requestId, digest, status: 'pending', actionName: 'coordinate' } }), storageClass: 'control' };
    try { await things.insertOne(receipt); } catch (error: any) { if (error?.code !== 11000) throw error; return receiptResponse(await things.findOne(receiptFilter as any), digest, binding); }
    await assertOwner(); await verifyBinding(binding, ownerId, ownerViewer);
    const postId = binding.crystal.coordinationPostId || reportingUuid(`${binding.shareId}:coordination-post`);
    const crystal = { type: 'text', title: input.title, text: input.text, subspaceId: binding.crystal.workspace.subspaceId, renderComponent: input.renderComponent };
    if (binding.crystal.coordinationPostId) {
      const priorPost = await things.findOne({ shareId: postId, ownerId: String(character._id), thingtime: 'post' } as any);
      if (!priorPost || priorPost.subspacePrivate !== true || priorPost.crystal?.subspaceId !== crystal.subspaceId) throw new ReportingError(403, 'Coordination post no longer belongs to this exact private task subspace');
    }
    attempted = true;
    await things.updateOne(receiptFilter as any, { $set: { 'crystal.mutationAttempted': true, 'crystal.createdIds': [postId] } });
    const written = binding.crystal.coordinationPostId
      ? await updateThing(viewer, postId, { crystal })
      : await createThing(String(character._id), { shareId: postId, thingtime: ['post'], acl: ['tt:all'], crystal }, viewer);
    if (written.ok === false) attempted = false;
    requireOk(written);
    await assertOwner(); await verifyBinding(binding, ownerId, ownerViewer);
    const saved = await things.findOne({ shareId: postId, ownerId: String(character._id), thingtime: 'post' } as any);
    if (!saved || saved.subspacePrivate !== true || saved.crystal?.subspaceId !== crystal.subspaceId || !saved.crystal?.renderComponent ||
        !(await getThing(viewer, postId)).ok || !(await getThing(ownerViewer, postId)).ok || (await getThing(null, postId)).ok)
      throw new ReportingError(409, 'Private coordination post readback or audience verification failed');
    await things.updateOne(filter as any, { $set: { 'crystal.coordinationPostId': postId, updatedAt: new Date() } });
    binding.crystal.coordinationPostId = postId;
    await things.updateOne(receiptFilter as any, { $set: { 'crystal.status': 'complete', 'crystal.result': { ids: [postId] }, updatedAt: new Date() } });
    return { ok: true, binding: safeBinding(binding), receipt: { requestId: input.requestId, status: 'complete', result: { ids: [postId] } } };
  } catch (error) {
    if (!attempted && receipt) await things.updateOne(receiptFilter as any, { $set: { 'crystal.status': 'failed', 'crystal.noDataEffects': true } });
    if (error instanceof ReportingError) return fail(error.status, error.message);
    return fail(503, 'Coordination outcome is uncertain; inspect the stable reporting receipt before continuing');
  } finally {
    if (receipt) {
      const final = await things.findOne(receiptFilter as any);
      if (final?.crystal.status === 'complete' || final?.crystal.noDataEffects === true)
        await things.updateOne({ ...filter, 'crystal.activeOperation': input.requestId } as any, { $unset: { 'crystal.activeOperation': '' } });
    }
  }
}
