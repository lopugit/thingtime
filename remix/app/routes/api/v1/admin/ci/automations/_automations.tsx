import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  isCiExecutionProvider,
  isCiWorkflowKey
} from '~/api/utils/ciControl/automationPolicy';
import { validateCiExecutionProvider } from '~/api/utils/ciControl/providerReadiness';
import { setCiAutomationPolicy } from '~/api/utils/ciControl/store';

export const action = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
    const body = await readJsonBody(request, 16 * 1024);
    if (!isCiWorkflowKey(body?.workflow)) {
      return json({ ok: false, error: 'Choose a supported workflow' }, { status: 400 });
    }
    if (!isCiExecutionProvider(body?.executionProvider)) {
      return json({ ok: false, error: 'Choose GitHub Actions or Vercel Sandbox' }, { status: 400 });
    }
    const providerReadiness = validateCiExecutionProvider(body.executionProvider);
    if (!providerReadiness.ok) {
      return json(
        { ok: false, error: providerReadiness.error, missing: providerReadiness.missing },
        { status: 409 }
      );
    }
    try {
      const policy = await setCiAutomationPolicy({
        repository: process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime',
        workflow: body.workflow,
        executionProvider: body.executionProvider,
        enabled: body.enabled !== false,
        actorId: gate.user.id
      });
      return json({ ok: true, policy });
    } catch (error) {
      return json(
        { ok: false, error: error instanceof Error ? error.message : 'Automation policy could not be updated' },
        { status: 409 }
      );
    }
  });
