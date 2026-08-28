import { handleChatGptMcp } from '~/api/utils/chatgpt/plugin';

// Streamable HTTP MCP endpoint for the Thingtime ChatGPT plugin. OAuth is
// discovered from the protected-resource metadata; tool calls are stateless
// and only the encrypted, revocable bridge session is accepted here.
export const action = handleChatGptMcp;
