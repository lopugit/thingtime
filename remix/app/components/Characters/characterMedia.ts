// Only the first-party content endpoint accepts this selector. Never append
// account identity to third-party image URLs, blob previews or stored metadata.
export function characterMediaUrl(src: string | null | undefined, actorId?: string | null) {
  if (!src || !actorId || !src.startsWith('/api/v1/attachments/content?')) return src;
  const url = new URL(src, 'https://thingtime.invalid');
  url.searchParams.set('character', actorId);
  return `${url.pathname}${url.search}`;
}
