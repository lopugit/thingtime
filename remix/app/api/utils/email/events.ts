import { currentEmailRepository } from './repository';

export type EmailEventInput = {
  eventType: string;
  emailMessageId?: string;
  providerMessageId?: string;
  email?: string;
  payload?: Record<string, any>;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const recordEmailEvent = async (input: EmailEventInput) => {
  const now = new Date();
  const doc = {
    eventType: input.eventType,
    emailMessageId: input.emailMessageId || null,
    providerMessageId: input.providerMessageId || null,
    email: input.email ? normalizeEmail(input.email) : null,
    payload: input.payload || {},
    receivedAt: now,
    createdAt: now
  };
  await currentEmailRepository().recordEvent(doc);
  return doc;
};

export const suppressEmailAddress = async ({
  email,
  reason,
  payload
}: {
  email: string;
  reason: string;
  payload?: Record<string, any>;
}) => {
  const now = new Date();
  await currentEmailRepository().suppress(normalizeEmail(email), reason, payload || {}, now);
};

export const unsubscribeEmailAddress = async ({
  email,
  listId = 'newsletter',
  source = 'app'
}: {
  email: string;
  listId?: string;
  source?: string;
}) => {
  const now = new Date();
  await currentEmailRepository().unsubscribe(normalizeEmail(email), listId, source, now);
};
