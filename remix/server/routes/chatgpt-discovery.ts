import { defineHandler } from 'nitro/h3';

import { chatGptPluginDiscoveryResponse } from '../../app/api/utils/chatgpt/plugin';
import { CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH, CHATGPT_PROTECTED_RESOURCE_METADATA_PATH } from '../../app/api/utils/chatgpt/pluginCore';

export default defineHandler(async (event) => {
  const path = new URL(event.req.url).pathname;
  const isCapabilityManifest = path !== CHATGPT_PROTECTED_RESOURCE_METADATA_PATH && path !== CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH;
  const discovery = await chatGptPluginDiscoveryResponse({ request: event.req, includeRuntimeFeatures: isCapabilityManifest });
  const body =
    path === CHATGPT_PROTECTED_RESOURCE_METADATA_PATH
      ? discovery.protectedResource
      : path === CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH
        ? discovery.authorizationServer
        : discovery.capabilityManifest;
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': isCapabilityManifest ? 'no-store' : 'public, max-age=300'
    }
  });
});
