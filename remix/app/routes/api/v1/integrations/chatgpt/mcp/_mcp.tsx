import { handleChatGptMcp } from '~/api/utils/chatgpt/plugin';

// Streamable HTTP MCP endpoint for the Thingtime ChatGPT plugin. OAuth is
// discovered from the protected-resource metadata; tool calls are stateless
// and account tools require the encrypted, revocable bridge session. The
// exact optional offline renderer accepts caller-provided content anonymously.
export const action = handleChatGptMcp;
