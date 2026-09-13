export const thingEntityLink = (href: string, origin: string, thing: {
  author?: { id?: string }; linkKey?: string;
} | undefined, ownerId?: string) => {
  const url = new URL(href, origin);
  // A custom audience can also contain tt:hidden. The owner-projected key,
  // not the derived circle label, determines whether to share a secret link.
  if (ownerId && thing?.author?.id === ownerId && thing.linkKey) url.searchParams.set('key', thing.linkKey);
  else url.searchParams.delete('key');
  return url;
};
