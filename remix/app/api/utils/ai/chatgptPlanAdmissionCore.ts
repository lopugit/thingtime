/** Server-issued, request-local proof. JSON, provider ids and catalog hints
 * cannot manufacture this authority or move it to a different owner/provider. */
export type OwnedPlanAdmission = Readonly<{ ownerId: string; providerId: string }>;
const issued = new WeakMap<OwnedPlanAdmission, AbortSignal>();
export const ownsPlanAdmission = (proof: OwnedPlanAdmission | null | undefined, ownerId: string, providerId?: string | null): boolean =>
  !!proof && issued.has(proof) && !issued.get(proof)!.aborted && proof.ownerId === ownerId &&
  (providerId === undefined || proof.providerId === providerId);

type Provider = { id: string; authMode: 'chatgpt-plan'; authSignal: AbortSignal };
export const createOwnedPlanResolver = <P extends Provider>(dependencies: {
  sessionOwns: (request: Request, ownerId: string) => Promise<boolean>;
  resolve: (request: Request, ownerId: string, providerId: string) => Promise<P>;
}) => async (request: Request, ownerId: string, providerId: string) => {
  if (!await dependencies.sessionOwns(request, ownerId)) throw new Error('A full account session is required');
  const provider = await dependencies.resolve(request, ownerId, providerId);
  // Refresh may await network I/O. Recheck the live session/selected identity
  // before granting admission, and retain the runtime's revocation signal.
  if (provider.id !== providerId || provider.authMode !== 'chatgpt-plan' || provider.authSignal.aborted ||
    !await dependencies.sessionOwns(request, ownerId)) throw new Error('ChatGPT account authority changed');
  const admission = Object.freeze({ ownerId, providerId });
  issued.set(admission, provider.authSignal);
  return { provider, admission };
};
