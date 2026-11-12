export const RENDER_EXPORT_TOOL = 'thingtime_render_and_export';
export const HOSTED_RENDER_FEATURE = 'chatgpt.render-export';
export const HOSTED_RENDER_VERSION = '1.0.0';
export const RENDER_WORKER_PROTOCOL = '1.0.0';
export const MAX_RENDER_CONTENT_BYTES = 256 * 1024;
// A valid JSON-RPC envelope may represent each content byte with a JSON escape.
export const MAX_RENDER_RPC_BYTES = 6 * MAX_RENDER_CONTENT_BYTES + 8192;
export const RENDER_CROP_BLOCK_PATTERN = /^[\w-]{1,128}$/;
export const defaultRenderViewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
export const RENDER_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['content'], properties: {
    content: {
      description: 'Caller-supplied canonical Thing or thingtime.transfer v1; text/CSS only, all dependencies included',
      anyOf: [{ type: 'string', maxLength: MAX_RENDER_CONTENT_BYTES }, { type: 'object' }]
    },
    root: { type: 'string', maxLength: 200 },
    viewports: {
      type: 'array', minItems: 1, maxItems: 3, default: defaultRenderViewports,
      items: { type: 'object', additionalProperties: false, required: ['width', 'height'], properties: {
        width: { type: 'integer', minimum: 320, maximum: 1920 }, height: { type: 'integer', minimum: 320, maximum: 1440 }
      } }
    },
    crop: {
      type: 'object', additionalProperties: false, default: { enabled: true },
      properties: { enabled: { type: 'boolean', default: true }, blockId: { type: 'string', pattern: RENDER_CROP_BLOCK_PATTERN.source } }
    }
  }
} as const;
