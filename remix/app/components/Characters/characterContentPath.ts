/** Content navigation may retain an editor selection. Account, external and
 * share/export destinations must not inherit it as authorization. */
export const isCharacterContentPath = (path: string) => /^\/(?:things|thing|post|history|media|builder|components|actions|schemas|apps|tasks|saved)(?:\/|$)/.test(path);
export function characterContentPath(path: string, actorId?: string | null) {
 if (!actorId || !path.startsWith('/') || path.startsWith('//')) return path;
 const url = new URL(path, 'https://content.invalid');
 if (url.origin !== 'https://content.invalid' || !isCharacterContentPath(url.pathname)) return path;
 url.searchParams.set('character', actorId);
 return url.pathname + url.search + url.hash;
}
