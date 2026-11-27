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
  // Native-home branches also fence the selected provider before opening a
  // Mongo connection. Recognize those exact assertions without permitting
  // arbitrary work or a connection before gateway authorization.
  const nativeProviderImport = /import\s*\{[^}]*\bassertMongoProviderAllowed\b[^}]*\}\s*from\s*['"]\.\.\/documentStore\/nativeHomeSelection['"]/.test(mongo);
  const providerGuard = nativeProviderImport ? '(?:assertMongoProviderAllowed\\(\\);\\s*)?' : '';
  const fencedConnect = new RegExp(`override\\s+async\\s+connect\\(\\)\\s*\\{\\s*${providerGuard}await\\s+requireGatewayDatabaseAccess\\(\\);\\s*${providerGuard}await\\s+super\\.connect\\(\\)`);
  if (!/import\s*\{[^}]*requireGatewayDatabaseAccess[^}]*\}\s*from\s*['"]\.\.\/deployment\/environmentGateway['"]/.test(mongo) ||
      !/class\s+GatewayMongoClient\s+extends\s+mod\.MongoClient/.test(mongo) ||
      !fencedConnect.test(mongo)) return 'database-fence-missing';
  const legacyIngress = /runAdmittedGatewayWork\(/.test(middleware);
  // The leased ingress keeps admission through response consumption and releases
  // it on completion, cancellation and errors instead of counting static traffic.
  const leasedIngress = /import\s*\{[^}]*admitGatewayWork[^}]*\}\s*from\s*['"]\.\.\/\.\.\/app\/api\/utils\/deployment\/environmentGateway['"]/.test(middleware) &&
    /lease\s*=\s*await\s+admitGatewayWork\(\)/.test(middleware) &&
    /const\s+end\s*=\s*\(\)\s*=>\s*lease\?\.end\(\)/.test(middleware) &&
    /await\s+lease\.run\(/.test(middleware) &&
    /await\s+lease!\.run\(\(\)\s*=>\s*reader\.read\(\)\)/.test(middleware) &&
    /await\s+lease!\.run\(\(\)\s*=>\s*reader\.cancel\(reason\)\)/.test(middleware) &&
    /chunk\.done\)\s*\{\s*controller\.close\(\);\s*end\(\)/.test(middleware) &&
    /finally\s*\{\s*end\(\)/.test(middleware) && /catch\s*\(error\)\s*\{\s*end\(\)/.test(middleware);
  if (!/import\s*\{[^}]*environmentGatewayIngress[^}]*\}\s*from\s*['"]\.\.\/utils\/environmentGateway['"]/.test(middleware) ||
      !/await\s+environmentGatewayIngress\(event\.req\)/.test(middleware) || !(legacyIngress || leasedIngress)) return 'gateway-ingress-missing';
  const legacyAuthority = /await\s+gatewayAuthority\.requireDatabase\(\)/.test(authority);
  const leasedAuthority = /const\s+gatewayWork\s*=\s*createGatewayWorkLifecycle\(\(\)\s*=>\s*gatewayAuthority\.requireDatabase\(\)\)/.test(authority) &&
    /await\s+requireDatabase\(\)/.test(authority) && /const\s+lease\s*=\s*await\s+admit\(\)/.test(authority) &&
    /try\s*\{\s*return\s+await\s+lease\.run\(work\);\s*\}\s*finally\s*\{\s*lease\.end\(\)/.test(authority) &&
    /await\s+gatewayWork\.withWork\(async\s*\(\)\s*=>\s*\{\s*\}\)/.test(authority);
  if (!/export\s+const\s+requireGatewayDatabaseAccess\s*=/.test(authority) || !(legacyAuthority || leasedAuthority)) return 'gateway-authority-missing';
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
