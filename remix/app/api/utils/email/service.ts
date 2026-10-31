import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import {
  getEmailMessagesCollection,
  getEmailSuppressionListCollection,
  getEmailUnsubscribesCollection
} from '../mongodb/collections';

import { getEmailConfig, getFromAddressForStream } from './config';
import { sendWithSes } from './ses';
import type { EmailConfig, EmailStream } from './config';
import type { EmailDeliveryResult, EmailSendInput, EmailSendResult, EmailStatus } from './types';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const normalizeRecipients = (to: string | string[]) =>
  Array.from(new Set((Array.isArray(to) ? to : [to]).map(normalizeEmail).filter(Boolean)));

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const getSuppressedRecipients = async (recipients: string[], stream: EmailStream) => {
  const suppressionDocs = await (await getEmailSuppressionListCollection())
    .find({
      email: { $in: recipients },
      active: { $ne: false }
    })
    .project({ email: 1 })
    .toArray();

  const suppressed = new Set(
    suppressionDocs
      .map((doc) => (typeof doc.email === 'string' ? normalizeEmail(doc.email) : ''))
      .filter(Boolean)
  );

  if (stream === 'newsletter') {
    const unsubscribeDocs = await (await getEmailUnsubscribesCollection())
      .find({ email: { $in: recipients } })
      .project({ email: 1 })
      .toArray();
    unsubscribeDocs.forEach((doc) => {
      if (typeof doc.email === 'string') suppressed.add(normalizeEmail(doc.email));
    });
  }

  return recipients.filter((recipient) => suppressed.has(recipient));
};

const sendWithConsole = async (
  input: EmailSendInput & { to: string[]; from: string; replyTo?: string }
): Promise<EmailDeliveryResult> => {
  console.log(
    [
      `[email][console] ${input.stream || 'transactional'} message to ${input.to.join(', ')}`,
      `from: ${input.from}`,
      input.replyTo ? `reply-to: ${input.replyTo}` : undefined,
      `subject: ${input.subject}`,
      input.text
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

const updateMessageStatus = async (
  emailMessageId: any,
  status: EmailStatus,
  fields: Record<string, any> = {}
) => {
  await (await getEmailMessagesCollection()).updateOne(
    { _id: emailMessageId },
    {
      $set: {
        status,
        updatedAt: new Date(),
        ...fields
      }
    }
  );
};

export const sendEmail = async (input: EmailSendInput): Promise<EmailSendResult> => {
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

  const inserted = await (await getEmailMessagesCollection()).insertOne({
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
  });

  const emailMessageId = String(inserted.insertedId);
  const suppressedRecipients = await getSuppressedRecipients(to, stream);

  // Only skip the recipients that opted out; deliver to the rest. Skipping the
  // whole message because one address on a multi-recipient send is suppressed
  // would silently drop mail for people who never unsubscribed.
  const deliverTo = to.filter((recipient) => !suppressedRecipients.includes(recipient));
  if (!deliverTo.length) {
    await updateMessageStatus(inserted.insertedId, 'skipped', {
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
    await updateMessageStatus(inserted.insertedId, status, {
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
    await updateMessageStatus(inserted.insertedId, 'failed', {
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
