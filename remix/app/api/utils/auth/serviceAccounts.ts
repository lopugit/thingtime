import { randomUUID } from 'node:crypto';

import { createEmailVerification } from './emailVerifications';
import { sendVerificationEmail } from './email';
import { signJwt } from './jwt';
import { createUserAccount } from './registerUser';
import { createSession } from './sessions';
import type { CreateUserAccountResult } from './registerUser';
import type { PublicUser } from './users';

export const DEFAULT_SERVICE_STORAGE_ALLOWANCE_BYTES = 5 * 1024 * 1024 * 1024;
export const SERVICE_EMAIL_VERIFICATION_GRACE_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_SERVICE_TOKEN_TTL_DAYS = 30;
const MAX_SERVICE_TOKEN_TTL_DAYS = 90;

export type ProvisionServiceAccountInput = {
  username?: string;
  serviceName?: string;
  email: string;
  displayName?: string | null;
  password?: string;
  meta?: Record<string, any>;
  origin?: string;
  provisionedByUserId?: string;
};

export type ProvisionServiceAccountResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      user: PublicUser;
      accessToken: string;
      tokenType: 'Bearer';
      expiresAt: string;
      verificationRequiredBy: string;
      verificationLink: string;
      storageAllowanceBytes: number;
      sessionJti: string;
    };

const slugifyUsername = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const generatedServicePassword = () => `${randomUUID()}-${randomUUID()}`;

const serviceTokenTtlDays = () => {
  const raw = process.env.THINGTIME_SERVICE_TOKEN_TTL_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SERVICE_TOKEN_TTL_DAYS;

  const configured = Number(raw);
  if (!Number.isFinite(configured)) {
    console.warn(
      `[serviceAccounts] THINGTIME_SERVICE_TOKEN_TTL_DAYS="${raw}" is not a number; ` +
        `using default ${DEFAULT_SERVICE_TOKEN_TTL_DAYS}d.`
    );
    return DEFAULT_SERVICE_TOKEN_TTL_DAYS;
  }

  const clamped = Math.min(Math.max(1, Math.floor(configured)), MAX_SERVICE_TOKEN_TTL_DAYS);
  if (clamped !== configured) {
    console.warn(
      `[serviceAccounts] THINGTIME_SERVICE_TOKEN_TTL_DAYS=${configured} out of range; ` +
        `clamped to ${clamped}d (allowed 1–${MAX_SERVICE_TOKEN_TTL_DAYS}).`
    );
  }
  return clamped;
};

export const provisionServiceAccount = async (
  input: ProvisionServiceAccountInput
): Promise<ProvisionServiceAccountResult> => {
  const username = slugifyUsername(input.username || input.serviceName || '');
  if (!username) return { ok: false, status: 400, error: 'username or serviceName is required' };

  const serviceName = (input.serviceName || input.displayName || username).trim();
  const now = new Date();
  const verificationRequiredBy = new Date(now.getTime() + SERVICE_EMAIL_VERIFICATION_GRACE_MS);
  const tokenTtlDays = serviceTokenTtlDays();
  const tokenExpiresAt = new Date(now.getTime() + tokenTtlDays * 24 * 60 * 60 * 1000);
  const meta = {
    ...(input.meta ?? {}),
    accountKind: 'service',
    serviceName,
    provisionedVia: 'api',
    provisionedByUserId: input.provisionedByUserId || null,
    tokenExpiry: `${tokenTtlDays}d`,
    emailVerificationGraceDays: 7
  };

  const created: CreateUserAccountResult = await createUserAccount({
    username,
    password: input.password || generatedServicePassword(),
    email: input.email,
    displayName: input.displayName ?? serviceName,
    emailVerified: false,
    accountKind: 'service',
    emailVerificationRequiredBy: verificationRequiredBy,
    storageAllowanceBytes: DEFAULT_SERVICE_STORAGE_ALLOWANCE_BYTES,
    storageUsedBytes: 0,
    meta
  });

  if (created.ok === false) return created;

  const session = await createSession(String(created.user._id), {
    expiresAt: tokenExpiresAt,
    purpose: 'service',
    meta: {
      serviceName,
      tokenExpiry: `${tokenTtlDays}d`,
      provisionedByUserId: input.provisionedByUserId || null
    }
  });
  const accessToken = await signJwt({
    sub: String(created.user._id),
    jti: session.jti,
    expiresIn: `${tokenTtlDays}d`
  });
  const origin = input.origin || process.env.APP_URL || 'http://localhost:9999';
  const verification = await createEmailVerification({
    userId: String(created.user._id),
    email: created.user.email,
    expiresInMs: SERVICE_EMAIL_VERIFICATION_GRACE_MS
  });
  const verificationLink = `${origin}/api/v1/auth/verify-email?token=${verification.token}`;
  await sendVerificationEmail({ to: created.user.email, link: verificationLink });

  return {
    ok: true,
    user: created.publicUser,
    accessToken,
    tokenType: 'Bearer',
    expiresAt: tokenExpiresAt.toISOString(),
    verificationRequiredBy: verificationRequiredBy.toISOString(),
    verificationLink,
    storageAllowanceBytes: DEFAULT_SERVICE_STORAGE_ALLOWANCE_BYTES,
    sessionJti: session.jti
  };
};
