import { createNativeWebReleaseHandlers } from '~/api/utils/releases/nativeWebHttp';
export const loader = createNativeWebReleaseHandlers().catalogue;
export const action = loader;
