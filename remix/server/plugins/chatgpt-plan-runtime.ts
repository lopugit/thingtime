import { definePlugin } from 'nitro';
import { closeChatGPTPlanRuntime } from '../../app/api/utils/ai/chatgptPlanRuntime';

// The embedded Electron server shares this Node global, but its sandboxed
// renderer does not. Native quit awaits this before stopping managed MongoDB.
const CLOSE = Symbol.for('thingtime.chatgpt-plan.close');
export default definePlugin((nitro) => {
  Reflect.set(globalThis, CLOSE, closeChatGPTPlanRuntime);
  nitro.hooks.hook('close', async () => {
    await closeChatGPTPlanRuntime();
    if (Reflect.get(globalThis, CLOSE) === closeChatGPTPlanRuntime) Reflect.deleteProperty(globalThis, CLOSE);
  });
});
