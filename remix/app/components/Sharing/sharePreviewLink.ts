import { socialPreviewDesignParams, type SocialPreviewDesign } from '~/utils/socialPreviewDesign';
export function validShareDestination(value: unknown, origin: string): string {
 if (typeof value !== 'string') throw new Error('Choose a link on this origin.');
 const url = new URL(value, origin);
 if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Choose a link on this origin.');
 return url.href;
}
/** Keep the canonical destination and access context; only replace our two
 * presentation parameters. These choices never mutate the underlying Thing. */
export function customisedShareLink(value: string, origin: string, design: SocialPreviewDesign): string {
 const url = new URL(validShareDestination(value, origin));
 url.searchParams.delete('previewTheme'); url.searchParams.delete('previewLayout');
 socialPreviewDesignParams(design).forEach((entry, key) => url.searchParams.set(key, entry));
 return url.href;
}

export const OPEN_SHARE_PREVIEW = 'thingtime:share-preview';
/** Navigation destination only; metadata is always resolved anonymously. */
export function openSharePreview(href: string) { window.dispatchEvent(new CustomEvent(OPEN_SHARE_PREVIEW, { detail: { href } })); }
