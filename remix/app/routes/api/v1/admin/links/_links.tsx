import { json, readJsonBody } from '~/api/http';

import {
  createAccountLink,
  isAccountLinkKind,
  listAccountLinksForTarget,
  listAccountLinksForUser,
  removeAccountLink
} from '~/api/utils/accounts/accountLinks';
import { findAppByClientId } from '~/api/utils/apps/apps';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { findUserById, toPublicUser } from '~/api/utils/auth/users';

// Decorate raw links with display names so the admin UI never needs N
// follow-up lookups.
const decorate = async (links: Awaited<ReturnType<typeof listAccountLinksForUser>>) => {
  const personIds = [...new Set(links.flatMap((link) => [link.userId, ...(link.linkKind === 'account' ? [link.targetId] : [])]))];
  const people = new Map(
    (await Promise.all(personIds.map((id) => findUserById(id)))).filter(Boolean).map((doc: any) => {
      const pub = toPublicUser(doc);
      return [pub.id, pub.username] as const;
    })
  );
  return links.map((link) => ({
    ...link,
    username: people.get(link.userId) ?? null,
    targetUsername: link.linkKind === 'account' ? people.get(link.targetId) ?? null : null
  }));
};

// GET /api/v1/admin/links?userId=|targetId=&linkKind= — the ownership links a
// user holds, or everyone linked to a target (account or app). Admin only.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const url = new URL(request.url);
  const linkKindParam = url.searchParams.get('linkKind');
  const linkKind = isAccountLinkKind(linkKindParam) ? linkKindParam : undefined;
  const userId = (url.searchParams.get('userId') ?? '').trim();
  const targetId = (url.searchParams.get('targetId') ?? '').trim();

  if (!userId && !targetId) return json({ ok: false, error: 'userId or targetId is required' }, { status: 400 });

  const links = userId
    ? await listAccountLinksForUser(userId, linkKind)
    : await listAccountLinksForTarget(targetId, linkKind);
  return json({ ok: true, links: await decorate(links) });
};

// POST /api/v1/admin/links — { action: 'add' | 'remove', linkKind: 'account' |
// 'app', userId, targetId } — assign or unassign ownership. Many-to-many by
// design: any number of users per target, any number of targets per user.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  if (body?.action !== 'add' && body?.action !== 'remove') {
    return json({ ok: false, error: "action must be 'add' or 'remove'" }, { status: 400 });
  }
  if (!isAccountLinkKind(body?.linkKind)) {
    return json({ ok: false, error: "linkKind must be 'account' or 'app'" }, { status: 400 });
  }
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const targetId = typeof body?.targetId === 'string' ? body.targetId.trim() : '';
  if (!userId || !targetId) return json({ ok: false, error: 'userId and targetId are required' }, { status: 400 });

  if (!(await findUserById(userId))) return json({ ok: false, error: 'User not found' }, { status: 404 });
  if (body.linkKind === 'account') {
    if (!(await findUserById(targetId))) return json({ ok: false, error: 'Target account not found' }, { status: 404 });
  } else if (!(await findAppByClientId(targetId))) {
    return json({ ok: false, error: 'Target app not found' }, { status: 404 });
  }

  if (body.action === 'remove') {
    const removed = await removeAccountLink(body.linkKind, userId, targetId);
    return json({ ok: true, removed: removed.removed });
  }

  const result = await createAccountLink({ linkKind: body.linkKind, userId, targetId, createdBy: gate.user.id });
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true, link: result.link });
};
