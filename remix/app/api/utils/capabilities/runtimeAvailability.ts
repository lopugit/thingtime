/** Public availability is a projection of a server-owned composition, never a
 * request selector. No profile identifiers, paths, keys or account data belong
 * in this snapshot. Missing supported operations always means unavailable. */
export type NativeCapabilitySnapshot = Readonly<{
 provider: 'sqlite'; ready: boolean;
 supportedOperations: readonly Readonly<{ method: string; path: string }>[];
}>;
export type RegisteredCapabilityOperation = { feature: string; methods: readonly string[]; path: string };
/** Hosted manifests omit availability metadata. Native manifests populate it;
 * one public operation shape keeps readers safe across either runtime without
 * converting a readonly declaration into a mutable method list. */
export type CapabilityOperation = RegisteredCapabilityOperation & {
 availableMethods?: readonly string[];
 available?: boolean;
};
export const projectRuntimeCapabilities = <T>(features: Record<string, T>, operations: readonly RegisteredCapabilityOperation[], runtime: NativeCapabilitySnapshot) => {
 const supported = new Set(runtime.ready === true ? runtime.supportedOperations.map(op => op.method + ' /api/' + op.path) : []);
 const available = (method: string, path: string): boolean => {
  if (path === '/.well-known/thingtime-capabilities.json' || path === '/api/v1/capabilities') return method === 'GET' || method === 'HEAD';
  // JSON docs execute before the native account dispatcher and do not require
  // a ready profile. Their availability never grants the described operation.
  if (path.startsWith('/api/') && path.endsWith('-docs')) return ['GET', 'HEAD', 'POST'].includes(method);
  return supported.has(method + ' ' + path);
 };
 const projected = operations.map(operation => {
  const availableMethods = operation.methods.filter(method => available(method, operation.path));
  return { ...operation, availableMethods, available: operation.methods.length > 0 && availableMethods.length === operation.methods.length };
 });
 const admitted = new Set(Object.keys(features).filter(feature => {
  const declared = projected.filter(operation => operation.feature === feature);
  return declared.length > 0 && declared.every(operation => operation.available);
 }));
 return {
  features: Object.fromEntries(Object.entries(features).filter(([feature]) => admitted.has(feature))),
  registeredFeatures: features,
  operations: projected,
  runtime: { provider: 'sqlite' as const, ready: runtime.ready === true }
 };
};
