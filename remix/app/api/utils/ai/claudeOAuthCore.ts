export const claudeOAuthConfigured = (env: NodeJS.ProcessEnv = process.env) =>
	Boolean(env.CLAUDE_CODE_OAUTH_TOKEN_THINGTIME?.trim() || env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || env.THINGTIME_ADMIN_VAULT_KEY?.trim());
