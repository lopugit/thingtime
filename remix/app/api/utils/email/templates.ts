const htmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const renderEmailVerificationTemplate = ({ link }: { link: string }) => ({
  subject: 'Verify your Thingtime email',
  text: `Welcome to Thingtime. Verify your email: ${link}`,
  html: `<p>Welcome to Thingtime.</p><p><a href="${htmlEscape(link)}">Verify your email</a></p>`
});

export const renderPasswordResetTemplate = ({
  link,
  expiresMinutes = 60
}: {
  link: string;
  expiresMinutes?: number;
}) => ({
  subject: 'Reset your Thingtime password',
  text: `Someone asked to reset your Thingtime password. If this was you, open: ${link}\nThe link expires in ${expiresMinutes} minutes. If this wasn't you, ignore this email — your password is unchanged.`,
  html: `<p>Someone asked to reset your Thingtime password.</p><p><a href="${htmlEscape(link)}">Reset your password</a> (expires in ${expiresMinutes} minutes)</p><p>If this wasn't you, ignore this email — your password is unchanged.</p>`
});

export const renderEmailOtpTemplate = ({
  code,
  expiresMinutes = 10
}: {
  code: string;
  expiresMinutes?: number;
}) => ({
  subject: 'Your Thingtime security code',
  text: `Your Thingtime security code is ${code}. It expires in ${expiresMinutes} minutes.`,
  html: `<p>Your Thingtime security code is <strong>${htmlEscape(code)}</strong>.</p><p>It expires in ${expiresMinutes} minutes.</p>`
});

export const renderNewsletterTemplate = ({
  title,
  bodyText,
  bodyHtml,
  unsubscribeUrl
}: {
  title: string;
  bodyText: string;
  bodyHtml: string;
  unsubscribeUrl?: string;
}) => ({
  subject: title,
  text: unsubscribeUrl ? `${bodyText}\n\nUnsubscribe: ${unsubscribeUrl}` : bodyText,
  html: unsubscribeUrl
    ? `${bodyHtml}<hr><p><a href="${htmlEscape(unsubscribeUrl)}">Unsubscribe</a></p>`
    : bodyHtml
});
