import { handleChatGptOAuthRelay, startChatGptOAuthRelay } from '~/api/utils/chatgpt/plugin';

// A first-party relay carries a completed mobile authorization response back
// to the remote Codex helper. The helper owns the polling secret and forwards
// the response into Codex's local OAuth listener for the normal PKCE exchange.
export const loader = handleChatGptOAuthRelay;
export const action = startChatGptOAuthRelay;
