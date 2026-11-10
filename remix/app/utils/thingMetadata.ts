export const THING_METADATA_KIND = 'thing-metadata';
export const THING_METADATA_PATH = '/api/v1/things/metadata';
export const THING_METADATA_REQUIREMENTS = { 'api.things-metadata': '1.0.0', 'api.things': '1.54.0' } as const;
export const isThingMetadataReference = (id: unknown): id is string => typeof id === 'string' && /^thing-metadata-[a-f0-9]{64}$/.test(id);

export type ThingMetadata = {
  id: string | null;
  targetId: string;
  sourceHash: string;
  canonicalVersion: 1;
  jsonBytes: number;
  attachedBytes: number | null;
  knownAttachedBytes: number;
  attachmentCount: number;
  unavailableAttachmentCount: number;
};

export type ThingMetadataResponse = { ok: true; metadata: ThingMetadata; canSave: boolean };
