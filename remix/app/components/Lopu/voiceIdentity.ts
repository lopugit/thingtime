// Voice session and transcript request IDs cross the persistence boundary.
// Fail closed if secure randomness is unavailable; never use Math.random.
export const newLopuVoiceId = (prefix: string): string => `${prefix}-${globalThis.crypto.randomUUID()}`;
