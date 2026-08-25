import { exchangeChatGptAuthorizationCode } from '~/api/utils/chatgpt/plugin';

// OAuth 2.1 public-client code exchange. S256 PKCE plus a one-time session
// record proves the ChatGPT client and keeps encrypted PATs server-side.
export const action = exchangeChatGptAuthorizationCode;
