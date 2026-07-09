import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateRecordPermissions } from '~/api/utils/crud/records';

const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/crud/records/permissions — { id, readKeys?, writeKeys?,
// adminKeys?, searchKeys? } — replace a record's ACL grants (admin or owner
// only). Subjects are 'public', 'user:<id>' or 'service:<id>'; public
// write/admin grants are rejected.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await updateRecordPermissions(user, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, permissions: result.permissions, acl: result.acl });
};
