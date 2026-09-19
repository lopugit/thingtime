export const thingEntityLink = (href: string, origin: string, thing: {
  author?: { id?: string }; linkKey?: string; audience?: { linkKey?: string };
} | undefined, ownerId?: string) => {
  const url = new URL(href, origin);
  // A custom audience can also contain tt:hidden. The owner-projected key,
  // not the derived circle label, determines whether to share a secret link.
  if (ownerId && thing?.author?.id === ownerId && thing.linkKey) url.searchParams.set('key', thing.linkKey);
  else if (thing?.audience?.linkKey) url.searchParams.set('key', thing.audience.linkKey);
  // Keep a key already carried by the opened permalink, including guest shares.
  return url;
};
