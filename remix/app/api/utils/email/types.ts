import type { EmailProvider, EmailStream } from './config';

export type EmailStatus = 'queued' | 'sent' | 'logged' | 'skipped' | 'failed';

export type EmailSendInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  stream?: EmailStream;
  templateKey?: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, any>;
  tags?: Record<string, string>;
  // when true the real body is delivered but the outbox row stores a redacted
  // placeholder instead of html/text — for mail carrying single-use secrets
  // (OTP codes, password-reset links) so a DB read can't replay them
  sensitive?: boolean;
};

export type EmailDeliveryInput = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: Record<string, string>;
};

export type EmailDeliveryResult = {
  delivered: boolean;
  provider: EmailProvider;
  providerMessageId?: string;
};

export type EmailSendResult = {
  delivered: boolean;
  via: EmailProvider;
  status: EmailStatus;
  emailMessageId: string;
  providerMessageId?: string;
  error?: string;
};
