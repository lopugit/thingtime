import { randomBytes } from 'node:crypto';
import { collectWebpageAttachmentIds } from '../../../components/Builder/webpageAttachmentRefs';
import { thingMetadataRenderComponent } from '../../../components/Things/thingMetadataBlocks';
import { ACL_INHERIT, COLLECTION_SCHEMA_VERSIONS, isProtectedThingtime, MESSENGER_THINGTIME } from '../../../schemas/registry';
import { isThingMetadataReference, THING_METADATA_KIND, type ThingMetadata, type ThingMetadataResponse } from '../../../utils/thingMetadata';
import { ATTACHMENT_THINGTIME, isAttachmentThing, VAULT_ATTACHMENT_PURPOSE } from '../attachments/attachmentCore';
import type { AttachmentDoc } from '../attachments/attachmentStore';
import { getThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { attachmentModerationStatus } from '../moderation/moderationCore';
import { findThingMetadataSource, toPublicThings, type Fail, type ThingDoc, type Viewer } from './things';
import { measureThingJson, storedAttachmentBytes, summarizeThingAttachments } from './thingMetadataCore';

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const notFound = () => fail(404, 'Thing not found');
// The generic cascade owns ordinary content deletion. Other protected
// services have independent lifecycles. File roots are stable and retained.
const canPersistFor = (source: ThingDoc) => {
  const kinds = source.thingtime ?? [];
  return (kinds.length === 1 && kinds[0] === 'file') ||
    (!isProtectedThingtime(kinds) && !kinds.some(kind => (MESSENGER_THINGTIME as readonly string[]).includes(kind)));
};
const isMetadataFor = (saved: ThingDoc | null, source: ThingDoc): saved is ThingDoc =>
  !!saved && isThingMetadataReference(saved.shareId) && saved.ownerId === source.ownerId &&
  saved.targetId === source.shareId && saved.thingtime?.length === 1 && saved.thingtime[0] === THING_METADATA_KIND &&
  saved.storageClass === 'control' && source.thingMetadata?.id === saved.shareId;

const visibleAttachment = (doc: AttachmentDoc, viewer: Viewer) => {
  const status = attachmentModerationStatus(doc);
  return status !== 'blocked' && (status !== 'pending' || viewer?.id === doc.ownerId);
};

async function attachmentBytes(source: ThingDoc, viewer: Viewer, things: Awaited<ReturnType<typeof getThingsCollection>>, session?: any, signal?: AbortSignal) {
  const queryOptions = { ...(session ? { session } : {}), ...(signal ? { signal } : {}) };
  if (source.thingtime?.includes('file')) {
    const content = source.crystal?.content;
    const match = content && typeof content.attachmentId === 'string' && /^[a-f0-9]{64}$/.test(content.version ?? '') && !isCustomMongoEndpointActive();
    const doc = match ? await things.findOne({ shareId: content.attachmentId, ownerId: source.ownerId,
      thingtime: [ATTACHMENT_THINGTIME], targetId: source.shareId, attachmentPurpose: 'file' }, queryOptions) as unknown as AttachmentDoc | null : null;
    const bytes = doc && viewer?.id === source.ownerId && visibleAttachment(doc, viewer) ? storedAttachmentBytes(doc, content.version) : null;
    return summarizeThingAttachments([bytes]);
  }
  if (isAttachmentThing(source)) {
    const doc = source as unknown as AttachmentDoc;
    const bytes = !isCustomMongoEndpointActive() && doc.attachmentPurpose !== VAULT_ATTACHMENT_PURPOSE && visibleAttachment(doc, viewer) ? storedAttachmentBytes(doc) : null;
    return summarizeThingAttachments([bytes]);
  }
  // A saved Builder URL is a reference, never evidence of an object size.
  // Verified children use the canonical protected target relation. Exclude
  // invisible moderation rows unless the source already explicitly names one.
  const byId = new Map<string, number | null>();
  if (source.thingtime?.includes('webpage')) for (const id of collectWebpageAttachmentIds(source.crystal)) byId.set(id, null);
  if (!isCustomMongoEndpointActive()) {
    const cursor = things.find({ targetId: source.shareId, ownerId: source.ownerId, thingtime: [ATTACHMENT_THINGTIME],
      attachmentState: 'ready', attachmentPurpose: { $in: [null, 'post', 'comment'] } }, queryOptions).batchSize(128);
    for await (const candidate of cursor) {
      const doc = candidate as unknown as AttachmentDoc;
      if (visibleAttachment(doc, viewer)) byId.set(doc.shareId, storedAttachmentBytes(doc));
    }
  }
  return summarizeThingAttachments(byId.values());
}

async function currentMetadata(source: ThingDoc, viewer: Viewer, things: Awaited<ReturnType<typeof getThingsCollection>>, session?: any, signal?: AbortSignal): Promise<ThingMetadata> {
  return { id: null, targetId: source.shareId, ...measureThingJson(source, () => signal?.throwIfAborted()),
    ...await attachmentBytes(source, viewer, things, session, signal) };
}

// Render instructions are a single shared editable component definition. The
// persisted cache itself contains only bounded derived facts and an explicit
// embedded renderer. Never project its owner-scoped facts to another viewer.
const metadataCrystal = (metadata: ThingMetadata) => ({ name: 'Thing metadata', ...metadata, renderComponent: thingMetadataRenderComponent });
const cacheMatches = (saved: ThingDoc, metadata: ThingMetadata) => {
  const crystal = saved.crystal;
  return !!crystal && Object.entries(metadata).every(([key, value]) => crystal[key] === value);
};

export async function readThingMetadata(viewer: Viewer, id: string, ownerSession: boolean, signal?: AbortSignal): Promise<ThingMetadataResponse | ReturnType<typeof fail>> {
  try {
    const source = await findThingMetadataSource(id, viewer);
    if (!source) return notFound();
    const things = await getThingsCollection();
    const metadata = await currentMetadata(source, viewer, things, undefined, signal);
    const anchor = source.thingMetadata?.id;
    const saved = isThingMetadataReference(anchor) ? await things.findOne({ shareId: anchor }) as unknown as ThingDoc | null : null;
    if (isMetadataFor(saved, source)) metadata.id = saved.shareId;
    return { ok: true, metadata, canSave: ownerSession && viewer?.id === source.ownerId && !isCustomMongoEndpointActive() && canPersistFor(source) &&
      (!isMetadataFor(saved, source) || !cacheMatches(saved, metadata)) };
  } catch {
    return fail(503, 'Thing metadata is temporarily unavailable');
  }
}

export async function saveThingMetadata(viewer: Viewer, id: string, signal?: AbortSignal): Promise<ThingMetadataResponse | ReturnType<typeof fail>> {
  if (!viewer?.id || viewer.pat) return fail(401, 'A full user session is required');
  if (isCustomMongoEndpointActive()) return fail(409, 'Saving Thing metadata requires the home data plane');
  try {
    const things = await getThingsCollection();
    return await withHomeMongoTransaction(async (session) => {
      const source = await findThingMetadataSource(id, viewer, session);
      if (!source || source.ownerId !== viewer.id) return notFound();
      if (!canPersistFor(source)) return fail(409, 'Saved metadata is unavailable for this Thing kind');
      const metadata = await currentMetadata(source, viewer, things, session, signal);
      const anchor = source.thingMetadata;
      const saved = isThingMetadataReference(anchor?.id) ? await things.findOne({ shareId: anchor.id }, { session }) as unknown as ThingDoc | null : null;
      if (saved && !isMetadataFor(saved, source)) return fail(409, 'Thing metadata identity is already in use');
      // The source anchor, not a guessable public-source digest, owns the ID.
      metadata.id = saved?.shareId ?? `${THING_METADATA_KIND}-${randomBytes(32).toString('hex')}`;
      if (saved && cacheMatches(saved, metadata)) return { ok: true, metadata, canSave: false };
      const crystal = metadataCrystal(metadata), now = new Date();
      // Touch the exact source in the same transaction as the derived child.
      // This forces retry against current content if a source edit or cascade
      // delete raced the snapshot, without changing authored data or updatedAt.
      const result = await things.updateOne({ _id: source._id, ownerId: viewer.id, thingMetadata: anchor ?? { $exists: false } },
        { $set: { thingMetadata: { id: metadata.id, revision: randomBytes(16).toString('hex') } } }, { session });
      if (result.matchedCount !== 1) return fail(409, 'Thing metadata reference changed; refresh and retry');
      if (saved) {
        await things.updateOne({ _id: saved._id }, { $set: { crystal, updatedAt: now } }, { session });
      } else {
        await things.insertOne({ shareId: metadata.id, ownerId: source.ownerId, targetId: source.shareId, thingtime: [THING_METADATA_KIND],
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_INHERIT], storageClass: 'control', crystal, tags: [],
          createdAt: now, updatedAt: now }, { session });
      }
      return { ok: true, metadata, canSave: false };
    });
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return fail(409, 'Thing metadata changed; refresh and retry');
    return fail(503, 'Thing metadata is temporarily unavailable');
  }
}

export async function getThingMetadataThing(id: string, viewer: Viewer, signal: AbortSignal, admit: () => Promise<Fail | null>) {
  try {
    const things = await getThingsCollection();
    const saved = await things.findOne({ shareId: id, thingtime: [THING_METADATA_KIND] }, { signal }) as unknown as ThingDoc | null;
    if (!saved) return null;
    if (!saved.targetId) return notFound();
    const refused = await admit();
    if (refused) return refused;
    const source = await findThingMetadataSource(saved.targetId, viewer);
    if (!source || !isMetadataFor(saved, source)) return notFound();
    const metadata = await currentMetadata(source, viewer, things, undefined, signal);
    metadata.id = saved.shareId;
    const [thing] = await toPublicThings([{ ...saved, crystal: metadataCrystal(metadata) }], viewer, true);
    return { ok: true as const, thing, post: null, discussion: null, parent: null, root: null };
  } catch {
    return fail(503, 'Thing metadata is temporarily unavailable');
  }
}
