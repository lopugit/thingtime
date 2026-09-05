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

// Internal ops mail: a new account finished email verification and is waiting
// for an admin to grant public file/media uploads. Sent to the admin inbox
// (THINGTIME_ADMIN_NOTIFICATION_EMAIL, default admin@thingtime.com), never to
// the user, so it carries the account details an admin needs to decide.
export const renderNewUserAdminNotificationTemplate = ({
  username,
  email,
  displayName,
  userId,
  createdAt,
  adminUrl
}: {
  username: string;
  email: string;
  displayName?: string | null;
  userId: string;
  createdAt?: string | null;
  adminUrl: string;
}) => {
  const rows: Array<[string, string]> = [
    ['Username', `@${username}`],
    ['Display name', displayName || '—'],
    ['Email', email],
    ['User id', userId],
    ['Signed up', createdAt || '—'],
    ['Email verified', 'yes']
  ];
  return {
    subject: `New Thingtime user: @${username}`,
    text: [
      `A new user verified their email and is awaiting file/media upload approval (public and private uploads are both withheld).`,
      '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      `Approve public, private, or all uploads in the admin Users tab: ${adminUrl}`
    ].join('\n'),
    html:
      `<p>A new user verified their email and is awaiting <strong>file/media upload approval</strong> (public and private uploads are both withheld).</p>` +
      `<table cellpadding="4" style="border-collapse:collapse">${rows
        .map(([label, value]) => `<tr><td><strong>${htmlEscape(label)}</strong></td><td>${htmlEscape(value)}</td></tr>`)
        .join('')}</table>` +
      `<p><a href="${htmlEscape(adminUrl)}">Open the admin Users tab</a> to enable their public, private, or all file and media uploads.</p>`
  };
};

// Activity notification emails (friend requests, reactions, comments, …).
// Subjects/bodies stay per-type so the inbox line reads like the bell row;
// every email carries a manage link and a one-click unsubscribe-all link.

export type NotificationEmailInput = {
  type: string;
  actorName: string | null;
  // system notes: the headline IS the subject + first line
  headline?: string | null;
  preview?: string | null;
  // click-through target (the post, or the actor's profile)
  ctaUrl: string;
  ctaLabel: string;
  settingsUrl: string;
  unsubscribeUrl?: string;
};

const NOTIFICATION_EMAIL_COPY: Record<string, { subject: (actor: string) => string; line: (actor: string) => string }> = {
  'friend-request': {
    subject: (actor) => `${actor} wants to be your friend on Thingtime 🤝`,
    line: (actor) => `${actor} sent you a friend request.`
  },
  'friend-accepted': {
    subject: (actor) => `${actor} accepted your friend request 💚`,
    line: (actor) => `${actor} accepted your friend request — you're friends now.`
  },
  'new-follower': {
    subject: (actor) => `${actor} started following you on Thingtime 👀`,
    line: (actor) => `${actor} started following you.`
  },
  'post-from-followed': {
    subject: (actor) => `${actor} just posted on Thingtime 📰`,
    line: (actor) => `${actor} shared a new post.`
  },
  'post-from-friend': {
    subject: (actor) => `Your friend ${actor} just posted 🫶`,
    line: (actor) => `Your friend ${actor} shared a new post.`
  },
  comment: {
    subject: (actor) => `${actor} commented on your post 💬`,
    line: (actor) => `${actor} commented on your post.`
  },
  reply: {
    subject: (actor) => `${actor} replied to your comment ↩️`,
    line: (actor) => `${actor} replied to your comment.`
  },
  reaction: {
    subject: (actor) => `${actor} reacted to your post 🤣`,
    line: (actor) => `${actor} reacted to your post.`
  },
  share: {
    subject: (actor) => `${actor} shared your post 🔁`,
    line: (actor) => `${actor} shared your post.`
  },
  mention: {
    subject: (actor) => `${actor} mentioned you on Thingtime 📣`,
    line: (actor) => `${actor} mentioned you in a post.`
  },
  groups: {
    subject: (actor) => `${actor} — group activity on Thingtime 👥`,
    line: (actor) => `${actor} did something in a group you're in.`
  },
  // system note — normally overridden by the emit's headline
  'action-run': {
    subject: () => 'An action you ran has finished ⚡',
    line: () => 'An action you ran on Thingtime has finished.'
  }
};

const emailFooter = ({ settingsUrl, unsubscribeUrl }: { settingsUrl: string; unsubscribeUrl?: string }) => ({
  text: [
    `Manage notification emails: ${settingsUrl}`,
    unsubscribeUrl ? `Unsubscribe from all notification emails: ${unsubscribeUrl}` : undefined
  ]
    .filter(Boolean)
    .join('\n'),
  html: `<hr><p style="font-size:12px;color:#9a9aa6"><a href="${htmlEscape(settingsUrl)}">Manage notification emails</a>${
    unsubscribeUrl ? ` · <a href="${htmlEscape(unsubscribeUrl)}">Unsubscribe from all</a>` : ''
  }</p>`
});

export const renderNotificationEmailTemplate = ({
  type,
  actorName,
  headline,
  preview,
  ctaUrl,
  ctaLabel,
  settingsUrl,
  unsubscribeUrl
}: NotificationEmailInput) => {
  const actor = actorName || 'Someone';
  const copy = NOTIFICATION_EMAIL_COPY[type] || {
    subject: (name: string) => `${name} — new activity on Thingtime 🔔`,
    line: (name: string) => `${name} did something that landed in your notifications.`
  };
  const subject = headline || copy.subject(actor);
  const line = headline || copy.line(actor);
  const footer = emailFooter({ settingsUrl, unsubscribeUrl });
  return {
    subject,
    text: [line, preview ? `“${preview}”` : undefined, `${ctaLabel}: ${ctaUrl}`, '', footer.text]
      .filter((entry) => entry !== undefined)
      .join('\n'),
    html: [
      `<p>${htmlEscape(line)}</p>`,
      preview
        ? `<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #ececef;color:#5a5a66">${htmlEscape(preview)}</blockquote>`
        : '',
      `<p><a href="${htmlEscape(ctaUrl)}">${htmlEscape(ctaLabel)}</a></p>`,
      footer.html
    ].join('')
  };
};

export type WeeklySummaryStat = { label: string; count: number };

export const renderWeeklySummaryTemplate = ({
  displayName,
  stats,
  ctaUrl,
  settingsUrl,
  unsubscribeUrl
}: {
  displayName: string | null;
  stats: WeeklySummaryStat[];
  ctaUrl: string;
  settingsUrl: string;
  unsubscribeUrl?: string;
}) => {
  const greeting = displayName ? `Hey ${displayName} 👋` : 'Hey 👋';
  const lines = stats.filter((stat) => stat.count > 0);
  const footer = emailFooter({ settingsUrl, unsubscribeUrl });
  return {
    subject: 'Your week on Thingtime ✨',
    text: [
      greeting,
      'Here’s what happened around your things this week:',
      ...lines.map((stat) => `• ${stat.count} ${stat.label}`),
      '',
      `Open Thingtime: ${ctaUrl}`,
      '',
      footer.text
    ].join('\n'),
    html: [
      `<p>${htmlEscape(greeting)}</p>`,
      '<p>Here’s what happened around your things this week:</p>',
      `<ul>${lines
        .map((stat) => `<li><strong>${stat.count}</strong> ${htmlEscape(stat.label)}</li>`)
        .join('')}</ul>`,
      `<p><a href="${htmlEscape(ctaUrl)}">Open Thingtime</a></p>`,
      footer.html
    ].join('')
  };
};

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
