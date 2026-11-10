import { getAuthToken } from '../auth/authCookie';
import { CHARACTER_HEADER } from '../auth/characterSession';
import { getChatGPTPlanRuntime } from './chatgptPlanRuntime';
import { chatGPTPlanScope } from './chatgptPlanScope';
import { createOwnedPlanResolver } from './chatgptPlanAdmissionCore';

// Scoped app/PAT credentials and internal action actors cannot inherit this
// personal-plan exception. Character selection follows the live session.
export const planSessionOwns = async (request: Request, ownerId: string): Promise<boolean> => {
  if (request.headers.has(CHARACTER_HEADER)) return false;
  const { resolveTokenUser } = await import('../auth/getCurrentUser');
  const token = await getAuthToken(request);
  const resolved = token ? await resolveTokenUser(token, null) : null;
  const user = resolved?.user;
  return !!user && user.id === ownerId && !user.temporary && user.accountKind !== 'service';
};

type SessionOwner = { id: string; temporary?: boolean; accountKind?: string };
export const resolveOwnedChatGPTPlan = (request: Request, ownerId: string, providerId: string,
  // Only the durable continuation worker supplies this revocation-aware full
  // session resolver. No request body or internal action actor can supply it.
  resolveContinuationSession?: () => Promise<SessionOwner | null>
) => createOwnedPlanResolver({
  sessionOwns: resolveContinuationSession ? async () => {
    if (request.headers.has(CHARACTER_HEADER)) return false;
    const user = await resolveContinuationSession();
    return !!user && user.id === ownerId && !user.temporary && user.accountKind !== 'service';
  } : planSessionOwns,
  resolve: async (request, ownerId, providerId) => {
    // The factory refuses hosted/ephemeral deployments. Resolution enforces
    // origin, owner, connected state, refresh and selected model membership.
    const runtime = getChatGPTPlanRuntime();
    if (!runtime) throw new Error('ChatGPT runtime unavailable');
    return runtime.resolveProvider(await chatGPTPlanScope(request, ownerId), providerId);
  }
})(request, ownerId, providerId);
