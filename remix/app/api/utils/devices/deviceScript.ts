export type DeviceScriptInput = { script: string; timeoutSeconds: number };
export type DeviceScriptResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: number | null;
	timedOut: boolean;
	truncated: boolean;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function normalizeDeviceScriptInput(value: unknown): DeviceScriptInput | null {
	if (
		!record(value) ||
		Object.keys(value).length !== 2 ||
		typeof value.script !== 'string' ||
		!value.script.trim() ||
		value.script.includes('\0') ||
		bytes(value.script) > 16_384 ||
		!Number.isInteger(value.timeoutSeconds) ||
		Number(value.timeoutSeconds) < 1 ||
		Number(value.timeoutSeconds) > 30
	)
		return null;
	return { script: value.script, timeoutSeconds: Number(value.timeoutSeconds) };
}
export function normalizeDeviceScriptResult(value: unknown): DeviceScriptResult | null {
	if (
		!record(value) ||
		Object.keys(value).length !== 6 ||
		typeof value.stdout !== 'string' ||
		typeof value.stderr !== 'string' ||
		bytes(value.stdout) + bytes(value.stderr) > 3 * 16_384 ||
		typeof value.timedOut !== 'boolean' ||
		typeof value.truncated !== 'boolean'
	)
		return null;
	const code = value.exitCode,
		signal = value.signal;
	if (
		!(code === null || (Number.isInteger(code) && Number(code) >= 0 && Number(code) <= 255)) ||
		!(signal === null || (Number.isInteger(signal) && Number(signal) >= 1 && Number(signal) <= 127)) ||
		(code === null) === (signal === null)
	)
		return null;
	return {
		stdout: value.stdout,
		stderr: value.stderr,
		exitCode: code as number | null,
		signal: signal as number | null,
		timedOut: value.timedOut,
		truncated: value.truncated
	};
}
