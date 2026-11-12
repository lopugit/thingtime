import { isSubspaceEmbedSource } from '~/api/utils/subspaces/embedsCore';
import { thingDisplayName, type ThingsThing } from '../Things/thingsCore';

const rows = (value: unknown): Record<string, any>[] => {
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  return entries.filter(entry => !!entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.id === 'string' && !!entry.id);
};

/** Search projects posts as an id-keyed record; ordinary Thing lists and older
 * clients can also carry arrays. Normalize both before exposing any choices. */
export function subspaceEmbedSearchResults(payload: { things?: unknown; posts?: unknown }): Array<{ id: string; name: string }> {
  const things = rows(payload.things).filter(isSubspaceEmbedSource).map(thing => ({ id: thing.id, name: thingDisplayName(thing as ThingsThing) }));
  const posts = rows(payload.posts).filter(post => isSubspaceEmbedSource({ ...post, thingtime: post.thingtime || ['post'] })).map(post => ({
    id: post.id, name: typeof post.title === 'string' && post.title ? post.title : typeof post.text === 'string' && post.text ? post.text : post.id
  }));
  return [...new Map([...things, ...posts].map(item => [item.id, item])).values()];
}
