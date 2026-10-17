import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import { MailActionError, MailError } from '~/mail/model';
import { gmailId, type GmailCompose, type GmailDraft, type GmailMutation } from '~/mail/googleModel';
import { googleMailClient, type PrivateMailAccount } from './google';
type Client = Awaited<ReturnType<typeof googleMailClient>>;
const addresses = (value: any) =>
	(Array.isArray(value) ? value.flatMap((v) => v.value || []) : value?.value || [])
		.map((v: any) => v.address)
		.filter(Boolean)
		.join(', ');
/** Encode only explicit fields; arbitrary headers, sender spoofing and attachments are not accepted. */
export function gmailRaw(address: string, compose: GmailCompose, operationId: string) {
	// RFC 2047 encoded words stay below 75 characters, without splitting UTF-8.
	const words: string[] = [];
	let word = '';
	for (const character of compose.subject) {
		if (Buffer.byteLength(word + character) > 42) {
			words.push(word);
			word = '';
		}
		word += character;
	}
	words.push(word);
	const subject = words.map((value) => `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`).join('\r\n ');
	const recipients = (value: string) => value.split(', ').join(',\r\n ');
	const body =
		Buffer.from(compose.text)
			.toString('base64')
			.match(/.{1,76}/g)
			?.join('\r\n') || '';
	return Buffer.from(
		[
			`From: ${address}`,
			`To: ${recipients(compose.to)}`,
			`Cc: ${recipients(compose.cc)}`,
			`Bcc: ${recipients(compose.bcc)}`,
			`Subject: ${subject}`,
			`Message-ID: <${createHash('sha256').update(operationId).digest('hex')}@mail.thingtime.com>`,
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset=utf-8',
			'Content-Transfer-Encoding: base64',
			'',
			body
		].join('\r\n')
	).toString('base64url');
}
async function readDraft(client: Client, id: string): Promise<GmailDraft> {
	const draft = await client(`drafts/${gmailId(id)}?format=raw`);
	if (typeof draft.message?.raw !== 'string' || draft.message.raw.length > 720000)
		throw new MailError(400, 'This draft is too large to edit here. Open it in Gmail.');
	const mail = await simpleParser(Buffer.from(draft.message.raw, 'base64url'), { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
	return {
		id: gmailId(draft.id),
		messageId: gmailId(draft.message.id),
		to: addresses(mail.to),
		cc: addresses(mail.cc),
		bcc: addresses(mail.bcc),
		subject: (mail.subject || '').slice(0, 500),
		text: (mail.text || '').slice(0, 30000),
		editable: !mail.attachments.length && !mail.html && (mail.text?.length || 0) <= 30000 && (mail.subject?.length || 0) <= 500
	};
}
export async function readGoogleDrafts(account: PrivateMailAccount, input: any, signal?: AbortSignal, makeClient = googleMailClient) {
	signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
	const client = await makeClient(account, signal);
	if (input.draftId) return { draft: await readDraft(client, input.draftId) };
	if (input.cursor && (typeof input.cursor !== 'string' || input.cursor.length > 2048)) throw new MailError(400, 'Invalid Gmail draft cursor.');
	const page = await client('drafts?' + new URLSearchParams({ maxResults: '20', ...(input.cursor ? { pageToken: input.cursor } : {}) }));
	if (page.drafts !== undefined && (!Array.isArray(page.drafts) || page.drafts.length > 20)) throw new MailError(502, 'Invalid Gmail drafts page.');
	const drafts = [];
	for (const row of page.drafts || []) {
		const id = gmailId(row.id),
			draft = await client(`drafts/${id}?format=metadata`);
		const headers = draft.message?.payload?.headers || [];
		drafts.push({ id, subject: String(headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(No subject)').slice(0, 500) });
	}
	return { drafts, nextCursor: typeof page.nextPageToken === 'string' && page.nextPageToken.length <= 2048 ? page.nextPageToken : null };
}
export async function applyGoogleMailMutation(
	account: PrivateMailAccount,
	input: GmailMutation,
	operationId: string,
	signal?: AbortSignal,
	makeClient = googleMailClient
) {
	let dispatched = false;
	try {
		const rawClient = await makeClient(account, signal);
		const client: Client = async (path, method = 'GET', body) => {
			if (method !== 'GET') dispatched = true;
			return rawClient(path, method, body);
		};
		const value = input as any,
			action = value.action;
		if (action === 'draft-save' || action === 'send') {
			if (value.draftId) {
				const current = await readDraft(client, value.draftId);
				if (!current.editable) throw new MailError(409, 'Open this rich-text or attachment draft in Gmail to preserve its content.');
				if (current.messageId !== value.messageId)
					throw new MailError(409, 'This Gmail draft changed elsewhere. Reopen it before saving or sending.');
			}
			const raw = gmailRaw(account.address, value.compose, operationId);
			const result =
				action === 'send'
					? await client('drafts/send', 'POST', { id: value.draftId, message: { raw } })
					: await client(value.draftId ? `drafts/${value.draftId}` : 'drafts', value.draftId ? 'PUT' : 'POST', { message: { raw } });
			return action === 'send' ? { sentId: gmailId(result.id) } : { draftId: gmailId(result.id), messageId: gmailId(result.message?.id) };
		}
		if (action === 'label-create' || action === 'label-rename') {
			const result = await client(action === 'label-create' ? 'labels' : `labels/${value.labelId}`, action === 'label-create' ? 'POST' : 'PATCH', {
				name: value.name
			});
			return { labelId: gmailId(result.id), name: String(result.name).slice(0, 225) };
		}
		const addLabelIds = action === 'unread' ? ['UNREAD'] : action === 'label-add' ? [value.labelId] : [];
		const removeLabelIds = action === 'read' ? ['UNREAD'] : action === 'archive' ? ['INBOX'] : action === 'label-remove' ? [value.labelId] : [];
		const result = await client(
			`messages/${value.remoteId}/${action === 'trash' ? 'trash' : action === 'untrash' ? 'untrash' : 'modify'}`,
			'POST',
			action === 'trash' || action === 'untrash' ? {} : { addLabelIds, removeLabelIds }
		);
		if (!Array.isArray(result.labelIds) || result.labelIds.length > 1000) throw new MailError(502, 'Gmail returned invalid labels.');
		return { remoteId: gmailId(result.id), labelIds: result.labelIds.map(gmailId), unread: result.labelIds.includes('UNREAD') };
	} catch (error) {
		if (!dispatched)
			throw new MailActionError(
				error instanceof MailError ? error.status : 503,
				error instanceof MailError ? error.message : 'Gmail could not prepare this action. Try again.',
				'not-applied'
			);
		throw new MailActionError(
			409,
			'Gmail did not confirm the result. Check Gmail before starting a new action; this request will not be repeated.',
			'uncertain'
		);
	}
}
