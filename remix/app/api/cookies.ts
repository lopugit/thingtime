type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
  // Registrable-domain cookies (e.g. `.thingtime.com`) are shared across every
  // deployment on that domain — used by the account-hints cookie so previews
  // can suggest accounts signed in on other Thingtime deployments.
  domain?: string;
};

const parseCookieHeader = (cookieHeader?: string | null) => {
  const cookies = new Map<string, string>();

  for (const part of cookieHeader?.split(';') || []) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies.set(rawName, rawValue.join('='));
  }

  return cookies;
};

const encodeCookieValue = (value: unknown) => {
  if (typeof value === 'string') {
    return encodeURIComponent(value);
  }

  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `j:${encoded}`;
};

const decodeCookieValue = (rawValue?: string) => {
  if (!rawValue) return undefined;

  const value = decodeURIComponent(rawValue);

  if (!value.startsWith('j:')) {
    return value;
  }

  try {
    return JSON.parse(Buffer.from(value.slice(2), 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};

const serializeOptions = (options: CookieOptions) => {
  const parts: string[] = [];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);

  return parts.length ? `; ${parts.join('; ')}` : '';
};

export const createCookie = (name: string, defaults: CookieOptions = {}) => ({
  async parse(cookieHeader?: string | null) {
    return decodeCookieValue(parseCookieHeader(cookieHeader).get(name));
  },

  async serialize(value: unknown, overrides: CookieOptions = {}) {
    const options = { ...defaults, ...overrides };
    return `${name}=${encodeCookieValue(value)}${serializeOptions(options)}`;
  }
});
