import { PASSWORD_ICON_MIME_TYPES, passwordIconUrl, validatePasswordIcon, type PasswordIcon } from './icons';
import { openPasswordFile } from './files.client';
const iconMime = (value: string) => value.toLowerCase().split(';')[0].trim();
export async function fetchPasswordIcon(url: string, signal?: AbortSignal): Promise<Blob> {
  // A deliberate icon load is always anonymous and never follows redirects.
  const response = await fetch(passwordIconUrl(url), { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', mode: 'cors', signal });
  if (!response.ok || !PASSWORD_ICON_MIME_TYPES.includes(iconMime(response.headers.get('content-type') || ''))) throw new Error('This URL did not provide a supported icon. Upload the image instead.');
  return response.blob();
}
export async function openPasswordIconBlob(ownerId: string, entryId: string, value: PasswordIcon, signal?: AbortSignal): Promise<Blob> {
  const icon = validatePasswordIcon(value);
  if (icon.kind === 'url') return fetchPasswordIcon(icon.url, signal);
  const opened = await openPasswordFile(ownerId, entryId, icon.fileId, signal);
  const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' } as Record<string, string>)[opened.metadata.name.split('.').at(-1)?.toLowerCase() || ''];
  if (!mime) { await opened.stream.cancel(); throw new Error('Choose a PNG, JPEG, WebP, GIF, or ICO image.'); }
  const blob = await new Response(opened.stream).blob(); signal?.throwIfAborted();
  return new Blob([blob], { type: mime });
}
