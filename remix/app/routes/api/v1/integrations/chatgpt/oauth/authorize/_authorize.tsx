import { beginChatGptAuthorization, submitChatGptAuthorization } from '~/api/utils/chatgpt/plugin';

// Browser/mobile consent page. It accepts scoped Thingtime PATs rather than a
// full Thingtime session, so the ChatGPT bridge never receives account-cookie
// authority and can support several named accounts/endpoints in one grant.
export const loader = beginChatGptAuthorization;
export const action = submitChatGptAuthorization;
