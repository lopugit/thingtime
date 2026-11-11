import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
	MailError,
	validateMailAccount,
	type MailAccount,
	type MailBatch,
	type MailFolder,
	type MailMessage,
	type MailProtocol
} from '../../../mail/model';
import { resolveMailHost } from './network';
import { Pop3Reader } from './pop3';
export const MAIL_PAGE_SIZE = 10;
export const MAIL_SOURCE_BYTES = 512 * 1024;
const stableId = (...parts: string[]) => 'mail_' + createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const folderFor = (
	accountId: string,
	protocol: MailProtocol,
	path: string,
	name = path,
	inbox = path.toUpperCase() === 'INBOX'
): MailFolder => ({ id: stableId(accountId, protocol, path), accountId, protocol, path, name, inbox });
const clean = (value: unknown, max: number) =>
	typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, max) : '';
export async function parseMailMessage(
	source: Buffer,
	folder: MailFolder,
	remoteId: string,
	unread = true,
	truncated = false,
	fallbackDate?: Date
): Promise<MailMessage> {
	if (source.length > MAIL_SOURCE_BYTES) throw new MailError(502, 'Mail source exceeds the download limit.');
	// HTML is converted to text by mailparser and never inserted into the DOM.
	// External resources, scripts and tracking pixels are never fetched.
	const mail = await simpleParser(source, {
		skipHtmlToText: false,
		skipTextToHtml: true,
		skipImageLinks: true,
		maxHtmlLengthToParse: MAIL_SOURCE_BYTES
	});
	const text = clean(mail.text, 12000);
	const date = mail.date || fallbackDate;
	return {
		id: stableId(folder.accountId, folder.id, remoteId),
		accountId: folder.accountId,
		folderId: folder.id,
		remoteId,
		subject: clean(mail.subject || '(No subject)', 512),
		from: clean(mail.from?.text, 1000),
		to: clean(Array.isArray(mail.to) ? mail.to.map((address) => address.text).join(', ') : mail.to?.text, 1000),
		date: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
		text,
		unread,
		attachmentCount: mail.attachments.length,
		truncated: truncated || (mail.text?.length ?? 0) > text.length
	};
}
function parseCursor(cursor: unknown, folderId: string): { remoteId: string; epoch: string } | null {
	if (cursor === undefined || cursor === null) return null;
	try {
		if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
		const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
		if (
			value.folderId !== folderId ||
			typeof value.remoteId !== 'string' ||
			value.remoteId.length > 100 ||
			typeof value.epoch !== 'string' ||
			value.epoch.length > 40
		)
			throw new Error();
		return value;
	} catch {
		throw new MailError(400, 'Invalid mail page cursor.');
	}
}
const cursorFor = (folderId: string, remoteId: string, epoch: string) =>
	Buffer.from(JSON.stringify({ folderId, remoteId, epoch })).toString('base64url');
export type MailSyncRequest = { protocol: MailProtocol; path?: string; cursor?: string | null; discover?: boolean };
export async function fetchMailBatch(
	rawAccount: MailAccount,
	request: MailSyncRequest,
	callerSignal?: AbortSignal,
	deps = { resolveMailHost }
): Promise<MailBatch> {
	const account = validateMailAccount(rawAccount);
	if (request.protocol !== 'imap' && request.protocol !== 'pop3') throw new MailError(400, 'Choose IMAP or POP3.');
	const server = account.servers[request.protocol];
	if (!server?.password) throw new MailError(400, 'Enter an app password for this mail server.');
	if (request.path !== undefined && (typeof request.path !== 'string' || request.path.length > 512 || /[\x00-\x1f\x7f]/.test(request.path)))
		throw new MailError(400, 'Invalid mail folder.');
	const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
	const destination = await deps.resolveMailHost(server.host, signal);
	if (request.protocol === 'pop3') {
		const folder = folderFor(account.id, 'pop3', 'INBOX');
		if (request.path && request.path !== 'INBOX') throw new MailError(400, 'POP3 provides one inbox.');
		if (request.discover) return { folders: [folder], messages: [], nextCursor: null };
		const reader = await Pop3Reader.connect(server, destination.address, signal);
		try {
			const all = (await reader.list()).reverse();
			const cursor = parseCursor(request.cursor, folder.id);
			const index = cursor ? all.findIndex((item) => item.uid === cursor.remoteId) : -1;
			if (cursor && index < 0) throw new MailError(409, 'The mailbox changed. Refresh before loading older mail.');
			const page = all.slice(index + 1, index + 1 + MAIL_PAGE_SIZE);
			const messages: MailMessage[] = [];
			for (const item of page) {
				if (item.size > MAIL_SOURCE_BYTES) {
					messages.push({
						id: stableId(account.id, folder.id, item.uid),
						accountId: account.id,
						folderId: folder.id,
						remoteId: item.uid,
						subject: '(Large message)',
						from: '',
						to: '',
						date: null,
						text: 'This message exceeds the 512 KiB download limit. Open it with your email provider.',
						unread: true,
						attachmentCount: 0,
						truncated: true
					});
				} else messages.push(await parseMailMessage(await reader.retrieve(item.number, MAIL_SOURCE_BYTES), folder, item.uid));
			}
			return {
				folders: [folder],
				messages,
				nextCursor: index + 1 + page.length < all.length && page.length ? cursorFor(folder.id, page.at(-1)!.uid, '') : null
			};
		} finally {
			reader.close();
		}
	}
	const client = new ImapFlow({
		host: destination.address,
		port: server.port,
		servername: server.host,
		secure: server.security === 'tls',
		doSTARTTLS: server.security === 'starttls',
		auth: { user: server.username, pass: server.password },
		logger: false,
		tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
		disableAutoIdle: true,
		disableCompression: true,
		maxLiteralSize: MAIL_SOURCE_BYTES,
		maxResponseSize: MAIL_SOURCE_BYTES + 64 * 1024,
		maxLineLength: 64 * 1024,
		connectionTimeout: 15000,
		greetingTimeout: 15000,
		socketTimeout: 20000
	});
	client.on('error', () => {});
	const abort = () => client.close();
	signal.addEventListener('abort', abort, { once: true });
	try {
		signal.throwIfAborted();
		await client.connect();
		signal.throwIfAborted();
		if (request.discover) {
			const rows = await client.list();
			if (rows.length > 1000) throw new MailError(413, 'This account has more than 1,000 folders.');
			return {
				folders: rows
					.filter((row) => !row.flags.has('\\Noselect'))
					.map((row) => folderFor(account.id, 'imap', row.path, row.name, row.specialUse === '\\Inbox' || row.path.toUpperCase() === 'INBOX')),
				messages: [],
				nextCursor: null
			};
		}
		const folder = folderFor(account.id, 'imap', request.path || 'INBOX');
		const cursor = parseCursor(request.cursor, folder.id);
		const mailbox = await client.mailboxOpen(folder.path, { readOnly: true });
		const epoch = String(mailbox.uidValidity);
		if (cursor && (cursor.epoch !== epoch || !/^[1-9][0-9]{0,9}$/.test(cursor.remoteId)))
			throw new MailError(409, 'The mailbox changed. Refresh before loading older mail.');
		let end = mailbox.exists;
		if (cursor) {
			const anchor = await client.fetchOne(cursor.remoteId, { uid: true }, { uid: true });
			if (!anchor) throw new MailError(409, 'The mailbox changed. Refresh before loading older mail.');
			end = anchor.seq - 1;
		}
		if (!end) return { folders: [folder], messages: [], nextCursor: null };
		const start = Math.max(1, end - MAIL_PAGE_SIZE + 1);
		const messages: MailMessage[] = [];
		let oldest = Infinity;
		for await (const row of client.fetch(`${start}:${end}`, {
			uid: true,
			flags: true,
			internalDate: true,
			size: true,
			source: { maxLength: MAIL_SOURCE_BYTES }
		})) {
			signal.throwIfAborted();
			if (messages.length >= MAIL_PAGE_SIZE) throw new MailError(502, 'The server exceeded the requested mail page.');
			oldest = Math.min(oldest, row.uid);
			messages.push(
				await parseMailMessage(
					row.source || Buffer.alloc(0),
					folder,
					`${epoch}:${row.uid}`,
					!row.flags?.has('\\Seen'),
					(row.size || 0) > MAIL_SOURCE_BYTES,
					row.internalDate instanceof Date ? row.internalDate : undefined
				)
			);
		}
		return { folders: [folder], messages, nextCursor: start > 1 && Number.isFinite(oldest) ? cursorFor(folder.id, String(oldest), epoch) : null };
	} finally {
		signal.removeEventListener('abort', abort);
		client.close();
	}
}
