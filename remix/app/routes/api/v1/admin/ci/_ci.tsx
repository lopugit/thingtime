import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { ciProviderReadiness } from '~/api/utils/ciControl/providerReadiness';
import { ciAdminPreviewReadiness } from '~/api/utils/ciControl/adminPreviewController';
import { ciDashboardCapacityFailure } from '~/api/utils/ciControl/dashboardFailure';
import { listCiDashboard } from '~/api/utils/ciControl/store';

export const loader = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get('limit') ?? 100);
    let dashboard: Awaited<ReturnType<typeof listCiDashboard>>;
    try {
      dashboard = await listCiDashboard({ limit: requestedLimit });
    } catch (error) {
      const failure = ciDashboardCapacityFailure(error);
      if (!failure) throw error;
      console.error('[ci-control-dashboard]', failure.log);
      return json(failure.body, {
        status: failure.status,
        headers: { 'Retry-After': String(failure.retryAfterSeconds) }
      });
    }
    const readiness = ciProviderReadiness();
    const previewReadiness = ciAdminPreviewReadiness();
    return json({
      ok: true,
      dashboard,
      integration: {
        repository: process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime',
        controlPlaneRef: 'github-actions',
        githubAppConfigured: readiness.githubAppConfigured,
        githubWebhookConfigured: Boolean(process.env.THINGTIME_GITHUB_WEBHOOK_SECRET),
        vercelWebhookConfigured: Boolean(process.env.THINGTIME_VERCEL_WEBHOOK_SECRET),
        vercelRunnerConfigured: readiness.vercelRuntimeConfigured,
        providerRouterConfigured: readiness.providerRouterConfigured,
        vercelRunnerReady: readiness.vercelRunnerReady,
        vercelRunnerMissing: readiness.missing,
        previewBuilderConfigured: previewReadiness.configured,
        previewBuilderMissing: previewReadiness.missing
      }
    });
  });
