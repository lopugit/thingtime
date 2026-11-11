import { definePlugin } from 'nitro';
import { closeChatGPTPlanRuntime, isChatGPTPlanRuntimeIdle, reserveChatGPTPlanRuntimeShutdown } from '../../app/api/utils/ai/chatgptPlanRuntime';

// The embedded Electron server shares this Node global, but its sandboxed
// renderer does not. Native quit awaits this before stopping managed MongoDB.
const CLOSE = Symbol.for('thingtime.chatgpt-plan.close');
const IDLE = Symbol.for('thingtime.chatgpt-plan.idle');
const RESERVE = Symbol.for('thingtime.chatgpt-plan.reserve-shutdown');
export default definePlugin((nitro) => {
  Reflect.set(globalThis, CLOSE, closeChatGPTPlanRuntime);
  Reflect.set(globalThis, IDLE, isChatGPTPlanRuntimeIdle);
  Reflect.set(globalThis, RESERVE, reserveChatGPTPlanRuntimeShutdown);
  nitro.hooks.hook('close', async () => {
    await closeChatGPTPlanRuntime();
    if (Reflect.get(globalThis, CLOSE) === closeChatGPTPlanRuntime) Reflect.deleteProperty(globalThis, CLOSE);
    if (Reflect.get(globalThis, IDLE) === isChatGPTPlanRuntimeIdle) Reflect.deleteProperty(globalThis, IDLE);
    if (Reflect.get(globalThis, RESERVE) === reserveChatGPTPlanRuntimeShutdown) Reflect.deleteProperty(globalThis, RESERVE);
  });
});
