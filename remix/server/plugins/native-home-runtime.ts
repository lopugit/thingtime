import { definePlugin } from 'nitro';
import { closeNativeHomeRuntime, isNativeHomeSelected } from '../utils/nativeHomeRuntime';

// Lazy request bootstrap owns its provider until canonical Nitro shutdown.
export default definePlugin(nitro => {
 if (!isNativeHomeSelected()) return;
 const key = Symbol.for('thingtime.native-home.close');
 if (Object.getOwnPropertyDescriptor(globalThis, key)) throw new Error('Native account shutdown ownership is already installed');
 const close = () => closeNativeHomeRuntime();
 Object.defineProperty(globalThis, key, { enumerable: false, configurable: true, value: close });
 nitro.hooks.hook('close', async () => {
  await close();
  if (Reflect.get(globalThis, key) === close) Reflect.deleteProperty(globalThis, key);
 });
});
