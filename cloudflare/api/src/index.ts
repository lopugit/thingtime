// Cloudflare API Worker for thingtime.com (phase 2 of PLAN/cloudflare-workers-migration.md).
//
// Serves the endpoints whose API docs carry a `cloudflare` entry, using the
// same handler modules and the same request pipeline (`executeApiRoute`) as
// Nitro on Vercel. Nothing endpoint-specific lives here.
//
// MongoDB connections: Workers cannot reuse a socket across requests, and
// opening one per request would grow with traffic until Atlas's connection
// limit. So every request runs inside one of a fixed pool of Durable Object
// shards (POOL_SHARDS, placed in Oceania near the Sydney cluster). Each shard
// keeps its own MongoDB client pool between requests, which caps total
// connections at shards × pool size whatever the traffic, and closes it after
// IDLE_CLOSE_MS without requests so an idle shard stops billing.

import { DurableObject } from 'cloudflare:workers';

import { closeMongoRuntimeState, createMongoRuntimeState, withMongoRuntimeState } from '../../../remix/app/api/utils/mongodb/runtimeState';
import { cloudflareRoutes } from './routes.generated';
import { cloudflareManifest, IDLE_CLOSE_MS, MANIFEST_PATH, MAX_SHARDS, notOnThisRuntime, serveApiRequest, shardIndex } from './serve';

export interface Env {
	MONGO_POOL: DurableObjectNamespace<MongoPoolShard>;
	POOL_SHARDS?: string;
	API_WORKER_VERSION?: string;
	MONGODB_CONNECTION_STRING?: string;
	MONGO_PASS?: string;
}

export class MongoPoolShard extends DurableObject<Env> {
	private mongo = createMongoRuntimeState();
	private lastRequestAt = 0;

	async fetch(request: Request): Promise<Response> {
		this.lastRequestAt = Date.now();
		await this.ctx.storage.setAlarm(this.lastRequestAt + IDLE_CLOSE_MS);
		return withMongoRuntimeState(this.mongo, () => serveApiRequest(request));
	}

	async alarm(): Promise<void> {
		const idleFor = Date.now() - this.lastRequestAt;
		if (idleFor >= IDLE_CLOSE_MS) await closeMongoRuntimeState(this.mongo);
		else await this.ctx.storage.setAlarm(this.lastRequestAt + IDLE_CLOSE_MS);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === MANIFEST_PATH) {
			return new Response(JSON.stringify(cloudflareManifest(env.API_WORKER_VERSION)), {
				headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
			});
		}
		const path = url.pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
		if (!cloudflareRoutes[path]) return notOnThisRuntime();
		const shards = Math.min(MAX_SHARDS, Math.max(1, Number(env.POOL_SHARDS) || 1));
		const stub = env.MONGO_POOL.get(env.MONGO_POOL.idFromName(`shard-${shardIndex(shards)}`), { locationHint: 'oc' });
		return stub.fetch(request);
	}
};
