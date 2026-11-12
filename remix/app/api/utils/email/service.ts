import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import { currentEmailRepository, type EmailMessageId, type ImmediateEmailOutcome } from './repository';

import { getEmailConfig, getFromAddressForStream } from './config';
import { sendWithSes } from './ses';
import type { EmailConfig, EmailStream } from './config';
import type { EmailDeliveryResult, EmailSendInput, EmailSendResult, EmailStatus } from './types';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const normalizeRecipients = (to: string | string[]) =>
  Array.from(new Set((Array.isArray(to) ? to : [to]).map(normalizeEmail).filter(Boolean)));

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const sendWithConsole = async (
  input: EmailSendInput & { to: string[]; from: string; replyTo?: string }
): Promise<EmailDeliveryResult> => {
  console.log(
    [
      `[email][console] ${input.stream || 'transactional'} message to ${input.to.join(', ')}`,
      `from: ${input.from}`,
      input.replyTo ? `reply-to: ${input.replyTo}` : undefined,
      `subject: ${input.subject}`,
      input.sensitive ? '[redacted: single-use secret]' : input.text
    ]
      .filter(Boolean)
      .join('\n')
  );

  return {
    delivered: false,
    provider: 'console'
  };
};

const deliverEmail = async (
  input: EmailSendInput & { to: string[]; from: string; replyTo?: string },
  config: EmailConfig
) => {
  if (config.provider === 'ses') {
    return sendWithSes(input, config);
  }

  return sendWithConsole(input);
};

const updateMessageStatus = async (id: EmailMessageId, status: EmailStatus, fields: ImmediateEmailOutcome = {}) => {
  await currentEmailRepository().finishImmediate(id, status, fields);
};

export const sendEmail = async (input: EmailSendInput): Promise<EmailSendResult> => {
  const repository = currentEmailRepository();
  const config = getEmailConfig();
  const stream = input.stream || 'transactional';
  const to = normalizeRecipients(input.to);
  if (!to.length) throw new Error('[email] at least one recipient is required');

  const from = input.from || getFromAddressForStream(stream, config);
  const replyTo = input.replyTo || config.replyTo;
  const now = new Date();

  // Secret-bearing mail (OTP codes, reset links) is delivered in full but the
  // outbox stores only a placeholder — a DB read must never be able to replay
  // the code/link that authOtps/passwordResets deliberately hash or single-use.
  const REDACTED = '[redacted: single-use secret]';
  const storedHtml = input.sensitive ? REDACTED : input.html;
  const storedText = input.sensitive ? REDACTED : input.text;

  const inserted = await repository.enqueue({
    provider: config.provider,
    stream,
    templateKey: input.templateKey || null,
    status: 'queued',
    from,
    replyTo: replyTo || null,
    to,
    subject: input.subject,
    html: storedHtml,
    text: storedText,
    sensitive: !!input.sensitive,
    metadata: input.metadata || {},
    tags: input.tags || {},
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.email_messages,
    createdAt: now,
    updatedAt: now
  }, { from, to, subject: input.subject, html: input.html, text: input.text, ...(replyTo ? { replyTo } : {}), ...(input.tags ? { tags: input.tags } : {}) }, input.idempotencyKey);

  const emailMessageId = String(inserted.id);
  // Native storage never pretends console output is delivery and never falls
  // back to a hosted transport. A separately authorized worker owns delivery.
  if (repository.kind === 'native-home') return { delivered: false, via: config.provider, status: inserted.status, emailMessageId };
  const suppressedRecipients = await repository.suppressed(to, stream);

  // Only skip the recipients that opted out; deliver to the rest. Skipping the
  // whole message because one address on a multi-recipient send is suppressed
  // would silently drop mail for people who never unsubscribed.
  const deliverTo = to.filter((recipient) => !suppressedRecipients.includes(recipient));
  if (!deliverTo.length) {
    await updateMessageStatus(inserted.id, 'skipped', {
      skippedAt: new Date(),
      skippedReason: 'suppressed_recipient',
      suppressedRecipients
    });
    return {
      delivered: false,
      via: config.provider,
      status: 'skipped',
      emailMessageId,
      error: `Suppressed recipient: ${suppressedRecipients.join(', ')}`
    };
  }

  try {
    const delivery = await deliverEmail({ ...input, stream, to: deliverTo, from, replyTo }, config);
    const status: EmailStatus = delivery.delivered ? 'sent' : 'logged';
    await updateMessageStatus(inserted.id, status, {
      sentAt: delivery.delivered ? new Date() : null,
      loggedAt: delivery.delivered ? null : new Date(),
      providerMessageId: delivery.providerMessageId || null,
      // record who was dropped so the outbox reflects the true recipient set
      ...(suppressedRecipients.length ? { suppressedRecipients } : {})
    });

    return {
      delivered: delivery.delivered,
      via: delivery.provider,
      status,
      emailMessageId,
      providerMessageId: delivery.providerMessageId
    };
  } catch (err) {
    const message = errorMessage(err);
    await updateMessageStatus(inserted.id, 'failed', {
      failedAt: new Date(),
      error: message
    });

    if (config.failClosed) throw err;

    console.error(`[email] failed to send ${emailMessageId}: ${message}`);
    return {
      delivered: false,
      via: config.provider,
      status: 'failed',
      emailMessageId,
      error: message
    };
  }
};
