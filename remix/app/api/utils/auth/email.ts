import { sendEmail } from '../email/service';
import {
  renderEmailOtpTemplate,
  renderEmailVerificationTemplate,
  renderNewsletterTemplate,
  renderNewUserAdminNotificationTemplate,
  renderPasswordResetTemplate
} from '../email/templates';
import type { EmailSendResult } from '../email/types';

// Admin recipient for the new-user notification below. Not user-configurable —
// this is the hardcoded ops inbox for signup review, per product decision.
const NEW_USER_ADMIN_NOTIFICATION_EMAIL = process.env.NEW_USER_ADMIN_NOTIFICATION_EMAIL || 'admin@thingtime.com';

export const sendNewUserAdminNotificationEmail = async ({
  username,
  email,
  displayName,
  userId
}: {
  username: string;
  email: string;
  displayName: string | null;
  userId: string;
}): Promise<EmailSendResult> => {
  const rendered = renderNewUserAdminNotificationTemplate({ username, email, displayName, userId });
  return sendEmail({
    to: NEW_USER_ADMIN_NOTIFICATION_EMAIL,
    stream: 'transactional',
    templateKey: 'admin.new_user_notification',
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    metadata: {
      purpose: 'new_user_admin_notification',
      userId
    },
    tags: {
      stream: 'transactional',
      template: 'admin.new_user_notification'
    }
  });
};

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
