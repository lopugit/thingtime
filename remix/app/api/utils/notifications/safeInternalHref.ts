// A click-through for a system note is always an in-app path: rooted, not
// protocol-relative, no whitespace/control characters, bounded. Anything else
// is dropped rather than rendered.
export const safeInternalHref = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href.startsWith('/') || href.startsWith('//') || href.length > 300) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(href)) return null;
  return href;
};
