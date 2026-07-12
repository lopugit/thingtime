const AUTH_RETURN_STORAGE_KEY = 'thingtime:auth-return-to:v1';
const SAFE_ORIGIN = 'https://thingtime.local';

export type AuthReturnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): AuthReturnStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export const safeAuthReturnPath = (candidate: unknown): string | null => {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) return null;

  try {
    const url = new URL(trimmed, SAFE_ORIGIN);
    if (url.origin !== SAFE_ORIGIN) return null;

    const normalizedPathname = url.pathname.replace(/\/+$/, '') || '/';
    if (normalizedPathname === '/login' || normalizedPathname === '/register') return null;
    if (normalizedPathname === '/api' || normalizedPathname.startsWith('/api/')) return null;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const rememberAuthReturnTo = (candidate: unknown, storage = browserStorage()) => {
  const safe = safeAuthReturnPath(candidate);
  if (!safe || !storage) return false;

  try {
    storage.setItem(AUTH_RETURN_STORAGE_KEY, safe);
    return true;
  } catch {
    return false;
  }
};

export const readAuthReturnTo = (fallback: string, storage = browserStorage()) => {
  const safeFallback = safeAuthReturnPath(fallback) || '/';
  if (!storage) return safeFallback;

  try {
    return safeAuthReturnPath(storage.getItem(AUTH_RETURN_STORAGE_KEY)) || safeFallback;
  } catch {
    return safeFallback;
  }
};

export const consumeAuthReturnTo = (fallback: string, storage = browserStorage()) => {
  const destination = readAuthReturnTo(fallback, storage);
  try {
    storage?.removeItem(AUTH_RETURN_STORAGE_KEY);
  } catch {
    // sessionStorage is optional; returning to the safe fallback still works.
  }
  return destination;
};
