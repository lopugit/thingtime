import { requireThingtimeCapability } from '../../api/utils/capabilities/requireCapability.client';
import { ThingtimeApiError } from '../../hooks/apiFailure';
import { EXPECTED_DATA_PLANE_HEADER } from '../../utils/dataPlane';
import { isThingMetadataReference, THING_METADATA_PATH, THING_METADATA_REQUIREMENTS, type ThingMetadata, type ThingMetadataResponse } from '../../utils/thingMetadata';

type MetadataScope = {
  id: string;
  linkKey: string;
  origin: string;
  actor?: string;
  character?: string;
  plane: string | null;
};

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseThingMetadataResponse(value: unknown, id: string): ThingMetadataResponse {
  const reply = value as Partial<ThingMetadataResponse> | null;
  const m = reply?.metadata;
  if (reply?.ok !== true || typeof reply.canSave !== 'boolean' || !m || m.targetId !== id ||
    (m.id !== null && !isThingMetadataReference(m.id)) ||
    m.canonicalVersion !== 1 || typeof m.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(m.sourceHash) ||
    !isCount(m.jsonBytes) || !isCount(m.knownAttachedBytes) || !isCount(m.attachmentCount) ||
    !isCount(m.unavailableAttachmentCount) || m.unavailableAttachmentCount > m.attachmentCount ||
    (m.unavailableAttachmentCount > 0 ? m.attachedBytes !== null : m.attachedBytes !== m.knownAttachedBytes) ||
    (m.attachmentCount === m.unavailableAttachmentCount && m.knownAttachedBytes !== 0)) {
    throw new Error('Thing metadata did not match the requested Thing.');
  }
  // Project the negotiated fields only. Saved Builder layouts never receive
  // arbitrary response data or request authority through the binding scope.
  const { targetId, sourceHash, canonicalVersion, jsonBytes, attachedBytes, knownAttachedBytes, attachmentCount, unavailableAttachmentCount } = m;
  return { ok: true, canSave: reply.canSave, metadata: {
    id: m.id, targetId, sourceHash, canonicalVersion, jsonBytes, attachedBytes, knownAttachedBytes, attachmentCount, unavailableAttachmentCount,
  } };
}

export async function refreshThingMetadata(scope: MetadataScope, options: {
  signal: AbortSignal;
  canPersist: boolean;
  onMeasured: (metadata: ThingMetadata) => void;
  assertCurrent: () => void;
  onIdentityChange: () => void;
}, transport = { fetch, requireCapability: requireThingtimeCapability }) {
  const { signal, assertCurrent } = options;
  const { fetch: fetchMetadata, requireCapability } = transport;
  const assertActive = () => { signal.throwIfAborted(); assertCurrent(); };
  assertActive();
  for (const [feature, minimum] of Object.entries(THING_METADATA_REQUIREMENTS)) {
    await requireCapability(feature, minimum, scope.origin);
    assertActive();
  }

  const request = async (method: 'GET' | 'POST') => {
    assertActive();
    const query = new URLSearchParams({ id: scope.id });
    if (method === 'GET' && scope.linkKey) query.set('key', scope.linkKey);
    const headers = new Headers({ Accept: 'application/json', 'X-Thingtime-Expected-Api-Origin': scope.origin });
    if (scope.actor) headers.set('X-Thingtime-Expected-Actor', scope.actor);
    if (scope.character) headers.set('X-Thingtime-Character', scope.character);
    if (scope.plane) headers.set(EXPECTED_DATA_PLANE_HEADER, scope.plane);
    let response: Response;
    try {
      response = await fetchMetadata(`${THING_METADATA_PATH}?${query}`, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
    } catch {
      assertActive();
      throw new ThingtimeApiError('Could not reach Thing metadata.', { status: null, method });
    }
    assertActive();
    if (response.redirected) throw new Error('The selected API server changed.');
    if (!response.ok) {
      if (response.status === 409) {
        const failure = await response.json().catch(() => null);
        assertActive();
        if (failure?.code === 'DATA_PLANE_CHANGED' || failure?.error === 'The active account changed. Run the action again.') {
          options.onIdentityChange();
        }
      }
      throw new ThingtimeApiError('Thing metadata request did not complete.', { status: response.status, method });
    }
    let body: unknown;
    try { body = await response.json(); } catch (cause) {
      assertActive();
      // A stalled or disconnected response body is retryable; invalid JSON is
      // an unverified response and cannot seed the metadata view.
      if (cause instanceof SyntaxError) throw cause;
      throw new ThingtimeApiError('Could not finish reading Thing metadata.', { status: null, method });
    }
    assertActive();
    return parseThingMetadataResponse(body, scope.id);
  };

  const { metadata, canSave } = await request('GET');
  options.onMeasured(metadata);
  // Start a write only after the source view has verified the current Thing
  // and this read says the owned reference is missing or stale. Retry starts
  // with a fresh GET so an unconfirmed POST cannot mint a second record.
  if (canSave && options.canPersist && scope.actor && scope.plane) {
    const saved = await request('POST');
    if (!saved.metadata.id || saved.canSave) throw new Error('The saved metadata reference was not confirmed.');
    options.onMeasured(saved.metadata);
  }
}
