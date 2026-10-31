/** Configuration fencing supplements the container network boundary. It never
 * establishes isolation on its own, and it never permits a fallback origin. */
export function agentTestEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.THINGTIME_AGENT_TEST_MODE !== '1') return null;
  const sessionId = environment.THINGTIME_AGENT_TEST_SESSION || '';
  const refuse = (): never => { throw new Error('The isolated test environment is incomplete.'); };
  if (!/^[a-f0-9-]{36}$/.test(sessionId) || !environment.JWT_SECRET || Buffer.byteLength(environment.JWT_SECRET) < 32 ||
      environment.JWT_PRIVATE_KEY || environment.THINGTIME_API_FALLBACK_ORIGIN) return refuse();
  let database: URL;
  try { database = new URL(environment.MONGODB_CONNECTION_STRING || ''); } catch { return refuse(); }
  if (database.protocol !== 'mongodb:' || database.hostname !== '127.0.0.1' || database.port !== '27017' || database.pathname !== '/thingtime' ||
      database.username || database.password || database.hash || database.searchParams.get('replicaSet') !== `tt-agent-${sessionId}` ||
      [...database.searchParams.keys()].some(key => key !== 'replicaSet')) return refuse();
  return { mode: 'isolated-agent-test' as const, sessionId, version: '1.0.0' };
}

export function agentTestRefusal() {
  try { agentTestEnvironment(); return null; }
  catch {
    return Response.json({ ok: false, code: 'AGENT_TEST_CONFIGURATION_REQUIRED', error: 'Configure this isolated test environment before using its API.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store' }
    });
  }
}
