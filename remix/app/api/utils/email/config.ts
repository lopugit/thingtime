export type EmailProvider = 'console' | 'ses';
export type EmailStream = 'transactional' | 'newsletter' | 'notification';

export type EmailConfig = {
  provider: EmailProvider;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  transactionalFrom: string;
  newsletterFrom: string;
  notificationFrom: string;
  replyTo?: string;
  configurationSetName?: string;
  failClosed: boolean;
};

const firstPresent = (...values: Array<string | undefined>) => values.find((value) => value?.trim())?.trim();

const getProvider = (): EmailProvider => {
  const provider = process.env.THINGTIME_EMAIL_PROVIDER?.trim().toLowerCase();
  return provider === 'ses' ? 'ses' : 'console';
};

export const getEmailConfig = (): EmailConfig => ({
  provider: getProvider(),
  region: firstPresent(process.env.AWS_SES_REGION, process.env.AWS_REGION) || 'us-east-1',
  accessKeyId: firstPresent(process.env.AWS_SES_ACCESS_KEY_ID, process.env.AWS_ACCESS_KEY_ID),
  secretAccessKey: firstPresent(process.env.AWS_SES_SECRET_ACCESS_KEY, process.env.AWS_SECRET_ACCESS_KEY),
  transactionalFrom:
    firstPresent(process.env.THINGTIME_EMAIL_TRANSACTIONAL_FROM, process.env.THINGTIME_EMAIL_FROM) ||
    'Thingtime <no-reply@thingtime.com>',
  newsletterFrom:
    firstPresent(process.env.THINGTIME_EMAIL_NEWSLETTER_FROM, process.env.THINGTIME_EMAIL_FROM) ||
    'Thingtime Updates <updates@thingtime.com>',
  notificationFrom:
    firstPresent(
      process.env.THINGTIME_EMAIL_NOTIFICATIONS_FROM,
      process.env.THINGTIME_EMAIL_TRANSACTIONAL_FROM,
      process.env.THINGTIME_EMAIL_FROM
    ) || 'Thingtime <no-reply@thingtime.com>',
  replyTo: firstPresent(process.env.THINGTIME_EMAIL_REPLY_TO),
  configurationSetName: firstPresent(process.env.AWS_SES_CONFIGURATION_SET, process.env.THINGTIME_EMAIL_CONFIGURATION_SET),
  failClosed: process.env.THINGTIME_EMAIL_FAIL_CLOSED === 'true'
});

export const getFromAddressForStream = (stream: EmailStream, config = getEmailConfig()) => {
  if (stream === 'newsletter') return config.newsletterFrom;
  if (stream === 'notification') return config.notificationFrom;
  return config.transactionalFrom;
};
