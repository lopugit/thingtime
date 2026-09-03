import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  buildAdminPrPreview,
  publishAdminPrPreviewComment,
  publishAdminPrPreviewStartingComment,
  removeAdminPrPreviews,
  validatedPreviewPullRequest
} from '~/api/utils/ciControl/adminPreviewDeployments';
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
      const currentPolicy = (await listCiPreviewPolicies(repository)).find((candidate) => candidate.prNumber === prNumber);
      const selectedEnvironments = (['develop', 'production'] as const).filter((environment) =>
        environment === body.environment ? body.enabled : currentPolicy?.[environment] === true
      );
      const startingPublication = body.enabled
        ? await publishAdminPrPreviewStartingComment({ pr, environments: selectedEnvironments }).catch(() => ({
            commented: false,
            created: false,
            previews: []
          }))
        : null;
      const deployment = body.enabled
        ? await buildAdminPrPreview(pr, body.environment, gate.user.id)
        : await removeAdminPrPreviews(prNumber, body.environment);
      const policy = await setCiPreviewPolicy({
        repository,
        prNumber,
        environment: body.environment,
        enabled: body.enabled,
        headSha: String(pr.head?.sha),
        headRef: String(pr.head?.ref),
        actorId: gate.user.id
      });
      const publication = await publishAdminPrPreviewComment({
        pr,
        policy,
        knownDeployments: body.enabled && 'deploymentId' in deployment ? [deployment] : []
      }).catch(() => ({ commented: false, created: false, previews: [] }));
      return json({ ok: true, policy, deployment, startingPublication, publication });
    } catch (error) {
      return json(
        { ok: false, error: error instanceof Error ? error.message : 'Preview policy could not be updated' },
        { status: 409 }
      );
    }
  });
