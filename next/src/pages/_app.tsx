import { DefaultLayout } from '~/layouts/Default';
import type { AppProps } from 'next/app';
import { useIcons } from '~/providers/hooks/useIcons';

export default function MyApp({ Component, pageProps }: AppProps) {
  useIcons();

  return (
    <>
      <DefaultLayout>
        <Component {...pageProps} />
      </DefaultLayout>
    </>
  );
}

// limiter
const setThingtime = (glob: any) => {
  try {
    glob.meta = {
      tmp: {},
      subscribers: {},
      state: {},
      db: {},
      stats: {
        db: {},
        limit: 9999,
        maxDepth: 99,
        count: 0
      },
      things: {}
    };
  } catch (err) {
    // will error on server
  }
};

try {
  setThingtime(window);
} catch {
  setThingtime(globalThis);
}
