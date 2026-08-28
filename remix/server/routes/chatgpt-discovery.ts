import { defineHandler } from 'nitro/h3';

import { chatGptPluginDiscoveryResponse } from '../../app/api/utils/chatgpt/plugin';
import { CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH, CHATGPT_PROTECTED_RESOURCE_METADATA_PATH } from '../../app/api/utils/chatgpt/pluginCore';

export default defineHandler(async (event) => {
  const discovery = chatGptPluginDiscoveryResponse({ request: event.req });
  const path = new URL(event.req.url).pathname;
  const body =
    path === CHATGPT_PROTECTED_RESOURCE_METADATA_PATH
      ? discovery.protectedResource
      : path === CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH
        ? discovery.authorizationServer
        : discovery.capabilityManifest;
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
});
