import { definePlugin } from 'nitro';
import { GATEWAY_WORK_LIFECYCLE } from '../../app/api/utils/deployment/environmentGateway';

// The signed embedded bundle and native host share this process. This is not a
// renderer bridge or HTTP operation, and carries no account data or authority.
const KEY = Symbol.for('thingtime.runtime-work.lifecycle');
export default definePlugin(nitro => {
  Reflect.set(globalThis, KEY, GATEWAY_WORK_LIFECYCLE);
  nitro.hooks.hook('close', () => {
    if (Reflect.get(globalThis, KEY) === GATEWAY_WORK_LIFECYCLE) Reflect.deleteProperty(globalThis, KEY);
  });
});
