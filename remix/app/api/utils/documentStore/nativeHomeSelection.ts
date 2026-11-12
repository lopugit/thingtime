// Cycle-free process-host selection. No imports, env lookup or request input.
export const NATIVE_HOME_HOST_KEY = Symbol.for('thingtime.native.home-profile.v1');
export const hasNativeHomeSelection = () => {
 try { return NATIVE_HOME_HOST_KEY in globalThis; }
 catch { return true; } // Malformed discovery cannot authorize a Mongo fallback.
};
export class NativeHomeMongoUnavailableError extends Error {
 readonly code = 'NATIVE_HOME_MONGO_UNAVAILABLE';
 constructor() { super('MongoDB is unavailable in the selected native home profile'); this.name = 'NativeHomeMongoUnavailableError'; }
}
export const assertMongoProviderAllowed = () => {
 if (hasNativeHomeSelection()) throw new NativeHomeMongoUnavailableError();
};
