// A dedicated purpose keeps moderation credentials out of paid chat/CI use.
export const MODERATION_CREDENTIAL_PLATFORM = 'OpenAI Moderation';

type CredentialReader = (platform: string) => Promise<string | null>;
const readCredential: CredentialReader = async (platform) => {
  const { readServerCredential } = await import('../ciControl/credentialVault');
  return readServerCredential(platform);
};

export const resolveModerationEnvironment = async (
  env: NodeJS.ProcessEnv = process.env,
  read: CredentialReader = readCredential
): Promise<NodeJS.ProcessEnv> => {
  // Preserve the explicitly selected deterministic API-suite provider.
  if (env.THINGTIME_MODERATION_PROVIDER === 'test') return env;
  const key = await read(MODERATION_CREDENTIAL_PLATFORM);
  // Legacy env remains a migration fallback only when no enabled entry exists.
  // Vault read/decryption errors propagate; never hide a broken vault by using
  // an old credential. Do not mutate process.env or other provider consumers.
  return key === null ? env : { ...env, OPENAI_API_KEY: key };
};
