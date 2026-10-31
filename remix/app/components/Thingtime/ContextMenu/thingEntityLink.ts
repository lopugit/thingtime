export const thingEntityLink = (href: string, origin: string, _thing: {
  author?: { id?: string }; linkKey?: string; audience?: { linkKey?: string };
} | undefined, _ownerId?: string, _presentedKey?: string) => {
  const url = new URL(href, origin);
  // Share the canonical URL even when viewing an older keyed link.
  url.searchParams.delete('key');
  return url;
};
