import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  dispatchAdminPrPreviewController,
  enabledAdminPreviewEnvironments,
  validatedPreviewPullRequest
} from '~/api/utils/ciControl/adminPreviewController';
import { repositoryName } from '~/api/utils/ciControl/githubClient';
import { isCiPreviewEnvironment } from '~/api/utils/ciControl/previewPolicyCore';
import { listCiPreviewPolicies, setCiPreviewPolicy } from '~/api/utils/ciControl/store';

export const action = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
    const body = await readJsonBody(request, 16 * 1024);
    const prNumber = Number(body?.prNumber);
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) {
      return json({ ok: false, error: 'Choose a valid pull request' }, { status: 400 });
    }
    if (!isCiPreviewEnvironment(body?.environment) || typeof body?.enabled !== 'boolean') {
      return json({ ok: false, error: 'Choose develop or production and an enabled state' }, { status: 400 });
    }
    if (body.environment === 'production' && body.enabled && body.acknowledgeProductionData !== true) {
      return json({ ok: false, error: 'Confirm that this trusted PR may run with the production environment' }, { status: 409 });
    }
    try {
      const pr = await validatedPreviewPullRequest(prNumber);
      const repository = repositoryName();
      const previousPolicy = (await listCiPreviewPolicies(repository)).find((candidate) => candidate.prNumber === prNumber);
      const updatePolicy = (enabled = body.enabled) =>
        setCiPreviewPolicy({
          repository,
          prNumber,
          environment: body.environment,
          enabled,
          headSha: String(pr.head?.sha),
          headRef: String(pr.head?.ref),
          actorId: gate.user.id
        });
      const policy = await updatePolicy();
      try {
        const controller = await dispatchAdminPrPreviewController({
          pr,
          policy,
          action: 'configure',
          actorId: gate.user.id
        });
        return json({
          ok: true,
          policy,
          controller,
          expectedEnvironments: enabledAdminPreviewEnvironments(policy)
        });
      } catch (error) {
        await updatePolicy(previousPolicy?.[body.environment] === true);
        throw error;
      }
    } catch (error) {
      return json(
        { ok: false, error: error instanceof Error ? error.message : 'Preview policy could not be updated' },
        { status: 409 }
      );
    }
  });
