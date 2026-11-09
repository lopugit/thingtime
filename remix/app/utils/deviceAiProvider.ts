// A device connection is an opaque pin, never hosted inference authority.
export const isDeviceAiProvider = (value: unknown): value is string => typeof value === 'string' &&
  /^chatgpt-plan-device-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
