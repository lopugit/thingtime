import { createHash, createHmac, randomUUID } from 'node:crypto';
import { BSON, type ObjectId } from 'mongodb';
import { encryptOwnerValueWithKey, decryptOwnerValueWithKey, type EncryptedVaultValue } from '../auth/vaultCipher';
import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertEmailRepositoryScope, EmailRepositoryError, type EmailRepository, type EmailMessageRecord, type EmailOutboxKeyProvider } from '../email/repository';
import type { EmailDeliveryInput, EmailStatus } from '../email/types';
import type { EmailStream } from '../email/config';
import type { CollectionProvider, CollectionTransaction, NativeCollection } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';
const PURPOSE='thingtime-native-email-outbox:v1:';
const REDACTED='[redacted: single-use secret]';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const eq=(path:string,value:string)=>({op:'eq' as const,path:[path],value});
const nowAt=(now:Date)=>{const value=now instanceof Date?Date.prototype.getTime.call(now):NaN;if(!Number.isFinite(value))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','Valid queue time required');return Math.max(value,Date.now());};
type StoredQueueMessage=EmailMessageRecord&{_id:string;fingerprint:string;keyId:string;encryptedPayload:EncryptedVaultValue|null;attempts:number;nextAttemptAt:Date;leaseToken:string|null;leaseWorker:string|null;leaseExpiresAt:Date|null};
export type NativeEmailRetryReason='TRANSPORT_UNAVAILABLE'|'TEMPORARY_TRANSPORT_FAILURE'|'DELIVERY_UNCONFIRMED';
export type NativeEmailLease={id:string;token:string;workerId:string;expiresAt:Date};
export interface NativeEmailRepository extends EmailRepository {
 claim(workerId:string,leaseMs:number,now?:Date):Promise<NativeEmailLease|null>;
 delivery(lease:NativeEmailLease,now?:Date):Promise<EmailDeliveryInput|null>;
 defer(lease:NativeEmailLease,notBefore:Date,errorCode:NativeEmailRetryReason,now?:Date):Promise<boolean>;
 sent(lease:NativeEmailLease,providerMessageId:string,now?:Date):Promise<boolean>;
 read(id:string):Promise<EmailMessageRecord&{id:string;attempts:number}|null>;
}
/** Local queue only. A required caller-owned protected key source encrypts
 * replay payloads; no environment/global Mongo key or transport is selected. */
export async function createNativeEmailRepository(provider:CollectionProvider,homePlaneId:string,keys:EmailOutboxKeyProvider):Promise<NativeEmailRepository> {
 if(typeof homePlaneId!=='string'||!homePlaneId||!keys||keys.homePlaneId!==homePlaneId||typeof keys.keyId!=='string'||!keys.keyId||typeof keys.withKey!=='function')throw new EmailRepositoryError('EMAIL_KEY_UNAVAILABLE','An explicit protected native email key provider is required');
 const keyId=keys.keyId,withKey=keys.withKey.bind(keys);
 const authenticate=(purpose:string,value:string|Uint8Array)=>withKey(key=>{
  if(!(key instanceof Uint8Array)||key.byteLength!==32)throw new EmailRepositoryError('EMAIL_KEY_UNAVAILABLE','A protected 32-byte outbox key is required');
  return createHmac('sha256',key).update(JSON.stringify([purpose,homePlaneId])).update('\0').update(value).digest('hex');
 });

 const names={messages:physicalCollectionName('email_messages'),events:physicalCollectionName('email_events'),suppression:physicalCollectionName('email_suppression_list'),unsubscribes:physicalCollectionName('email_unsubscribes')};
 await provider.transaction(s=>{for(const name of Object.values(names))s.defineCollection(name,{unique:[]});});
 let repository:NativeEmailRepository;
 const transaction=<T>(work:(s:CollectionTransaction)=>T|Promise<T>):Promise<T>=>{
  assertEmailRepositoryScope(repository);
  return provider.transaction(async s=>{assertEmailRepositoryScope(repository);const result=await work(s);assertEmailRepositoryScope(repository);return result;});
 };
 const rows=<T>(collection:NativeCollection)=>{
  const result:T[]=[];let after: string|ObjectId|undefined;
  do{const page=collection.find({limit:128,...(after===undefined?{}:{after})});for(const bytes of page.documents)result.push(BSON.deserialize(bytes) as T);after=page.nextAfter??undefined;}while(after!==undefined);return result;
 };
 const read=<T=Record<string,unknown>>(collection:NativeCollection,id:string):T|null=>{const bytes=collection.find({filter:eq('_id',id),limit:1}).documents[0];return bytes?BSON.deserialize(bytes) as T:null;};
 const suppression=(s:CollectionTransaction,recipients:readonly string[],stream:EmailStream)=>{
  const blocked=new Set(rows<{email:string;active?:boolean}>(s.collection(names.suppression)).filter(row=>row.active!==false).map(row=>row.email));
  if(stream==='newsletter')for(const row of rows<{email:string}>(s.collection(names.unsubscribes)))blocked.add(row.email);
  return recipients.filter(email=>blocked.has(email));
 };
 const leaseSnapshot=(lease:NativeEmailLease):NativeEmailLease=>{
  const row=BSON.deserialize(encodeCollectionDocument(lease,'id'));
  if(typeof row.id!=='string'||!row.id||typeof row.token!=='string'||!row.token||typeof row.workerId!=='string'||!row.workerId||!(row.expiresAt instanceof Date)||!Number.isFinite(row.expiresAt.getTime()))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','Invalid delivery lease');
  return {id:row.id,token:row.token,workerId:row.workerId,expiresAt:row.expiresAt};
 };
 const validLease=(row:StoredQueueMessage|null,lease:NativeEmailLease,at:number)=>row&&row.status==='queued'&&row.leaseToken===lease.token&&row.leaseWorker===lease.workerId&&row.leaseExpiresAt instanceof Date&&row.leaseExpiresAt.getTime()>at;
 const update=(collection:NativeCollection,id:string,fields:Record<string,unknown>)=>collection.updateOne(eq('_id',id),Object.entries(fields).map(([name,value])=>({op:'set' as const,path:[name],value})));
 const upsert=(collection:NativeCollection,id:string,fields:Record<string,unknown>,at:Date)=>{
  if(read(collection,id))update(collection,id,{...fields,updatedAt:at});else collection.insert(encodeCollectionDocument({_id:id,...fields,createdAt:at,updatedAt:at}));
 };
 repository=Object.freeze({
  kind:'native-home' as const,homePlaneId,
  async enqueue(inputRecord,inputPayload,requestId){
   assertEmailRepositoryScope(repository);
   if(requestId!==undefined&&(typeof requestId!=='string'||!requestId))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','An immutable request identity is required');
   const id=requestId===undefined?randomUUID():`request:${authenticate('native-email-request:v1',requestId)}`;
   // Canonical codec validates before hashing/encrypting may read data hooks.
   const snapshot=BSON.deserialize(encodeCollectionDocument({_id:id,record:inputRecord,payload:inputPayload}));
   const record=snapshot.record as EmailMessageRecord,payload=snapshot.payload as EmailDeliveryInput;
   const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
   if(!['console','ses'].includes(record.provider)||!['transactional','newsletter','notification'].includes(record.stream)||record.status!=='queued'||typeof record.sensitive!=='boolean'||!Array.isArray(record.to)||!record.to.length||record.to.some(email=>typeof email!=='string'||!email||email!==email.trim().toLowerCase())||new Set(record.to).size!==record.to.length||typeof record.from!=='string'||!record.from||typeof record.subject!=='string'||typeof payload.html!=='string'||typeof payload.text!=='string'||payload.from!==record.from||payload.subject!==record.subject||!same(payload.to,record.to)||!same(payload.tags??{},record.tags)||payload.replyTo!==(record.replyTo??undefined)||!(record.createdAt instanceof Date)||!Number.isFinite(record.createdAt.getTime())||!(record.updatedAt instanceof Date)||!Number.isFinite(record.updatedAt.getTime())||(!record.sensitive&&(record.html!==payload.html||record.text!==payload.text)))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','A canonical immutable email payload is required');

   if(record.sensitive&&(record.html!==REDACTED||record.text!==REDACTED))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','Sensitive outbox projection must be redacted');
   // A public plaintext digest would permit offline guessing of short OTPs.
   const fingerprint=authenticate('native-email-idempotency:v1',encodeCollectionDocument({_id:'payload',record:{...record,createdAt:new Date(0),updatedAt:new Date(0)},payload}));
   return transaction(s=>{
    const collection=s.collection(names.messages),existing=read<StoredQueueMessage>(collection,id);
    if(existing){if(existing.keyId!==keyId)throw new EmailRepositoryError('EMAIL_KEY_UNAVAILABLE','Stored outbox key is unavailable');if(existing.fingerprint!==fingerprint)throw new EmailRepositoryError('EMAIL_IDEMPOTENCY_CONFLICT','Request identity has a different immutable email payload');return{id,status:existing.status as EmailStatus};}
    const encrypted=withKey(key=>encryptOwnerValueWithKey(PURPOSE,homePlaneId,id,JSON.stringify(payload),key));
    const blocked=suppression(s,record.to,record.stream),status:EmailStatus=blocked.length===record.to.length?'skipped':'queued';
    collection.insert(encodeCollectionDocument({_id:id,...record,status,fingerprint,keyId,encryptedPayload:encrypted,attempts:0,nextAttemptAt:record.createdAt,leaseToken:null,leaseWorker:null,leaseExpiresAt:null,suppressedRecipients:blocked}));
    return {id,status};
   });
  },
  async finishImmediate(){throw new EmailRepositoryError('EMAIL_LEASE_REQUIRED','Native queue outcomes require the current delivery lease');},
  async suppressed(recipients,stream){return transaction(s=>suppression(s,recipients,stream));},
  async recordEvent(record){const bytes=encodeCollectionDocument({_id:randomUUID(),...record});await transaction(s=>s.collection(names.events).insert(bytes));},
  async suppress(email,reason,payload,now){const snapshot=BSON.deserialize(encodeCollectionDocument({_id:email,email,reason,payload})),captured=nowAt(now);await transaction(s=>upsert(s.collection(names.suppression),email,{email,reason,payload:snapshot.payload,active:true},new Date(Math.max(captured,Date.now()))));},
  async unsubscribe(email,listId,source,now){const id=hash(JSON.stringify([email,listId]));encodeCollectionDocument({_id:id,email,listId,source});const captured=nowAt(now);await transaction(s=>{const at=new Date(Math.max(captured,Date.now()));upsert(s.collection(names.unsubscribes),id,{email,listId,source,unsubscribedAt:at},at);});},
  async claim(workerId,leaseMs,now=new Date()){
   if(typeof workerId!=='string'||!workerId||!Number.isSafeInteger(leaseMs)||leaseMs<=0)throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','Valid worker and lease duration required');
   const captured=nowAt(now);
   return transaction(s=>{
    const at=Math.max(captured,Date.now()),collection=s.collection(names.messages);
    for(const row of rows<StoredQueueMessage>(collection).sort((a,b)=>a.nextAttemptAt.getTime()-b.nextAttemptAt.getTime()||a.createdAt.getTime()-b.createdAt.getTime()||a._id.localeCompare(b._id))){
     if(row.status!=='queued'||!(row.nextAttemptAt instanceof Date)||row.nextAttemptAt.getTime()>at||(row.leaseExpiresAt instanceof Date&&row.leaseExpiresAt.getTime()>at))continue;
     const blocked=suppression(s,row.to,row.stream);
     if(blocked.length===row.to.length){update(collection,row._id,{status:'skipped',suppressedRecipients:blocked,updatedAt:new Date(at)});continue;}
     const expiresAt=new Date(at+leaseMs);if(!Number.isFinite(expiresAt.getTime()))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','Invalid lease expiry');
     const token=randomUUID();update(collection,row._id,{leaseToken:token,leaseWorker:workerId,leaseExpiresAt:expiresAt,attempts:row.attempts+1,updatedAt:new Date(at)});
     return{id:row._id,token,workerId,expiresAt};
    }return null;
   });
  },
  async delivery(lease,now=new Date()){
   const frozen=leaseSnapshot(lease);
   const captured=nowAt(now);
   return transaction(s=>{
    const at=Math.max(captured,Date.now()),collection=s.collection(names.messages),row=read<StoredQueueMessage>(collection,frozen.id);
    if(!validLease(row,frozen,at))return null;
    const blocked=suppression(s,row!.to,row!.stream),to=row!.to.filter((email:string)=>!blocked.includes(email));
    if(!to.length){update(collection,frozen.id,{status:'skipped',suppressedRecipients:blocked,updatedAt:new Date(at)});return null;}
    if(row!.keyId!==keyId)throw new EmailRepositoryError('EMAIL_KEY_UNAVAILABLE','Stored outbox key is unavailable');
    const plaintext=withKey(key=>decryptOwnerValueWithKey(PURPOSE,homePlaneId,frozen.id,row!.encryptedPayload as EncryptedVaultValue,key));
    const payload=JSON.parse(plaintext) as EmailDeliveryInput;
    return {...payload,to};
   });
  },
  async defer(lease,notBefore,errorCode,now=new Date()){
   const frozen=leaseSnapshot(lease);
   const captured=nowAt(now),next=notBefore instanceof Date?notBefore.getTime():NaN;
   if(!Number.isFinite(next)||!['TRANSPORT_UNAVAILABLE','TEMPORARY_TRANSPORT_FAILURE','DELIVERY_UNCONFIRMED'].includes(errorCode))throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','Valid retry metadata required');
   return transaction(s=>{const at=Math.max(captured,Date.now()),collection=s.collection(names.messages);if(!validLease(read<StoredQueueMessage>(collection,frozen.id),frozen,at))return false;update(collection,frozen.id,{nextAttemptAt:new Date(Math.max(at,next)),lastErrorCode:errorCode,leaseToken:null,leaseWorker:null,leaseExpiresAt:null,updatedAt:new Date(at)});return true;});
  },
  async sent(lease,providerMessageId,now=new Date()){
   const frozen=leaseSnapshot(lease);
   const captured=nowAt(now);if(typeof providerMessageId!=='string'||!providerMessageId)throw new EmailRepositoryError('EMAIL_QUEUE_INPUT','A real transport receipt is required');
   return transaction(s=>{const at=Math.max(captured,Date.now()),collection=s.collection(names.messages);if(!validLease(read<StoredQueueMessage>(collection,frozen.id),frozen,at))return false;update(collection,frozen.id,{status:'sent',providerMessageId,sentAt:new Date(at),encryptedPayload:null,leaseToken:null,leaseWorker:null,leaseExpiresAt:null,updatedAt:new Date(at)});return true;});
  },
  async read(id){return transaction(s=>{const row=read<StoredQueueMessage>(s.collection(names.messages),id);if(!row)return null;const {encryptedPayload,fingerprint,leaseToken,...publicRow}=row;return {...publicRow,id:row._id} as EmailMessageRecord&{id:string;attempts:number};});}
 });
 registerHomeRepositoryProvider(repository,provider);return repository;
}
