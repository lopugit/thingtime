import { scopeCovers } from './scopes';
import { PAT_SCOPE_CATALOG } from '../auth/patScopes';

// Preserve the historical `things` picker grant. Account permissions have an
// explicit, separate namespace, so no pre-existing app token gains access.
export const appAccountThingScopes = (granted: string[]): string[] =>
  PAT_SCOPE_CATALOG.map((scope) => scope.id).filter((scope) => scopeCovers(granted, `account.${scope}`));

export const appAccountAllows = (granted: string[], required: string | string[]): boolean =>
  (Array.isArray(required) ? required : [required]).every((scope) => scopeCovers(granted, `account.${scope}`));
