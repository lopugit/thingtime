export const ANONYMOUS_USER_NAME = 'Anonymous';
export const LOGIN_TO_CLAIM_LABEL = 'Login to claim';

export type PresentableUserIdentity = {
  username: string;
  displayName?: string | null;
  temporary?: boolean;
};

export const getUserDisplayName = (user: PresentableUserIdentity): string =>
  user.temporary ? ANONYMOUS_USER_NAME : user.displayName || user.username;

export const getUserIdentityDetail = (user: PresentableUserIdentity): string =>
  user.temporary ? LOGIN_TO_CLAIM_LABEL : `@${user.username}`;

export const getUserMention = (user: PresentableUserIdentity): string =>
  user.temporary ? ANONYMOUS_USER_NAME : `@${user.username}`;
