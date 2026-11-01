import { apiErrorMessage, hasUnknownMutationOutcome, ThingtimeApiError } from '../../hooks/apiFailure';

export const isUnknownReactionFailure = (error: unknown) => hasUnknownMutationOutcome(error);

// A completed HTTP response (including an unreadable 2xx body) establishes a
// causal boundary: a following GET cannot overtake that mutation. A transport
// failure has no such boundary, so an immediate GET could still return the
// pre-write value while the disconnected request finishes in the background.
export const shouldReconcileReactionFailure = (error: unknown) =>
  error instanceof ThingtimeApiError && error.status !== null && isUnknownReactionFailure(error);

export const reactionFailureMessage = (error: unknown, reconciled: boolean) => {
  if (!isUnknownReactionFailure(error)) {
    return {
      title: apiErrorMessage(error, 'That reaction didn’t go through 😞'),
      description: undefined
    };
  }

  const detail = apiErrorMessage(error, 'Thingtime could not confirm the server result.');
  return {
    title: 'We couldn’t confirm that reaction',
    description: reconciled
      ? `${detail} This post was refreshed to match the server.`
      : `${detail} Refresh this page before trying again so you don’t accidentally reverse it.`
  };
};
