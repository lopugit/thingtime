import { sendEmail } from '../email/service';
import { getAdminNotificationsEmail } from '../email/config';
import {
  renderAdminMediaUploadRequestTemplate,
  renderEmailOtpTemplate,
  renderEmailVerificationTemplate,
  renderNewUserAdminNotificationTemplate,
  renderNewsletterTemplate,
  renderPasswordResetTemplate
} from '../email/templates';
import type { EmailSendResult } from '../email/types';

export const sendVerificationEmail = async ({
  to,
  link
}: {
  to: string;
  link: string;
}): Promise<EmailSendResult> => {
  const rendered = renderEmailVerificationTemplate({ link });
  return sendEmail({
    to,
    stream: 'transactional',
    templateKey: 'auth.verify_email',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    metadata: {
      purpose: 'email_verification'
    },
    tags: {
      stream: 'transactional',
      template: 'auth.verify_email'
    }
  });
};

// Beta media-upload approvals: every new registration alerts the admin inbox
// (THINGTIME_ADMIN_EMAIL, default admin@thingtime.com) so an admin can grant
// meta.mediaUpload from /admin. Transactional stream — admin alerts are
// operational, never preference-gated like the notification stream.
export const sendAdminMediaUploadRequestEmail = async ({
  username,
  email,
  userId,
  origin
}: {
  username: string;
  email: string;
  userId: string;
  origin?: string;
}): Promise<EmailSendResult> => {
  const base = origin || process.env.APP_URL || 'http://localhost:9999';
  const rendered = renderAdminMediaUploadRequestTemplate({ username, email, userId, adminUrl: `${base}/admin` });
  return sendEmail({
    to: getAdminNotificationsEmail(),
    stream: 'transactional',
    templateKey: 'admin.media_upload_request',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    metadata: {
      purpose: 'admin_media_upload_request',
      userId
    },
    tags: {
      stream: 'transactional',
      template: 'admin.media_upload_request'
    }
  });
};

export const sendPasswordResetEmail = async ({
  to,
  link,
  expiresMinutes
}: {
  to: string;
  link: string;
  expiresMinutes?: number;
}): Promise<EmailSendResult> => {
  const rendered = renderPasswordResetTemplate({ link, expiresMinutes });
  return sendEmail({
    to,
    stream: 'transactional',
    templateKey: 'auth.password_reset',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // the body carries a single-use reset link — keep it out of the outbox
    sensitive: true,
    metadata: {
      purpose: 'password_reset'
    },
    tags: {
      stream: 'transactional',
      template: 'auth.password_reset'
    }
  });
};

export const sendEmailOtp = async ({
  to,
  code,
  expiresMinutes
}: {
  to: string;
  code: string;
  expiresMinutes?: number;
}): Promise<EmailSendResult> => {
  const rendered = renderEmailOtpTemplate({ code, expiresMinutes });
  return sendEmail({
    to,
    stream: 'transactional',
    templateKey: 'auth.email_otp',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // the body carries the plaintext OTP — keep it out of the outbox
    sensitive: true,
    metadata: {
      purpose: 'email_otp',
      expiresMinutes: expiresMinutes ?? 10
    },
    tags: {
      stream: 'transactional',
      template: 'auth.email_otp'
    }
  });
};

export const sendNewsletterEmail = async ({
  to,
  title,
  bodyText,
  bodyHtml,
  unsubscribeUrl,
  metadata
}: {
  to: string | string[];
  title: string;
  bodyText: string;
  bodyHtml: string;
  unsubscribeUrl?: string;
  metadata?: Record<string, any>;
}): Promise<EmailSendResult> => {
  const rendered = renderNewsletterTemplate({ title, bodyText, bodyHtml, unsubscribeUrl });
  return sendEmail({
    to,
    stream: 'newsletter',
    templateKey: 'newsletter.generic',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    metadata: {
      ...(metadata || {}),
      purpose: 'newsletter'
    },
    tags: {
      stream: 'newsletter',
      template: 'newsletter.generic'
    }
  });
};

// Where the internal "new user" notification lands. Overridable per deployment
// so a preview/staging stack can point at a test inbox instead of the real one.
export const adminNotificationEmail = () =>
  process.env.THINGTIME_ADMIN_NOTIFICATION_EMAIL?.trim() || 'admin@thingtime.com';

// Ops mail: a newly registered account finished email verification and now
// needs an admin to grant public file/media uploads (they are withheld at
// signup — see auth/registerUser.ts). Recipient is the admin inbox, never the
// user, so the body carries the account details verbatim.
export const sendNewUserAdminNotification = async ({
  username,
  email,
  displayName,
  userId,
  createdAt,
  origin
}: {
  username: string;
  email: string;
  displayName?: string | null;
  userId: string;
  createdAt?: string | null;
  origin?: string;
}): Promise<EmailSendResult> => {
  const base = origin || process.env.APP_URL || 'http://localhost:9999';
  const rendered = renderNewUserAdminNotificationTemplate({
    username,
    email,
    displayName,
    userId,
    createdAt,
    adminUrl: `${base}/admin`
  });
  return sendEmail({
    to: adminNotificationEmail(),
    stream: 'transactional',
    templateKey: 'admin.new_user',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    metadata: {
      purpose: 'admin_new_user',
      userId,
      username
    },
    tags: {
      stream: 'transactional',
      template: 'admin.new_user'
    }
  });
};
