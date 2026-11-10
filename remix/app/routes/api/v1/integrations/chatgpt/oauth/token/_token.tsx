import { exchangeChatGptAuthorizationCode } from '~/api/utils/chatgpt/plugin';

// OAuth 2.1 public-client token endpoint. S256 PKCE proves the initial
// ChatGPT authorization-code exchange; optional refresh grants rotate a
// server-side connection reference without exposing its encrypted PATs.
export const action = exchangeChatGptAuthorizationCode;
