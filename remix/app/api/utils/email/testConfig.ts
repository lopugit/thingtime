import { getEmailConfig } from './config';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEFAULT_TEST_RECIPIENT = 'support@thingtime.com';

const firstPresent = (...values: Array<string | undefined>) => values.find((value) => value?.trim())?.trim();

const isTruthyEnv = (value: string | undefined) => TRUE_VALUES.has((value || '').trim().toLowerCase());

const parseEmail = (value: string) => {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;

  return {
    email,
    local: email.slice(0, at),
    domain: email.slice(at + 1)
  };
};

export const getEmailTestConfig = () => {
  const config = getEmailConfig();
  const sesSandbox = isTruthyEnv(
    firstPresent(process.env.SES_SANDBOX, process.env.AWS_SES_SANDBOX, process.env.THINGTIME_EMAIL_SES_SANDBOX)
  );
  const sandboxSendDelayMs = sesSandbox ? 1000 : 0;
  const testRecipient = firstPresent(process.env.THINGTIME_EMAIL_TEST_RECIPIENT) || DEFAULT_TEST_RECIPIENT;
  const parsedRecipient = parseEmail(testRecipient);

  return {
    provider: config.provider,
    region: config.region,
    configurationSetName: config.configurationSetName || null,
    transactionalFrom: config.transactionalFrom,
    newsletterFrom: config.newsletterFrom,
    sesSandbox,
    sandboxSendDelayMs,
    testRecipient,
    testRecipientDomain: parsedRecipient?.domain || 'thingtime.com'
  };
};

export const isAllowedEmailTestRecipient = (candidate: string) => {
  const configured = parseEmail(getEmailTestConfig().testRecipient);
  const parsedCandidate = parseEmail(candidate);
  if (!configured || !parsedCandidate) return false;
  if (parsedCandidate.email === configured.email) return true;

  return (
    parsedCandidate.domain === configured.domain &&
    parsedCandidate.local.startsWith(`${configured.local}+`)
  );
};
