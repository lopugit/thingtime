// Compatibility admission for old product branches. Gateway metadata supplied
// by the publisher cannot add middleware/database fencing to an older bundle.
// This is a source compatibility check, not a sandbox for hostile product code.
export const gatewaySourcePaths = Object.freeze([
  'remix/app/api/utils/mongodb/mongodb.ts',
  'remix/server/middleware/environment-gateway.ts',
  'remix/app/api/utils/deployment/environmentGateway.ts',
  'remix/app/api/utils/deployment/mongoConnectionPolicy.ts'
]);
const code = (text) => String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
export function gatewaySourceIssue(sources) {
  const [mongo, middleware, authority, policy] = gatewaySourcePaths.map((path) => code(sources[path]));
  if (!/import\s*\{[^}]*requireGatewayDatabaseAccess[^}]*\}\s*from\s*['"]\.\.\/deployment\/environmentGateway['"]/.test(mongo) ||
      !/class\s+GatewayMongoClient\s+extends\s+mod\.MongoClient/.test(mongo) ||
      !/override\s+async\s+connect\(\)\s*\{\s*await\s+requireGatewayDatabaseAccess\(\);\s*await\s+super\.connect\(\)/.test(mongo)) return 'database-fence-missing';
  if (!/import\s*\{[^}]*environmentGatewayIngress[^}]*\}\s*from\s*['"]\.\.\/utils\/environmentGateway['"]/.test(middleware) ||
      !/await\s+environmentGatewayIngress\(event\.req\)/.test(middleware) || !/runAdmittedGatewayWork\(/.test(middleware)) return 'gateway-ingress-missing';
  if (!/export\s+const\s+requireGatewayDatabaseAccess\s*=/.test(authority) || !/await\s+gatewayAuthority\.requireDatabase\(\)/.test(authority)) return 'gateway-authority-missing';
  // Dedicated remains an explicit existing branch opt-in, never a fallback for
  // unsupported source. This admission only establishes gateway integration.
  if (!/export\s+const\s+mongoConnectionPolicy[^=]*=\s*['"](?:proxy|dedicated)['"]/.test(policy)) return 'connection-policy-missing';
  return null;
}
export async function assertPreviewGatewaySource(repository, sha, github) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid gateway source SHA');
  const sources = {};
  for (const path of gatewaySourcePaths) {
    let entry;
    try { entry = await github(`/repos/${repository}/contents/${path}?ref=${sha}`); }
    catch (error) { if (error.status === 404) throw new Error('Preview source predates the required gateway integration'); throw error; }
    if (entry?.type !== 'file' || entry.encoding !== 'base64' || typeof entry.content !== 'string') throw new Error('Gateway source inventory incomplete');
    sources[path] = Buffer.from(entry.content, 'base64').toString('utf8');
  }
  const issue = gatewaySourceIssue(sources);
  if (issue) throw new Error(`Preview source lacks required gateway integration (${issue})`);
}
