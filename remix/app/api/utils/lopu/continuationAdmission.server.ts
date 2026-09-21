import { Binary } from 'mongodb';
import { start } from 'workflow/api';
import { getAuthToken } from '../auth/authCookie';
import { type getCurrentUser } from '../auth/getCurrentUser';
import { verifyJwt } from '../auth/jwt';
import { getRequestMongoEndpoint } from '../mongodb/endpoint';
import { getHomeThingsCollection } from '../mongodb/collections';
import { AI_TASK_KIND } from './backgroundTaskCore';
import { runLopuContinuation } from './continuationWorkflow.server';

type WorkflowGrant = { input: Record<string, any>; url: string; sessionId: string };
// Only an authenticated HTTP admission may mint this grant. Workflow arguments
// contain an opaque task id, never prompts, bearer tokens, cookies or providers.
export const admitLopuWorkflow = async (request: Request, row: any, input: any, user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) => {
	if (await getRequestMongoEndpoint(request))
		return { ok: false as const, error: 'Vercel management requires the account database. Keep local management for a custom database session.' };
	const token = await getAuthToken(request);
	const claims = token ? await verifyJwt(token) : null;
	if (!claims || claims.sub !== user.id) return { ok: false as const, error: 'Sign in again before starting server management.' };
	const things = await getHomeThingsCollection();
	const grant: WorkflowGrant = { input, url: request.url, sessionId: claims.jti };
	await things.updateOne(
		{ shareId: row.shareId, ownerId: user.id, thingtime: AI_TASK_KIND },
		{ $set: { workflowInput: new Binary(Buffer.from(JSON.stringify(grant))) } }
	);
	try {
		const run = await start(runLopuContinuation, [row.shareId]);
		// Scheduling has succeeded. An observability write failure must not turn
		// that accepted run into an apparent send failure.
		await things
			.updateOne({ shareId: row.shareId, ownerId: user.id, thingtime: AI_TASK_KIND }, { $set: { workflowRunId: run.runId } })
			.catch(() => {});
		return { ok: true as const };
	} catch {
		return {
			ok: false as const,
			error: 'Server management could not confirm startup. This task has been stopped; review its saved progress before trying again.'
		};
	}
};
