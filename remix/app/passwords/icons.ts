/** Only an explicit choice may add an icon. Never infer one while listing URLs. */
export type PasswordIcon = { kind: 'url'; url: string } | { kind: 'attachment'; fileId: string };
export const PASSWORD_ICON_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'];
export function passwordIconUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) throw new Error('Choose an HTTPS icon URL without credentials.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Choose an HTTPS icon URL without credentials.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Choose an HTTPS icon URL without credentials.');
  return url.href;
}
export function validatePasswordIcon(value: unknown): PasswordIcon {
  const icon = value as PasswordIcon;
  if (icon?.kind === 'url') return { kind: 'url', url: passwordIconUrl(icon.url) };
  if (icon?.kind === 'attachment' && typeof icon.fileId === 'string' && /^att_[a-f0-9]{64}$/.test(icon.fileId)) return { kind: 'attachment', fileId: icon.fileId };
  throw new Error('Choose an uploaded icon or an HTTPS icon URL.');
}
export function passwordWebsiteIcon(value: string): PasswordIcon {
  const website = new URL(passwordIconUrl(value));
  return { kind: 'url', url: new URL('/favicon.ico', website.origin).href };
}
