/** Interpret saved website data without broadening an autofill target. Bare
 * DNS hosts mean HTTPS; explicit URLs retain their exact scheme and port.
 * This does not authorize a browser document or replace request validation. */
export function passwordWebsiteOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value || /[\s\\]/u.test(value) || value.startsWith('//')) return null;
  const explicit = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  if (!explicit && !/^[^:/?#]+(?::\d+)?(?:[/?#]|$)/u.test(value)) return null;
  try {
    const url = new URL(explicit ? value : `https://${value}`);
    if (!url.hostname || url.username || url.password || url.hostname.includes('*')) return null;
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:') return null;
    if (!explicit && url.hostname === '127.0.0.1' && !/^127\.0\.0\.1(?::\d+)?(?:[/?#]|$)/.test(value)) return null;
    if (!explicit && !local && (!url.hostname.includes('.') || !/[a-z]/i.test(url.hostname) || !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(url.hostname) || url.hostname.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-')))) return null;
    return url.origin;
  } catch { return null; }
}

export function passwordWebsiteOrigins(fields: {type: string; value: string}[]): string[] {
  return [...new Set(fields.filter(field => field.type === 'url').flatMap(field => {
    const origin = passwordWebsiteOrigin(field.value);
    return origin ? [origin] : [];
  }))];
}
