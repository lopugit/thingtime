import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { getRequestIp } from '../rateLimit/enforce';
import { FOUND_POST_BROWSER_COOKIE, validFoundPostBrowserToken } from '../../../hooks/foundPostIdentity.client';
import type { Viewer } from './things';

// Cookies are used so native image/video requests carry the same proof as
// JSON reads. A bare anonymous ID or an IP address is never a credential.
export const withFoundPostBrowser = (viewer: Viewer, request: Request, allowed = true): Viewer => {
	if (!allowed || viewer?.id || viewer?.pat || request.headers.has('Authorization')) return viewer;
	const token = request.headers
		.get('Cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${FOUND_POST_BROWSER_COOKIE}=`))
		?.slice(FOUND_POST_BROWSER_COOKIE.length + 1);
	if (!validFoundPostBrowserToken(token)) return viewer;
	return { id: '', ...viewer, anonymousId: `anonymous-${createHash('sha256').update(token).digest('hex')}` };
};

export const foundPostVisitIp = (request: Request): string | undefined => {
	const ip = getRequestIp(request);
	return isIP(ip) ? ip : undefined;
};
