import * as emotionCacheModule from '@emotion/cache';
import type { EmotionCache, Options as EmotionCacheOptions } from '@emotion/cache';

type EmotionCacheFactory = (options: EmotionCacheOptions) => EmotionCache;

const getExport = (value: unknown, key: 'default' | 'createCache') => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
};

const resolveEmotionCacheFactory = (moduleValue: unknown) => {
  const candidates = [
    moduleValue,
    getExport(moduleValue, 'default'),
    getExport(moduleValue, 'createCache'),
    getExport(getExport(moduleValue, 'default'), 'default'),
    getExport(getExport(moduleValue, 'default'), 'createCache'),
  ];

  return candidates.find((candidate): candidate is EmotionCacheFactory => typeof candidate === 'function');
};

const emotionCacheFactory = resolveEmotionCacheFactory(emotionCacheModule);

if (!emotionCacheFactory) {
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
