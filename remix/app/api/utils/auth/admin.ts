import { getCurrentUser } from './getCurrentUser';
import type { PublicUser } from './users';

type AdminResult =
  | { ok: true; user: PublicUser }
  | { ok: false; status: 401 | 403; error: string };

const parseEnvList = (value?: string) =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const adminUserIds = () => parseEnvList(process.env.THINGTIME_ADMIN_USER_IDS);
const adminUsernames = () => parseEnvList(process.env.THINGTIME_ADMIN_USERNAMES);
const adminEmails = () => parseEnvList(process.env.THINGTIME_ADMIN_EMAILS);

export const isAdminUser = (user: PublicUser | null): user is PublicUser => {
  if (!user) return false;

  const id = user.id.toLowerCase();
  const username = user.username.toLowerCase();
  const email = user.email.toLowerCase();

  return (
    adminUserIds().includes(id) ||
    adminUsernames().includes(username) ||
    adminEmails().includes(email)
  );
};

export const requireAdminUser = async (request: Request): Promise<AdminResult> => {
  const user = await getCurrentUser(request);
  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  if (!isAdminUser(user)) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return { ok: true, user };
};
