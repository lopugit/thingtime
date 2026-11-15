import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getSettingsCollection } from '../mongodb/collections';
import { runWithHomeMongoEndpoint } from '../mongodb/endpoint';
import { findUserById, fenceCurrentAccountAuthorization } from '../auth/users';
import { characterIdentity } from '../auth/characterCore';
import { isAdminDoc } from '../auth/admin';
import { userOwnsLinkedAccount, fenceOwnedAccountLink } from '../accounts/accountLinks';
import { listGroups, fenceOwnedGroup } from '../groups/groups';
import { createThing, findViewableThing, toPublicThings } from '../things/things';
import { validateThingtimeCrystal } from '~/schemas/registry';
import { sanitizeScheduledRunSummary } from './scheduledRunContext';
import { SCHEDULED_HTTP_JOBS, type ScheduledRunEvent } from './scheduledRunReporting';

export const PLATFORM_REPORTING_SETTINGS_KEY = 'platform-scheduled-run-reporting';
export type PlatformReportingConfig = {
  enabled: boolean; ownerId: string; characterId: string; groupId: string;
  groupOwnerId: string; updatedBy: string; revision: string;
};
export type PlatformReportingInput = Omit<PlatformReportingConfig, 'updatedBy' | 'revision'> & { revision: string | null };
type Dependencies = {
  settings: () => Promise<any>;
  findUser: (id: string) => Promise<any>;
  ownsAccount: (actorId: string, ownerId: string) => Promise<boolean>;
  groups: (ownerId: string) => Promise<{ ok: true; groups: { id: string; name?: string }[] }>;
  create: typeof createThing;
  read: typeof findViewableThing;
  home: typeof runWithHomeMongoEndpoint;
  fenceUser:typeof fenceCurrentAccountAuthorization;
  fenceLink:typeof fenceOwnedAccountLink;
  fenceGroup:typeof fenceOwnedGroup;
};
const defaults: Dependencies = {
  settings: getSettingsCollection, findUser: findUserById, ownsAccount: userOwnsLinkedAccount,
  groups: listGroups, create: createThing, read: async (id,viewer) => {
    const doc=await findViewableThing(id,viewer);
    if (!doc) return null;
    const projected=(await toPublicThings([doc],viewer))[0];
    return {...doc,acl:projected.acl};
  }, home: runWithHomeMongoEndpoint, fenceUser:fenceCurrentAccountAuthorization,fenceLink:fenceOwnedAccountLink,fenceGroup:fenceOwnedGroup
};
const ownerAccount = (user: any) => !!user && !user.meta?.character && user.accountKind !== 'service' && user.meta?.temporary !== true;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(value);
const failure = (status: number, error: string) => ({ ok: false as const, status, error });
const projectedConfig = (row: any): PlatformReportingConfig | null => {
  if (!row || typeof row.enabled !== 'boolean' || ![row.ownerId,row.characterId,row.groupId,row.groupOwnerId,row.updatedBy,row.revision].every(validId)) return null;
  return { enabled:row.enabled,ownerId:row.ownerId,characterId:row.characterId,groupId:row.groupId,groupOwnerId:row.groupOwnerId,updatedBy:row.updatedBy,revision:row.revision };
};
export const platformReportingPostId = (event: ScheduledRunEvent) => `platform-run-${createHash('sha256').update(event.runId).update('\0').update(event.status).digest('hex')}`;

export const createPlatformReporting = (overrides: Partial<Dependencies> = {}) => {
  const deps = { ...defaults, ...overrides };
  const inHome = <T>(fn: () => Promise<T>) => deps.home(fn);
  const getConfig = () => inHome(async () => projectedConfig(await (await deps.settings()).findOne({ key: PLATFORM_REPORTING_SETTINGS_KEY })));
  const authorizedTarget = async (config: Omit<PlatformReportingConfig,'revision'>) => {
    const [actor,owner,character] = await Promise.all([deps.findUser(config.updatedBy),deps.findUser(config.ownerId),deps.findUser(config.characterId)]);
    if (!ownerAccount(actor) || !isAdminDoc(actor) || !ownerAccount(owner)) return false;
    if (config.updatedBy !== config.ownerId && !(await deps.ownsAccount(config.updatedBy,config.ownerId))) return false;
    const identity=characterIdentity(character);
    if (!identity || identity.disabled || identity.ownerId !== config.ownerId) return false;
    if (config.groupOwnerId !== config.updatedBy && config.groupOwnerId !== config.ownerId) return false;
    return (await deps.groups(config.groupOwnerId)).groups.some(group=>group.id===config.groupId);
  };
  const setConfig = (actorId: string, input: PlatformReportingInput) => inHome(async () => {
    if (!input || typeof input.enabled !== 'boolean' || ![input.ownerId,input.characterId,input.groupId,input.groupOwnerId].every(validId) || (input.revision !== null && !validId(input.revision))) return failure(400,'Choose the exact owner, Character and administrator group.');
    const config = {...input,updatedBy:actorId,revision:randomUUID()};
    if (!(await authorizedTarget(config))) return failure(403,'The owner, Character or group is not authorized for platform reporting.');
    const settings=await deps.settings();
    try {
      const saved=await settings.updateOne({key:PLATFORM_REPORTING_SETTINGS_KEY,revision:input.revision},{$set:config,$setOnInsert:{key:PLATFORM_REPORTING_SETTINGS_KEY}},{upsert:input.revision===null});
      if (!saved.matchedCount && !saved.upsertedCount) return failure(409,'Reporting settings changed. Refresh and try again.');
    } catch { return failure(409,'Reporting settings changed or could not be saved. Refresh and try again.'); }
    const stored=await getConfig();
    return stored?.revision===config.revision ? {ok:true as const,config:stored} : failure(409,'Reporting settings changed. Refresh and try again.');
  });
  const reportEvent = (event: ScheduledRunEvent) => inHome(async (): Promise<{status:'recorded'|'disabled'|'unconfigured'|'unavailable';postId?:string}> => {
    try {
      const config=await getConfig();
      if (!config) return {status:'unconfigured'};
      if (!config.enabled) return {status:'disabled'};
      if (!(await authorizedTarget(config))) return {status:'unavailable'};
      const job=SCHEDULED_HTTP_JOBS.find(job=>job.path===event.path && job.name===event.jobName);
      if (!job || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.runId) || !['started','completed','failed','cancelled'].includes(event.status) || !Number.isFinite(Date.parse(event.startedAt)) || !Number.isFinite(Date.parse(event.observedAt)) || !(event.httpCode===null || (Number.isInteger(event.httpCode)&&event.httpCode>=100&&event.httpCode<=599))) return {status:'unavailable'};
      if ((event.parentRunId!==undefined && !/^[0-9a-f-]{36}$/i.test(event.parentRunId)) || (event.scope!==undefined && !['workflow','scheduled-pass'].includes(event.scope))) return {status:'unavailable'};
      const summary=event.summary?sanitizeScheduledRunSummary(event.summary):null;
      const postId=platformReportingPostId(event);
      const acl=['tt:custom','tt:user',`tt:group/${config.groupId}`];
      const metadata={runId:event.runId,parentRunId:event.parentRunId??null,scope:event.scope??'scheduled-pass',path:job.path,status:event.status,httpCode:event.httpCode,startedAt:event.startedAt,summary};
      const textFor=(observedAt:string)=>`${job.name}: ${event.status}.\nScope: ${metadata.scope}\nPath: ${job.path}\nRun: ${event.runId}${event.parentRunId?`\nParent run: ${event.parentRunId}`:''}\nTrigger started: ${event.startedAt}\nObserved: ${observedAt}${event.httpCode===null?'':`\nHTTP status: ${event.httpCode}`}${summary?`\nOutcome: ${summary.outcome}\nCounts: ${Object.entries(summary.counts).map(([key,value])=>key+'='+value).join(', ')||'none reported'}`:''}\nScheduled email results describe queueing; external delivery is separate.`;
      const text=textFor(event.observedAt);
      const draft={type:'text',title:`${job.name} · ${event.status}`,text,renderComponent:{render:{tag:'article',children:[{tag:'h3',children:['{title}']},{tag:'p',props:{style:{whiteSpace:'pre-wrap'}},children:['{text}']}]}}};
      const validated=validateThingtimeCrystal(['post'],draft);
      if (!validated.ok) return {status:'unavailable'};
      const crystal=validated.crystal as typeof draft;
      const viewer={id:config.characterId};
      const matches=(doc:any)=>!!doc && doc.ownerId===config.characterId && Array.isArray(doc.thingtime)&&doc.thingtime.includes('post') && Array.isArray(doc.acl) && isDeepStrictEqual([...new Set(doc.acl)].sort(),[...acl].sort()) && doc.crystal?.type===crystal.type && doc.crystal?.title===crystal.title && isDeepStrictEqual(doc.extended?.platformRun?.metadata,metadata) && Number.isFinite(Date.parse(doc.extended?.platformRun?.observedAt)) && doc.crystal?.text===textFor(doc.extended.platformRun.observedAt) && isDeepStrictEqual(doc.crystal?.renderComponent,crystal.renderComponent);
      const existing=await deps.read(postId,viewer);
      if (existing) return matches(existing)?{status:'recorded',postId}:{status:'unavailable'};
      try { await deps.create(config.characterId,{shareId:postId,thingtime:['post'],acl,crystal,extended:{platformRun:{metadata,observedAt:event.observedAt}}},viewer,null,{afterInsert:async (_doc,session)=>{
        const settings=await deps.settings();
        const held=await settings.updateOne({key:PLATFORM_REPORTING_SETTINGS_KEY,revision:config.revision,enabled:true},{$inc:{platformReportFence:1}},{session});
        if(!held.matchedCount)throw new Error('Platform reporting authorization changed');
        const token=randomUUID();
        const currentAdmin=(user:any)=>ownerAccount(user)&&isAdminDoc(user);
        const currentCharacter=(user:any)=>{const identity=characterIdentity(user);return !!identity&&!identity.disabled&&identity.ownerId===config.ownerId;};
        if(!await deps.fenceUser(config.updatedBy,currentAdmin,session,token)||!await deps.fenceUser(config.ownerId,ownerAccount,session,token)||!await deps.fenceUser(config.characterId,currentCharacter,session,token)||(config.updatedBy!==config.ownerId&&!await deps.fenceLink(config.updatedBy,config.ownerId,session,token))||!await deps.fenceGroup(config.groupOwnerId,config.groupId,session,token))throw new Error('Platform reporting authorization changed');
      }}); }
      catch { /* Resolve a potentially committed write by its exact identity. */ }
      // A duplicate/uncertain create is reconciled by exact-ID readback only.
      const saved=await deps.read(postId,viewer);
      return matches(saved)?{status:'recorded',postId}:{status:'unavailable'};
    } catch { return {status:'unavailable'}; }
  });
  const describeConfig = () => inHome(async () => {
    const config=await getConfig();
    if (!config) return {config:null,owner:null,character:null,group:null,lastReport:null};
    const [owner,character,groups,row]=await Promise.all([deps.findUser(config.ownerId),deps.findUser(config.characterId),deps.groups(config.groupOwnerId), (await deps.settings()).findOne({key:PLATFORM_REPORTING_SETTINGS_KEY})]);
    const group=groups.groups.find(group=>group.id===config.groupId);
    const last=row?.lastReport;
    const lastReport=last && ['recorded','disabled','unconfigured','unavailable'].includes(last.deliveryStatus) && SCHEDULED_HTTP_JOBS.some(job=>job.path===last.path) && typeof last.runId==='string' && /^[0-9a-f-]{36}$/.test(last.runId) && ['started','completed','failed','cancelled'].includes(last.runStatus) && Number.isFinite(Date.parse(last.observedAt)) ? {deliveryStatus:last.deliveryStatus,runId:last.runId,path:last.path,runStatus:last.runStatus,observedAt:last.observedAt,postId:typeof last.postId==='string'&&/^platform-run-[0-9a-f]{64}$/.test(last.postId)?last.postId:null}:null;
    return {config,owner:owner?{id:config.ownerId,username:owner.username??null}:null,character:character?{id:config.characterId,username:character.username??null}:null,group:group?{id:group.id,name:group.name??'Group'}:null,lastReport};
  });
  const report = async (event: ScheduledRunEvent) => {
    const result=await reportEvent(event);
    if (/^[0-9a-f-]{36}$/.test(event.runId) && SCHEDULED_HTTP_JOBS.some(job=>job.path===event.path) && ['started','completed','failed','cancelled'].includes(event.status) && Number.isFinite(Date.parse(event.observedAt))) {
      try { await inHome(async()=>{
        await (await deps.settings()).updateOne({key:PLATFORM_REPORTING_SETTINGS_KEY},{$set:{lastReport:{deliveryStatus:result.status,runId:event.runId,path:event.path,runStatus:event.status,observedAt:event.observedAt,postId:result.postId??null}}});
      }); } catch { /* No raw provider or storage diagnostics leave this boundary. */ }
    }
    return result;
  };
  return {getConfig,describeConfig,setConfig,report};
};
export const platformReporting = createPlatformReporting();
export const platformScheduledRunSink = async (event: Readonly<ScheduledRunEvent>) =>
  (await platformReporting.report(event)).status;
