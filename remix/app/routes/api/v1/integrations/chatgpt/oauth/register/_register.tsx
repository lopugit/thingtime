import { registerChatGptOAuthClient } from '~/api/utils/chatgpt/plugin';

// OAuth Dynamic Client Registration fallback for Codex clients that do not yet
// support ChatGPT's Client ID Metadata Documents. The endpoint admits only
// exact 127.0.0.1 loopback callbacks and signs the resulting client ID.
export const action = registerChatGptOAuthClient;
