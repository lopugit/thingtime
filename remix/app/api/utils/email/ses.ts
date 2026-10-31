import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import type { EmailConfig } from './config';
import type { EmailDeliveryInput, EmailDeliveryResult } from './types';

const clients = new Map<string, SESv2Client>();

const getSesClient = (config: EmailConfig) => {
  const cacheKey = `${config.region}:${config.accessKeyId || 'default'}`;
  const cached = clients.get(cacheKey);
  if (cached) return cached;

  const client = new SESv2Client({
    region: config.region,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
          }
        : undefined
  });
  clients.set(cacheKey, client);
  return client;
};

// SESv2 MessageTag Name AND Value accept only ASCII letters, digits, '_' and
// '-'. Our template keys are dotted (e.g. 'auth.verify_email', 'newsletter.
// generic'), and a single invalid char makes SendEmail reject the WHOLE message
// with BadRequestException — which, because sends are fire-and-forget + fail
// open, would silently drop every verification / reset / OTP / newsletter email.
// Coerce any disallowed char to '_' (never empty — the pattern requires >=1).
const sanitizeSesTag = (value: string) => (value.replace(/[^A-Za-z0-9_-]/g, '_') || '_').slice(0, 256);

const toSesTags = (tags: Record<string, string> | undefined) =>
  tags
    ? Object.entries(tags).map(([Name, Value]) => ({
        Name: sanitizeSesTag(Name),
        Value: sanitizeSesTag(Value)
      }))
    : undefined;

export const sendWithSes = async (
  input: EmailDeliveryInput,
  config: EmailConfig
): Promise<EmailDeliveryResult> => {
  const response = await getSesClient(config).send(
    new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: {
        ToAddresses: input.to
      },
      ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
      ConfigurationSetName: config.configurationSetName,
      EmailTags: toSesTags(input.tags),
      Content: {
        Simple: {
          Subject: {
            Charset: 'UTF-8',
            Data: input.subject
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: input.html
            },
            Text: {
              Charset: 'UTF-8',
              Data: input.text
            }
          }
        }
      }
    })
  );

  return {
    delivered: true,
    provider: 'ses',
    providerMessageId: response.MessageId
  };
};
