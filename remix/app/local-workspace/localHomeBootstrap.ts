/** Explicit local-content selection, never a server identity or authentication grant. */
export type DeviceHomeProof = {
 featureVersion: string;
 documentId: string;
 origin: string;
 profile: 'fresh-owned' | 'device-only';
 canInitialize: true;
};
export const isDeviceHomeProof = (value: unknown, origin: string): value is DeviceHomeProof => {
 if (!value || typeof value !== 'object') return false;
 const proof = value as Partial<DeviceHomeProof>;
 try {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) return false;
 } catch { return false; }
 return typeof proof.documentId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proof.documentId) && /^1\.\d+\.\d+$/.test(proof.featureVersion || '') && proof.origin === origin &&
  ['fresh-owned', 'device-only'].includes(proof.profile || '') && proof.canInitialize === true;
};
export const createLocalHomeBootstrap = (options: {
 origin: string;
 identity: { read(): { generation: number; pending: boolean } };
 selection: { canInitializeDeviceHome(): boolean; initializeDeviceHome(proof: unknown): void };
 requestHost(action: 'status' | 'initialize', expected?: DeviceHomeProof): Promise<unknown>;
}) => {
 const capture = () => {
  const state = options.identity.read();
  if (state.pending || !options.selection.canInitializeDeviceHome()) throw new Error('A device-only workspace cannot replace an existing or changing identity.');
  return state.generation;
 };
 const current = (generation: number, proof: unknown) => {
  if (capture() !== generation || !isDeviceHomeProof(proof, options.origin)) throw new Error('This native profile is not available for a new device-only workspace.');
 };
 return {
  available: async () => {
   try { const generation = capture(), proof = await options.requestHost('status'); current(generation, proof); return true; }
   catch { return false; }
  },
  initialize: async () => {
   const generation = capture(), status = await options.requestHost('status');
   current(generation, status);
   if (!isDeviceHomeProof(status, options.origin)) throw new Error('A compatible native device workspace is required.');
   const proof = await options.requestHost('initialize', status);
   current(generation, proof);
   if (!isDeviceHomeProof(proof, options.origin) || proof.documentId !== status.documentId || proof.featureVersion !== status.featureVersion) throw new Error('The native document changed during workspace initialization.');
   options.selection.initializeDeviceHome(proof);
  }
 };
};
