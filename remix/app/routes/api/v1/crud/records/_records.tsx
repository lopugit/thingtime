import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createRecord, getRecord, listRecords } from '~/api/utils/crud/records';

// GET /api/v1/crud/records?id=<recordId> — read one permitted record, or
// GET /api/v1/crud/records?typeId=<typeId>&cursor=&limit= — list permitted
// records for a type. Auth optional: anonymous callers only match records
// whose ACL includes the public subject.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;

  const id = params.get('id');
  if (id) {
    const result = await getRecord(user, id);
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, record: result.record });
  }

  const typeId = params.get('typeId');
  if (typeId) {
    const result = await listRecords(user, {
      typeId,
      cursor: params.get('cursor'),
      limit: params.get('limit')
    });
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, { status: result.status });
    }
    return json({ ok: true, records: result.records, nextCursor: result.nextCursor });
  }

  return json({ ok: false, error: 'Pass id=<recordId> or typeId=<typeId>' }, { status: 400 });
};

// Record values are size-capped per field, but a type allows up to 40 fields.
const MAX_BODY_BYTES = 256 * 1024;

// POST /api/v1/crud/records — { typeId, values, acl? } — create a record.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await createRecord(user, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, record: result.record });
};
