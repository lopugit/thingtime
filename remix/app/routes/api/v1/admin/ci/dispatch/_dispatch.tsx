import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { dispatchCiWorkflow, type CiWorkflowKey } from '~/api/utils/ciControl/githubClient';

const WORKFLOWS = new Set<CiWorkflowKey>([
  'feature-stack',
  'resolve-conflicts',
  'rebase-stack',
  'promote-features',
  'promote-develop',
  'sync-main',
  'web-ci',
  'electron-release'
]);

export const action = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		const body = await readJsonBody(request, 512 * 1024);
    const workflow = typeof body?.workflow === 'string' ? (body.workflow as CiWorkflowKey) : null;
    if (!workflow || !WORKFLOWS.has(workflow)) {
      return json({ ok: false, error: 'Choose a supported workflow' }, { status: 400 });
    }
    try {
      const result = await dispatchCiWorkflow({
        workflow,
        ref: typeof body?.ref === 'string' ? body.ref : undefined,
        inputs: body?.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs) ? body.inputs : {},
        actorId: gate.user.id
      });
      return json(result, { status: 202 });
    } catch {
      return json(
        { ok: false, error: 'The workflow could not be dispatched. Check the selected compute provider and integration setup, then try again.' },
        { status: 502 }
      );
    }
  });
