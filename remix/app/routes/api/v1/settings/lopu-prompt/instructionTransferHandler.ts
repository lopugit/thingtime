import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { CHARACTER_HEADER } from '~/api/utils/auth/characterSession';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '~/utils/dataPlane';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { executeInstructionTransfer, InstructionStoreError } from '~/api/utils/settings/lopuInstructionStore';
import { LopuPromptConflictError } from '~/api/utils/lopu/promptSettingsCore';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import { getLopuBasePrompt } from '~/api/utils/settings/lopuPromptSettings';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, X-Thingtime-Character, X-Thingtime-Expected-Data-Plane', 'Referrer-Policy': 'no-referrer' };
const defaults = { getAuthToken, resolveTokenUser, mongoDataPlane, enforceRateLimit, executeInstructionTransfer, getLopuBasePrompt };
class Changed extends Error { constructor(readonly status: number, readonly code: string) { super('Instruction account confirmation changed.'); } }
export function createInstructionTransferHandler(overrides: Partial<typeof defaults> = {}) {
 const deps = { ...defaults, ...overrides };
 return async (request: Request, parsedBody?: unknown): Promise<Response> => {
  const deny = (status: number, error: string, code?: string) => json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers });
  try {
   const origin = resolvePublicOrigin(request).origin;
   if (request.method !== 'POST') return deny(405, 'Use POST for private instruction transfer.');
   if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return deny(403, 'Use the same Thingtime origin.');
   const unsupported = requireJsonContentType(request); if (unsupported) return unsupported;
   if (internalRequestActor(request)) return deny(403, 'A current account session is required.');
   const expectedPlane = request.headers.get(EXPECTED_DATA_PLANE_HEADER);
   if (!isDataPlane(expectedPlane)) return deny(400, 'Confirm the selected database before synchronizing.', 'INVALID_DATA_PLANE');
   const body: any = parsedBody ?? await readJsonBody(request, 96 * 1024);
   if (!body || body.operation !== 'instruction-transfer' || typeof body.expectedOwnerId !== 'string' || !body.expectedOwnerId || !body.command || Object.keys(body).some(key => !['operation','expectedOwnerId','command'].includes(key))) return deny(400, 'Invalid instruction transfer request.');
   const token = await deps.getAuthToken(request), ownerId = body.expectedOwnerId;
   const admit = async () => {
    const account = token ? await deps.resolveTokenUser(token, request.headers.get(CHARACTER_HEADER)) : null;
    if (!account || account.user.temporary || account.user.accountKind === 'service') throw new Changed(401, 'ACCOUNT_UNAVAILABLE');
    if (account.user.id !== ownerId) throw new Changed(409, 'ACTOR_CHANGED');
    if (deps.mongoDataPlane() !== expectedPlane) throw new Changed(409, 'DATA_PLANE_CHANGED');
   };
   await admit();
   const limit = await deps.enforceRateLimit(request, 'settings.lopu-prompt', `user:${ownerId}`, { failClosed: true });
   if (!limit.allowed) { const init = rateLimitedResponseInit(limit); return json({ ok: false, error: 'Instruction synchronization is rate limited.' }, { ...init, headers: { ...init.headers, ...headers } }); }
   const scope = JSON.stringify([origin, expectedPlane, ownerId]);
   const result = await deps.executeInstructionTransfer(ownerId, scope, body.command, admit);
   if ('terminalCode' in result && result.terminalCode === 'INSTRUCTION_TRANSFER_ABORTED' && result.transfer?.status === 'aborted') {
    await admit();
    return json({ ok: false, code: result.terminalCode, attemptId: result.transfer.attemptId, error: 'This instruction transfer was cancelled or expired. Its parts cannot be committed.' }, { status: 409, headers });
   }
   const base = body.command.action === 'snapshot' ? await deps.getLopuBasePrompt() : undefined;
   await admit();
   return json({ ok: true, ownerId, dataPlane: expectedPlane, storagePlane: 'home', ...result, ...(base ? { base } : {}) }, { headers });
  } catch (error) {
   if (error instanceof Changed) return deny(error.status, 'Your account or database confirmation changed. Device changes have been kept.', error.code);
   if (error instanceof InstructionStoreError) return deny(error.status, error.message, error.code);
   if (error instanceof LopuPromptConflictError) return deny(409, error.message, 'INSTRUCTION_REVISION_CONFLICT');
   if (error instanceof StorageMutationError) return deny(error.status, error.message, error.code);
   if (error instanceof TypeError) return deny(400, error.message);
   if (error instanceof Response) { for (const [key,value] of Object.entries(headers)) error.headers.set(key,value); return error; }
   return deny(503, 'Instruction synchronization is temporarily unavailable. Retry the same attempt; device changes have been kept.');
  }
 };
}
export const instructionTransferHandler = createInstructionTransferHandler();
