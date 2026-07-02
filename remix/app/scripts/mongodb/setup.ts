// Seeds users by calling the REAL register path (registerUser), never by
// writing to Mongo directly — so seeded users == real signups
// (see FUNDAMENTALS.md §2). Idempotent: re-running skips existing users.

import { registerUser } from '~/api/utils/auth/registerUser';

import { getUsers } from './data/users';

export const saveUsers = async () => {
  const users = await getUsers();

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    const result = await registerUser(user);
    if (result.ok === true) {
      created++;
    } else if (result.status === 409) {
      // already exists (username/email taken) — idempotent re-seed
      skipped++;
    } else {
      throw new Error(`Seed failed for ${user.username}: ${result.error}`);
    }
  }

  return { created, skipped, total: users.length };
};

export const setup = async () => {
  try {
    return { ok: true as const, ...(await saveUsers()) };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || String(err) };
  }
};

export default setup;
