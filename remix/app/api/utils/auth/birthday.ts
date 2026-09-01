// The account birthday: a plain YYYY-MM-DD calendar date — no time, no zone,
// exactly as the user states it. PRIVATE state: it lives in the user thing's
// secure blob (meta.birthday), is returned only on owner-facing projections
// (PublicUser), and reaches embedding apps solely through the explicit
// top-level 'birthday' scope. Never part of the public profile.
//
// Pure and dependency-free so `node --test` loads it without a loader.

const BIRTHDAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_BIRTHDAY_YEAR = 1900;

// Mirrors sanitizeProfileImageUrl's contract:
//   undefined → invalid (reject the write) · null → clear · string → store.
export const sanitizeBirthday = (value: unknown, today = new Date()): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = BIRTHDAY_RE.exec(trimmed);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // A real calendar date — Date.UTC silently rolls 2001-02-31 into March, so
  // require the round-trip to land on the same y/m/d.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  if (year < MIN_BIRTHDAY_YEAR) return undefined;
  if (trimmed > today.toISOString().slice(0, 10)) return undefined; // not in the future
  return trimmed;
};
