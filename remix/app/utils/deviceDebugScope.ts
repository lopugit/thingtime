/** Explicit identity refusal; unlike a failed refresh this retires cached data. */
export class DeviceDebugScopeError extends Error {
	constructor() { super('The diagnostics account or selected server changed.'); }
}
