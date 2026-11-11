import { AsyncLocalStorage } from 'node:async_hooks';
import type { ObjectId } from 'mongodb';
import { currentUserIdentityRepository } from '../auth/userIdentityRepository';
import { assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import type { EmailProvider, EmailStream } from './config';
import type { EmailDeliveryInput, EmailStatus } from './types';
export type EmailMessageId = string | ObjectId;
export type EmailMessageRecord = {
 provider: EmailProvider; stream: EmailStream; templateKey: string | null; status: EmailStatus;
 from: string; replyTo: string | null; to: string[]; subject: string; html: string; text: string;
 sensitive: boolean; metadata: Record<string, unknown>; tags: Record<string, string>;
 schemaVersion: number; createdAt: Date; updatedAt: Date;
};
export type ImmediateEmailOutcome = {
 sentAt?: Date | null; loggedAt?: Date | null; providerMessageId?: string | null;
 suppressedRecipients?: string[]; skippedAt?: Date; skippedReason?: string; failedAt?: Date; error?: string;
};
export type EmailEventRecord = {
 eventType: string; emailMessageId: string | null; providerMessageId: string | null;
 email: string | null; payload: Record<string, unknown>; receivedAt: Date; createdAt: Date;
};
export interface EmailRepository {
 readonly kind: 'mongo-home' | 'native-home'; readonly homePlaneId: string;
 enqueue(record: EmailMessageRecord, payload: EmailDeliveryInput, requestId?: string): Promise<{ id: EmailMessageId; status: EmailStatus }>;
 finishImmediate(id: EmailMessageId, status: EmailStatus, fields: ImmediateEmailOutcome): Promise<void>;
 suppressed(recipients: readonly string[], stream: EmailStream): Promise<string[]>;
 recordEvent(record: EmailEventRecord): Promise<void>;
 suppress(email: string, reason: string, payload: Record<string, unknown>, now: Date): Promise<void>;
 unsubscribe(email: string, listId: string, source: string, now: Date): Promise<void>;
}
/** Runtime must supply protected profile bytes; no default/env credential source. */
export interface EmailOutboxKeyProvider {
 readonly homePlaneId: string; readonly keyId: string;
 withKey<T>(work: (key: Uint8Array) => T): T;
}
export class EmailRepositoryError extends Error {
 constructor(public readonly code: string, message: string) { super(message); this.name='EmailRepositoryError'; }
}
const unavailable=():never=>{throw new EmailRepositoryError('EMAIL_REPOSITORY_SCOPE','Email repository does not match the active native home/lifetime');};
const scopes=new AsyncLocalStorage<{repository:EmailRepository;active:boolean}>();
function assertIdentity(repository:EmailRepository) {
 const identity=currentUserIdentityRepository();
 if(identity){if(identity.homePlaneId!==repository.homePlaneId)unavailable();assertSameHomeRepositoryProvider(identity,repository);}
}
export function assertEmailRepositoryScope(repository:EmailRepository):void {
 const scope=scopes.getStore();if(!scope?.active||scope.repository!==repository)unavailable();assertIdentity(repository);
}
export async function withHomeEmailRepository<T>(repository:EmailRepository,homePlaneId:string,work:()=>T|Promise<T>):Promise<T> {
 if(scopes.getStore()||typeof homePlaneId!=='string'||!homePlaneId||repository.homePlaneId!==homePlaneId)unavailable();
 assertIdentity(repository);const scope={repository,active:true};
 return scopes.run(scope,async()=>{try{return await work();}finally{scope.active=false;}});
}
function assertMongo() { const scope=scopes.getStore();if((scope&&(!scope.active||scope.repository.kind==='native-home'))||currentUserIdentityRepository())unavailable(); }
const mongo:EmailRepository=Object.freeze({
 kind:'mongo-home',homePlaneId:'mongodb:home',
 async enqueue(record:EmailMessageRecord,_payload:EmailDeliveryInput,requestId?:string){
  assertMongo();if(requestId!==undefined)throw new EmailRepositoryError('EMAIL_IDEMPOTENCY_UNSUPPORTED','Hosted immediate email does not support queued idempotency');
  const {getEmailMessagesCollection}=await import('../mongodb/collections');
  const result=await(await getEmailMessagesCollection()).insertOne(record);return {id:result.insertedId,status:record.status};
 },
 async finishImmediate(id:EmailMessageId,status:EmailStatus,fields:ImmediateEmailOutcome){
  assertMongo();const {getEmailMessagesCollection}=await import('../mongodb/collections');
  await(await getEmailMessagesCollection()).updateOne({_id:id as ObjectId},{$set:{status,updatedAt:new Date(),...fields}});
 },
 async suppressed(recipients:readonly string[],stream:EmailStream){
  assertMongo();const {getEmailSuppressionListCollection,getEmailUnsubscribesCollection}=await import('../mongodb/collections');
  const rows=await(await getEmailSuppressionListCollection()).find({email:{$in:[...recipients]},active:{$ne:false}}).project({email:1}).toArray();
  const suppressed=new Set(rows.map(row=>typeof row.email==='string'?row.email.trim().toLowerCase():'').filter(Boolean));
  if(stream==='newsletter')for(const row of await(await getEmailUnsubscribesCollection()).find({email:{$in:[...recipients]}}).project({email:1}).toArray())if(typeof row.email==='string')suppressed.add(row.email.trim().toLowerCase());
  return recipients.filter(email=>suppressed.has(email));
 },
 async recordEvent(record:EmailEventRecord){assertMongo();const {getEmailEventsCollection}=await import('../mongodb/collections');await(await getEmailEventsCollection()).insertOne(record);},
 async suppress(email:string,reason:string,payload:Record<string,unknown>,now:Date){
  assertMongo();const {getEmailSuppressionListCollection}=await import('../mongodb/collections');
  await(await getEmailSuppressionListCollection()).updateOne({email},{$set:{email,reason,payload,active:true,updatedAt:now},$setOnInsert:{createdAt:now}},{upsert:true});
 },
 async unsubscribe(email:string,listId:string,source:string,now:Date){
  assertMongo();const {getEmailUnsubscribesCollection}=await import('../mongodb/collections');
  await(await getEmailUnsubscribesCollection()).updateOne({email,listId},{$set:{email,listId,source,unsubscribedAt:now,updatedAt:now},$setOnInsert:{createdAt:now}},{upsert:true});
 }
});
export function currentEmailRepository():EmailRepository {
 const scope=scopes.getStore();if(scope){if(!scope.active)unavailable();assertIdentity(scope.repository);return scope.repository;}
 if(currentUserIdentityRepository())unavailable();return mongo;
}
