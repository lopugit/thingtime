import {
  getEmailEventsCollection,
  getEmailSuppressionListCollection,
  getEmailUnsubscribesCollection
} from '../mongodb/collections';

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
  await (await getEmailEventsCollection()).insertOne(doc);
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
  await (await getEmailSuppressionListCollection()).updateOne(
    { email: normalizeEmail(email) },
    {
      $set: {
        email: normalizeEmail(email),
        reason,
        payload: payload || {},
        active: true,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );
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
  await (await getEmailUnsubscribesCollection()).updateOne(
    { email: normalizeEmail(email), listId },
    {
      $set: {
        email: normalizeEmail(email),
        listId,
        source,
        unsubscribedAt: now,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );
};
