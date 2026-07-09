import { sendEmail } from '../email/service';
import {
  renderEmailOtpTemplate,
  renderEmailVerificationTemplate,
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
