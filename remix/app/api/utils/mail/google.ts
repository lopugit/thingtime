import { MailError, type MailAccount, type MailBatch } from '~/mail/model';
import { vaultRequest } from '../auth/vaultRequest';
import { resolvePublicOrigin } from '../auth/publicOrigin';
import { readAdminAutomationSecret } from '../admin/integrations';
import { folderFor, parseMailMessage, type MailSyncRequest } from './provider';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const GOOGLE_MAIL_CALLBACK = '/api/v1/mail/google/callback';
export type GoogleMailConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GoogleMailGrant = { refreshToken: string; subject: string; clientId: string };
export type PrivateMailAccount = MailAccount & { googleGrant?: GoogleMailGrant };
export async function googleMailConfig(origin?: string): Promise<GoogleMailConfig> {
	try {
		const request = vaultRequest();
		origin ||= request ? resolvePublicOrigin(request).origin : undefined;
		if (!origin) throw new Error();
		const bundle = JSON.parse((await readAdminAutomationSecret('google-mail-oauth')) || 'null');
		const value = bundle.origins?.[origin];
		const url = new URL(value.redirectUri);
		if (
			typeof value.clientId !== 'string' ||
			!value.clientId ||
			value.clientId.length > 1024 ||
			typeof value.clientSecret !== 'string' ||
			!value.clientSecret ||
			value.clientSecret.length > 8192 ||
			url.origin !== origin ||
			url.pathname !== GOOGLE_MAIL_CALLBACK ||
			url.search ||
			url.hash ||
			url.username ||
			url.password ||
			(url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
		)
			throw new Error();
		return { clientId: value.clientId, clientSecret: value.clientSecret, redirectUri: url.href };
	} catch {
		throw new MailError(503, 'Google mail connection is not configured on this Thingtime server yet.');
	}
}
/** Fixed Google endpoints only; cap bodies, deadlines and redirects, redact provider errors. */
export async function googleJson(url: string, init: RequestInit, fetcher = fetch, maxBytes = 1024 * 1024): Promise<any> {
	const allowed = new Set(['https://oauth2.googleapis.com', 'https://openidconnect.googleapis.com', 'https://gmail.googleapis.com']);
	if (!allowed.has(new URL(url).origin)) throw new MailError(400, 'Invalid Google endpoint.');
	const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
	const response = await fetcher(url, { ...init, signal, redirect: 'error', cache: 'no-store' });
	if (!response.ok) {
		await response.body?.cancel();
		throw new MailError(
			response.status === 401 || response.status === 400 ? 409 : 503,
			response.status === 401 || response.status === 400
				? 'Google authorization expired or was revoked. Connect Gmail again.'
				: 'Google mail is unavailable. Try again shortly.'
		);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new MailError(503, 'Google returned an empty response.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw new MailError(502, 'Google returned an oversized response.');
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} finally {
		await reader.cancel().catch(() => {});
	}
}
export async function googleTokens(config: GoogleMailConfig, fields: Record<string, string>, signal?: AbortSignal, fetcher = fetch) {
	const token = await googleJson(
		'https://oauth2.googleapis.com/token',
		{
			method: 'POST',
			signal,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields })
		},
		fetcher,
		32768
	);
	if (
		typeof token.access_token !== 'string' ||
		!token.access_token ||
		token.access_token.length > 8192 ||
		token.token_type?.toLowerCase() !== 'bearer'
	)
		throw new MailError(503, 'Google did not return a usable authorization.');
	if (token.scope !== undefined && (typeof token.scope !== 'string' || !token.scope.split(' ').includes(GMAIL_SCOPE)))
		throw new MailError(403, 'Allow Gmail read and write access to connect this mailbox.');
	return token;
}
export async function exchangeGoogleMail(config: GoogleMailConfig, code: string, verifier: string, fetcher = fetch) {
	const token = await googleTokens(
		config,
		{ code, code_verifier: verifier, redirect_uri: config.redirectUri, grant_type: 'authorization_code' },
		undefined,
		fetcher
	);
	if (
		!token.scope?.split(' ').includes(GMAIL_SCOPE) ||
		typeof token.refresh_token !== 'string' ||
		!token.refresh_token ||
		token.refresh_token.length > 8192
	)
		throw new MailError(403, 'Allow Gmail access and offline access, then try connecting again.');
	const headers = { Authorization: `Bearer ${token.access_token}` };
	const user = await googleJson('https://openidconnect.googleapis.com/v1/userinfo', { headers }, fetcher, 32768);
	const profile = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers }, fetcher, 32768);
	if (
		typeof user.sub !== 'string' ||
		user.sub.length > 255 ||
		user.email_verified !== true ||
		typeof user.email !== 'string' ||
		user.email.length > 320 ||
		user.email.toLowerCase() !== profile.emailAddress?.toLowerCase()
	)
		throw new MailError(403, 'Google did not confirm this Gmail account.');
	return { address: user.email, grant: { refreshToken: token.refresh_token, subject: user.sub, clientId: config.clientId } as GoogleMailGrant };
}
export async function googleMailClient(account: PrivateMailAccount, signal?: AbortSignal, configLoader = googleMailConfig, fetcher = fetch) {
	if (account.provider !== 'gmail' || !account.googleGrant) throw new MailError(400, 'Connect this Gmail account with Google first.');
	const config = await configLoader();
	if (account.googleGrant.clientId !== config.clientId) throw new MailError(409, 'Google connection settings changed. Connect Gmail again.');
	const token = await googleTokens(config, { grant_type: 'refresh_token', refresh_token: account.googleGrant.refreshToken }, signal, fetcher);
	return (path: string, method = 'GET', body?: unknown) =>
		googleJson(
			`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
			{
				signal,
				method,
				headers: { Authorization: `Bearer ${token.access_token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
				...(body !== undefined ? { body: JSON.stringify(body) } : {})
			},
			fetcher
		);
}
export async function fetchGoogleMailBatch(
	account: PrivateMailAccount,
	request: MailSyncRequest,
	signal?: AbortSignal,
	configLoader = googleMailConfig,
	fetcher = fetch
): Promise<MailBatch> {
	if (account.provider !== 'gmail' || request.protocol !== 'gmail' || !account.googleGrant)
		throw new MailError(400, 'Connect this Gmail account with Google first.');
	const config = await configLoader();
	if (account.googleGrant.clientId !== config.clientId) throw new MailError(409, 'Google connection settings changed. Connect Gmail again.');
	const deadline = AbortSignal.timeout(45000);
	signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
	const token = await googleTokens(config, { grant_type: 'refresh_token', refresh_token: account.googleGrant.refreshToken }, signal, fetcher);
	const get = (path: string) =>
		googleJson(
			`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
			{ signal, headers: { Authorization: `Bearer ${token.access_token}` } },
			fetcher
		);
	const labels = await get('labels');
	if (!Array.isArray(labels.labels) || labels.labels.length > 1000) throw new MailError(502, 'Gmail returned too many folders.');
	const folders = labels.labels
		.filter((label: any) => typeof label.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(label.id) && typeof label.name === 'string')
		.map((label: any) => folderFor(account.id, 'gmail', label.id, label.name.slice(0, 512), label.id === 'INBOX'));
	if (request.discover) return { folders, messages: [], nextCursor: null };
	const folder = folders.find((item: any) => item.path === (request.path || 'INBOX'));
	if (!folder) throw new MailError(404, 'This Gmail folder no longer exists. Refresh folders.');
	if (request.cursor && (typeof request.cursor !== 'string' || request.cursor.length > 2048)) throw new MailError(400, 'Invalid Gmail cursor.');
	const params = new URLSearchParams({ labelIds: folder.path, maxResults: '20', ...(request.cursor ? { pageToken: request.cursor } : {}) });
	const page = await get(`messages?${params}`);
	if (page.messages !== undefined && (!Array.isArray(page.messages) || page.messages.length > 20))
		throw new MailError(502, 'Invalid Gmail message page.');
	const messages = [];
	for (const row of page.messages || []) {
		if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(row.id)) throw new MailError(502, 'Invalid Gmail message identity.');
		const meta = await get(`messages/${row.id}?format=metadata`);
		const large = !Number.isFinite(meta.sizeEstimate) || meta.sizeEstimate > 512 * 1024;
		let source: Buffer;
		if (large) {
			const headers = (meta.payload?.headers || []).filter((h: any) => ['subject', 'from', 'to', 'date'].includes(String(h.name).toLowerCase()));
			source = Buffer.from(
				headers.map((h: any) => `${h.name}: ${String(h.value).replace(/[\r\n]/g, ' ')}`).join('\r\n') +
					'\r\n\r\n[Large message: open Gmail to read the full message.]'
			);
		} else {
			const raw = await get(`messages/${row.id}?format=raw`);
			if (typeof raw.raw !== 'string' || raw.raw.length > 720000) throw new MailError(502, 'Gmail message is too large.');
			source = Buffer.from(raw.raw, 'base64url');
		}
		messages.push(await parseMailMessage(source, folder, row.id, meta.labelIds?.includes('UNREAD') === true, large));
	}
	const nextCursor = typeof page.nextPageToken === 'string' && page.nextPageToken.length <= 2048 ? page.nextPageToken : null;
	return { folders: [folder], messages, nextCursor };
}
