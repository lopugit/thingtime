// import type { MetaFunction } from "@vercel/remix"
import { withEmotionCache } from '@emotion/react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import { Analytics } from '@vercel/analytics/react';
import React from 'react';

import { GlobalStyles } from './globals/GlobalStyles';

import { Session } from './cookies.server';

import { Main } from './components/Layout/Main';
import { useIcons } from './hooks/useIcons';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ClientStyleContext, ServerStyleContext } from './Providers/Chakra/emotionContext';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';
import { json } from '@vercel/remix';
import { DevKit } from './components/DevKit/DevKit';
import { getCurrentUser } from './api/utils/auth/getCurrentUser';

type DocumentProps = {
  children: React.ReactNode;
  title?: string;
  titlePrefix?: string;
};

const useClientLayoutEffect =
  typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect;

const Document = withEmotionCache(function Document(
  { children, title = 'Thingtime', titlePrefix = '' }: DocumentProps,
  emotionCache
) {
  const serverStyleData = React.useContext(ServerStyleContext);
  const clientStyleData = React.useContext(ClientStyleContext);

  // the favicon will also vary depending on the environment

  useClientLayoutEffect(() => {
    emotionCache.sheet.container = document.head;

    const tags = emotionCache.sheet.tags;
    emotionCache.sheet.flush();
    tags.forEach((tag) => {
      emotionCache.sheet._insertTag(tag);
    });

    clientStyleData?.reset();
    // Emotion's Remix handoff must run once; adding cache/context deps retriggers the reset loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <title>{titlePrefix ? titlePrefix + ' ' + title : title}</title>
        <Links />
        {serverStyleData?.map(({ key, ids, css }) => (
          <style
            key={`${key}-${ids.join(' ')}`}
            data-emotion={`${key} ${ids.join(' ')}`}
            dangerouslySetInnerHTML={{ __html: css }}
          />
        ))}
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        {/* <LiveReload /> */}
      </body>
    </html>
  );
});

export default function App() {
  // grab env from loader
  const { envFromCookie, titlePrefix } = useLoaderData<typeof loader>();
  const [mounted, setMounted] = React.useState(false);

  // log the cookie
  console.log('envFromCookie in root.tsx:', envFromCookie);

  // add env to window .env
  React.useEffect(() => {
    setMounted(true);

    try {
      if (typeof window !== 'undefined') {
        window.envFromCookie = {
          ...window.env,
          ...envFromCookie
        };
        window.env = {
          ...window.env,
          BRANCH_NAME: envFromCookie?.THINGTIME_BRANCH_NAME || 'git/unknown'
        };
      }
    } catch (err) {
      // will error on server
    }
  }, [envFromCookie]);

  useIcons();

  return (
    <Document titlePrefix={titlePrefix}>
      <ChakraWrapper>
        <GlobalStyles />
        <ThingtimeProvider>
          <DevKit />
          <Main>
            <Outlet />
          </Main>
        </ThingtimeProvider>
        {mounted ? <Analytics /> : null}
      </ChakraWrapper>
    </Document>
  );
}

type RootLoaderData = {
  envFromCookie: Record<string, string | undefined>;
  devKitEnv: Record<string, string | undefined>;
  titlePrefix: string;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
};

const getDeploymentBranchName = () => {
  return (
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.THINGTIME_BRANCH_NAME ||
    'git/unknown'
  );
};

const shouldShowDeploymentStatus = () => {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.VERCEL_ENV === 'preview' ||
    process.env.VERCEL_TARGET_ENV === 'preview'
  );
};

export async function loader({ request }: { request: Request }) {
  const cookieHeader = request.headers.get('Cookie');

  const cookie = (await Session.parse(cookieHeader)) || {};

  const cookiePingCounter = cookie.pingCounter || 0;

  const pingCounter = cookiePingCounter + 1;

  const processEnv: RootLoaderData['envFromCookie'] = {};
  const url = new URL(request.url);
  const devKitEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ...Object.fromEntries(url.searchParams)
  };
  const titlePrefix =
    process.env.NODE_ENV === 'development' || url.hostname !== 'thingtime.com'
      ? '🧑‍💻'
      : '';

  // add all process.env variables that start with THINGTIME_ to the cookie
  for (const key in process.env) {
    if (key.startsWith('THINGTIME_') && !key.includes('PRIVATE')) {
      processEnv[key] = process.env[key];
    }
  }

  processEnv.THINGTIME_BRANCH_NAME = getDeploymentBranchName();
  processEnv.THINGTIME_VERCEL_ENV =
    process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;
  processEnv.THINGTIME_VERCEL_URL = process.env.VERCEL_URL;
  processEnv.THINGTIME_VERCEL_BRANCH_URL = process.env.VERCEL_BRANCH_URL;
  processEnv.THINGTIME_VERCEL_GIT_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA;
  processEnv.THINGTIME_SHOW_DEPLOYMENT_STATUS = shouldShowDeploymentStatus() ? 'true' : 'false';

  // .log everyone
  const user = await getCurrentUser(request);

  return json(
    {
      envFromCookie: { ...processEnv },
      devKitEnv,
      titlePrefix,
      user
    },
    {
      headers: {
        'Set-Cookie': await Session.serialize({ ...cookie, pingCounter })
      }
    }
  );

  // return defer(
  //   {
  //     // isLoggedIn: Boolean(customerAccessToken),
  //   },
  //   {
  //     headers: {
  //       // 'Set-Cookie': await session.commit()
  //     }
  //   }
  // );
}

// limiter
const setThingtime = (glob) => {
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
