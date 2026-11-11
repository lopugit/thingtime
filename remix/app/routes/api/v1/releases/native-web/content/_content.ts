import { createNativeWebReleaseHandlers } from '~/api/utils/releases/nativeWebHttp';
export const loader = createNativeWebReleaseHandlers().content;
export const action = loader;
