import { createHash } from 'node:crypto';

// Tiny shared kernel for the connections family — the error union and the
// deterministic-id hash live in exactly one place so the persisted shareId
// grammars (ext-account/ext-link/ext-post/ext-filter/ext-verdict) can never
// drift between modules.

export type Fail = { ok: false; status: number; error: string };
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export const sha48 = (parts: string[]): string => {
  const hash = createHash('sha256');
  parts.forEach((part, index) => {
    if (index) hash.update('\0');
    hash.update(part);
  });
  return hash.digest('hex').slice(0, 48);
};
