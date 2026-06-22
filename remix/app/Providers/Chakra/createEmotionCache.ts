import createCacheModule from '@emotion/cache';

const createCache = 'default' in createCacheModule ? createCacheModule.default : createCacheModule;

export const createEmotionCache = () => {
  return createCache({
    key: 'css'
  });
};
