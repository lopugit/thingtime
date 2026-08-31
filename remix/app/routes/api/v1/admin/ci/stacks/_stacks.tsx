import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { dispatchCiWorkflow } from '~/api/utils/ciControl/githubClient';
import {
	archiveFeatureStack,
	getFeatureStack,
	listFeatureStacks,
	markFeatureStackRun,
	saveFeatureStack
} from '~/api/utils/ciControl/featureStackStore';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

export const loader = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
		return json({ ok: true, stacks: await listFeatureStacks() }, { headers: privateHeaders });
	});

export const action = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
		const body = await readJsonBody(request, 512 * 1024);
		try {
			if (body?.action === 'save') {
				const stack = await saveFeatureStack(body, gate.user.id);
				return json({ ok: true, stack, stacks: await listFeatureStacks() }, { headers: privateHeaders });
			}
			if (body?.action === 'delete') {
				await archiveFeatureStack(body.id);
				return json({ ok: true, stacks: await listFeatureStacks() }, { headers: privateHeaders });
			}
			if (body?.action === 'run') {
				const stack = await getFeatureStack(body.id);
				const result = await dispatchCiWorkflow({
					workflow: 'feature-stack',
					ref: 'develop',
					actorId: gate.user.id,
					externalId: `feature-stack:${stack.id}:${Date.now()}`,
					inputs: {
						name: stack.name,
						stack_id: stack.id,
						source_pr_numbers: stack.sourcePrNumbers,
						targets: stack.targets,
						auto_decide_branches: stack.autoDecideBranches
					}
				});
				await markFeatureStackRun(stack.id, result.dispatchId);
				return json({ ok: true, dispatch: result, stacks: await listFeatureStacks() }, { status: 202, headers: privateHeaders });
			}
			return json({ ok: false, error: 'Choose save, run, or delete.' }, { status: 400, headers: privateHeaders });
		} catch (error) {
			return json(
				{ ok: false, error: error instanceof Error ? error.message : 'Feature Stack change failed.' },
				{ status: 409, headers: privateHeaders }
			);
		}
	});
