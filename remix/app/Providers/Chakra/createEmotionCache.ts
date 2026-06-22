import * as emotionCacheModule from '@emotion/cache';

const emotionCacheFactory =
  (emotionCacheModule as { default?: unknown }).default ??
  (emotionCacheModule as { createCache?: unknown }).createCache ??
  (emotionCacheModule as unknown);

if (typeof emotionCacheFactory !== 'function') {
  throw new Error(
    'Emotion cache factory import failed. Expected a function export from @emotion/cache.',
  );
}

export const createEmotionCache = () => {
  return emotionCacheFactory({
    key: 'cha'
  });
};

export const defaultEmotionCache = createEmotionCache();
