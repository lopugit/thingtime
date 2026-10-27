import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { passwordRequest } from './client';
import { createBrowserPasskeyAssertion, prepareBrowserPasskeyRegistration, validateBrowserPasskeyRequest, type BrowserPasskeyRequest } from './browserPasskey';
import { passwordFieldValue, validatePasswordEntry, type PasswordEntry } from './model';

export type ProviderRequest = BrowserPasskeyRequest & { version: 1; id: string };
export type ProviderChoice = { id: string; title: string; username: string; relyingParty?: string; credentialId?: string };
type Vault = (body: Record<string, unknown>, signal: AbortSignal, cursor?: string) => Promise<any>;
export type BrowserProviderAttempt = { requestFingerprint?: string; sessionBinding?: string; prepared?: Awaited<ReturnType<typeof prepareBrowserPasskeyRegistration>>; id?: string; writeId?: string };
export function validateProviderRequest(input: unknown): ProviderRequest {
  const value = input as ProviderRequest;
  if (value?.version !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id)) throw new DOMException('Invalid passkey request.', 'DataError');
  return { ...validateBrowserPasskeyRequest(value), version: 1, id: value.id };
}
export const providerRp = (request: BrowserPasskeyRequest) => (request.type === 'create' ? request.publicKey.rp?.id : request.publicKey.rpId) || new URL(request.origin).hostname;
export async function loadProviderChoices(request: ProviderRequest, vault: Vault, signal: AbortSignal): Promise<ProviderChoice[]> {
  const choices: ProviderChoice[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await vault({ operation: 'catalog', ...(cursor ? { cursor } : {}) }, signal);
    signal.throwIfAborted();
    for (const item of page.catalog || []) if (item.relyingParty === providerRp(request) && item.credentialId) {
      const allowed = request.publicKey.allowCredentials;
      if (request.type === 'create' || !allowed?.length || allowed.some(value => value.id === item.credentialId)) choices.push(item);
    }
    cursor = page.nextCursor || undefined;
    if (cursor && seen.has(cursor)) throw new Error('The password list could not finish. Try again.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return choices;
}
export function browserProviderVault(ownerId: string): Vault {
  return (body, signal) => passwordRequest(ownerId, body, signal);
}
/** Secrets exist only in this invocation. No response leaves before durable exact readback. */
export async function runProviderCeremony(request: ProviderRequest, password: string, selectedId: string, vault: Vault, signal: AbortSignal, attempt: BrowserProviderAttempt = {}) {
  signal.throwIfAborted();
  const fingerprint = JSON.stringify(request);
  if (attempt.requestFingerprint && attempt.requestFingerprint !== fingerprint) throw new DOMException('The passkey request changed.', 'InvalidStateError');
  attempt.requestFingerprint = fingerprint;
  const passkeySession = () => ({ requestId: request.id, binding: attempt.sessionBinding });
  const verified = await vault({ operation: 'verify-passkey', requestId: request.id, password,
    ...(attempt.sessionBinding ? { passkeySession: passkeySession() } : {}) }, signal);
  password = '';
  signal.throwIfAborted();
  if (verified.verified !== true || verified.requestId !== request.id || typeof verified.sessionBinding !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(verified.sessionBinding) || (attempt.sessionBinding && attempt.sessionBinding !== verified.sessionBinding))
    throw new DOMException('Verify your account again.', 'NotAllowedError');
  attempt.sessionBinding = verified.sessionBinding;
  const boundVault: Vault = (body, selectedSignal, cursor) => vault({ ...body, passkeySession: passkeySession() }, selectedSignal, cursor);
  const choices = await loadProviderChoices(request, boundVault, signal);
  if (request.type === 'get') {
    if (!choices.some(value => value.id === selectedId)) throw new DOMException('Choose a saved passkey for this website.', 'NotAllowedError');
    const saved = await boundVault({ operation: 'read', id: selectedId }, signal);
    signal.throwIfAborted();
    const response = await createBrowserPasskeyAssertion(saved.entry, request, true);
    signal.throwIfAborted();
    // Revalidate the exact vault session after signing, before the assertion leaves.
    const current = await boundVault({ operation: 'read', id: selectedId }, signal);
    signal.throwIfAborted();
    if (current.revision !== saved.revision || JSON.stringify(current.entry) !== JSON.stringify(saved.entry)) throw new DOMException('The saved passkey changed. Start again.', 'InvalidStateError');
    return response;
  }
  const excluded: PasswordEntry[] = choices.map(value => ({ title: value.title, passwordType: 'passkey', fields: [
    { id: 'credentialId', label: 'Credential ID', type: 'text', value: value.credentialId! },
    { id: 'relyingParty', label: 'Website', type: 'text', value: value.relyingParty! },
  ] }));
  const prepared = attempt.prepared || await prepareBrowserPasskeyRegistration(request, true, excluded);
  attempt.prepared = prepared;
  signal.throwIfAborted();
  const id = attempt.id ||= crypto.randomUUID(), writeId = attempt.writeId ||= crypto.randomUUID();
  await boundVault({ operation: 'save', id, writeId, revision: 0, entry: prepared.entry }, signal);
  signal.throwIfAborted();
  const saved = await boundVault({ operation: 'read', id }, signal);
  signal.throwIfAborted();
  // The canonical writer normalizes field labels and object property order.
  // Compare the complete canonical entries so that those normalizations do not
  // reject a durable save, while every key/handle/RP/credential value must match.
  let sameEntry = false;
  try { sameEntry = JSON.stringify(validatePasswordEntry(saved.entry)) === JSON.stringify(validatePasswordEntry(prepared.entry)); } catch { /* Fail closed on invalid stored data. */ }
  if (!sameEntry || saved.entry?.passwordType !== 'passkey' ||
    passwordFieldValue(saved.entry, 'credentialId') !== prepared.response.id) throw new Error('The saved passkey could not be verified. Registration was not completed.');
  return prepared.response;
}
export async function ensureBrowserProvider(signal: AbortSignal) {
  await requireThingtimeCapability('api.passwords', '1.4.0');
  signal.throwIfAborted();
}
