import { MailError, mailText } from './model';
export type GmailCompose = { to: string; cc: string; bcc: string; subject: string; text: string };
export type GmailDraft = GmailCompose & { id: string; messageId: string; editable: boolean };
export type LocalGmailDraft = GmailCompose & {
	id: string;
	accountId: string;
	localRevision: number;
	googleId?: string;
	messageId?: string;
	sendWriteId?: string;
	saveWriteId?: string;
};
export const emptyGmailCompose = (): GmailCompose => ({ to: '', cc: '', bcc: '', subject: '', text: '' });
export function gmailId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new MailError(400, 'Invalid Gmail record.');
	return value;
}
function recipients(raw: unknown, field: string) {
	const value = mailText(raw ?? '', field, 4000, true).trim();
	if (!value) return '';
	const addresses = value.split(',').map((value) => value.trim());
	if (
		addresses.length > 50 ||
		addresses.some(
			(address) => address.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(address)
		)
	)
		throw new MailError(400, `Enter comma-separated email addresses in ${field}.`);
	return addresses.join(', ');
}
export function gmailCompose(raw: any, sending = false): GmailCompose {
	const value = {
		to: recipients(raw?.to, 'To'),
		cc: recipients(raw?.cc, 'Cc'),
		bcc: recipients(raw?.bcc, 'Bcc'),
		subject: mailText(raw?.subject ?? '', 'subject', 500, true),
		text: mailText(raw?.text ?? '', 'message', 30000, true)
	};
	if (/[\r\n]/.test(value.subject)) throw new MailError(400, 'Subject must be one line.');
	if (sending && !value.to && !value.cc && !value.bcc) throw new MailError(400, 'Add at least one recipient.');
	return value;
}
export function gmailMutation(raw: any) {
	const action = raw?.action;
	if (['read', 'unread', 'archive', 'trash', 'untrash'].includes(action)) return { action, remoteId: gmailId(raw.remoteId) };
	if (action === 'label-add' || action === 'label-remove') {
		const labelId = gmailId(raw.labelId);
		if (!labelId.startsWith('Label_')) throw new MailError(400, 'Choose a custom Gmail label.');
		return { action, remoteId: gmailId(raw.remoteId), labelId };
	}
	if (action === 'label-create' || action === 'label-rename') {
		const name = mailText(raw.name, 'label name', 225).trim();
		if (/[\r\n]/.test(name)) throw new MailError(400, 'Label must be one line.');
		const labelId = action === 'label-rename' ? gmailId(raw.labelId) : undefined;
		if (labelId && !labelId.startsWith('Label_')) throw new MailError(400, 'Only custom labels can be renamed.');
		return { action, name, ...(labelId ? { labelId } : {}) };
	}
	if (action === 'draft-save' || action === 'send') {
		const draftId = raw.draftId ? gmailId(raw.draftId) : undefined;
		if (action === 'send' && !draftId) throw new MailError(400, 'Save the Gmail draft before sending.');
		return { action, compose: gmailCompose(raw.compose, action === 'send'), ...(draftId ? { draftId, messageId: gmailId(raw.messageId) } : {}) };
	}
	throw new MailError(400, 'Unsupported Gmail action.');
}
export type GmailMutation = ReturnType<typeof gmailMutation>;
