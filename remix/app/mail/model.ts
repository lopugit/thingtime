/** Identical mail records for the cloud API, browser store and local connector. */
export const MAIL_VERSION = 1;
export const MAIL_KINDS = ['mail-account', 'mail-folder', 'mail-message', 'mail-inbox'] as const;
export type MailProtocol = 'imap' | 'pop3';
export type MailServer = { host: string; port: number; security: 'tls' | 'starttls'; username: string; password?: string };
export type MailAccount = {
	id: string;
	name: string;
	address: string;
	revision: number;
	servers: Partial<Record<MailProtocol, MailServer>>;
	sync: { cloud: boolean; local: boolean; transport?: 'connector' | 'native' | 'relay' };
};
export type MailFolder = { id: string; accountId: string; protocol: MailProtocol; path: string; name: string; inbox: boolean };
export type MailMessage = {
	id: string;
	accountId: string;
	folderId: string;
	remoteId: string;
	subject: string;
	from: string;
	to: string;
	date: string | null;
	text: string;
	unread: boolean;
	attachmentCount: number;
	truncated: boolean;
};
export type MailInbox = { id: string; name: string; folderIds: string[]; revision: number };
export type MailBatch = { folders: MailFolder[]; messages: MailMessage[]; nextCursor: string | null };
export type MailState = { accounts: MailAccount[]; folders: MailFolder[]; messages: MailMessage[]; inboxes: MailInbox[] };
export const emptyMailState = (): MailState => ({ accounts: [], folders: [], messages: [], inboxes: [] });
export class MailError extends Error {
	constructor(public status: number, message: string) {
		super(message);
		this.name = 'MailError';
	}
}
export const validMailId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
export function mailId(value: unknown): string {
	if (!validMailId(value)) throw new MailError(400, 'Invalid mail record id.');
	return value;
}
export function mailText(value: unknown, label: string, max: number, empty = false): string {
	if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
		throw new MailError(400, `Invalid ${label}.`);
	return value;
}
export function revision(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new MailError(400, 'A current revision is required.');
	return Number(value);
}
export function validateMailAccount(raw: any): MailAccount {
	if (!raw || typeof raw !== 'object') throw new MailError(400, 'Enter your email account settings.');
	const servers: MailAccount['servers'] = {};
	for (const protocol of ['imap', 'pop3'] as const) {
		const server = raw.servers?.[protocol];
		if (!server) continue;
		const host = mailText(server.host, 'mail server hostname', 253).trim().toLowerCase();
		// DNS names only: IP literals and URL syntax do not belong in this field.
		if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(host))
			throw new MailError(400, 'Enter a mail server hostname, without a URL or IP address.');
		if (server.security !== 'tls' && server.security !== 'starttls') throw new MailError(400, 'Mail connections require TLS or STARTTLS.');
		// Restrict the protocol adapter to mail ports; it cannot become a generic
		// cloud or localhost TCP scanner. No plaintext credential mode exists.
		const port = protocol === 'imap' ? (server.security === 'tls' ? 993 : 143) : server.security === 'tls' ? 995 : 110;
		if (server.port !== port) throw new MailError(400, `Use port ${port} for ${protocol.toUpperCase()} with ${server.security.toUpperCase()}.`);
		const username = mailText(server.username, 'mail username', 512);
		if (/[\r\n]/.test(username)) throw new MailError(400, 'Invalid mail username.');
		servers[protocol] = { host, port, security: server.security, username };
		if (server.password !== undefined) {
			const password = mailText(server.password, 'mail password', 4096);
			if (/[\r\n]/.test(password)) throw new MailError(400, 'Invalid mail password.');
			servers[protocol]!.password = password;
		}
	}
	if (!Object.keys(servers).length) throw new MailError(400, 'Enable IMAP or POP3.');
	if (typeof raw.sync?.cloud !== 'boolean' || typeof raw.sync?.local !== 'boolean') throw new MailError(400, 'Choose where this account syncs.');
	if (raw.sync.transport !== undefined && !['connector', 'native', 'relay'].includes(raw.sync.transport))
		throw new MailError(400, 'Choose a supported device sync connection.');
	const address = mailText(raw.address, 'email address', 320).trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new MailError(400, 'Enter an email address.');
	return {
		id: mailId(raw.id),
		name: mailText(raw.name, 'account name', 160).trim(),
		address,
		revision: revision(raw.revision),
		servers,
		sync: { cloud: raw.sync.cloud, local: raw.sync.local, ...(raw.sync.transport ? { transport: raw.sync.transport } : {}) }
	};
}
export function publicMailAccount(account: MailAccount): MailAccount {
	return {
		...account,
		servers: Object.fromEntries(
			Object.entries(account.servers).map(([protocol, server]) => [
				protocol,
				{ host: server.host, port: server.port, security: server.security, username: server.username }
			])
		)
	};
}
export function validateMailInbox(raw: any): MailInbox {
	if (!raw || !Array.isArray(raw.folderIds) || raw.folderIds.length < 1 || raw.folderIds.length > 200)
		throw new MailError(400, 'Choose between 1 and 200 source folders.');
	return {
		id: mailId(raw.id),
		name: mailText(raw.name, 'inbox name', 160).trim(),
		revision: revision(raw.revision),
		folderIds: [...new Set<string>(raw.folderIds.map(mailId))]
	};
}
/** Proxy inboxes select source rows only. They never copy, move or delete mail. */
export function selectMailMessages(state: MailState, selection: string): MailMessage[] {
	const proxy = state.inboxes.find((inbox) => inbox.id === selection);
	const folders = new Set(
		proxy
			? proxy.folderIds
			: state.folders
					.filter((folder) => (selection === 'all' ? folder.inbox : folder.id === selection || folder.accountId === selection))
					.map((folder) => folder.id)
	);
	return state.messages
		.filter((message) => folders.has(message.folderId))
		.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
}
export function mergeMailRows<T extends { id: string }>(current: T[], incoming: T[]): T[] {
	return [...new Map([...current, ...incoming].map((row) => [row.id, row])).values()];
}

/** Never reuse a device password after another device changes the destination. */
export function localSyncAccount(account: MailAccount, credentials: MailAccount['servers']): MailAccount {
	const servers: MailAccount['servers'] = {};
	for (const protocol of ['imap', 'pop3'] as const) {
		const server = account.servers[protocol];
		if (!server) continue;
		const saved = credentials[protocol];
		if (
			!saved?.password ||
			saved.host !== server.host ||
			saved.port !== server.port ||
			saved.security !== server.security ||
			saved.username !== server.username
		)
			throw new MailError(409, 'Re-enter the local app password after changing mail server settings.');
		servers[protocol] = { ...server, password: saved.password };
	}
	return { ...account, servers };
}
