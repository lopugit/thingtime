// import type { MetaFunction } from "@vercel/remix"
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import { Analytics } from '@vercel/analytics/react';
import React from 'react';

import { GlobalStyles } from './globals/GlobalStyles';

import { Session } from './cookies.server';

import { Main } from './components/Layout/Main';
import { useIcons } from './hooks/useIcons';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';
// TODO: See what to replace LoaderArgs with
import { json } from '@vercel/remix';
import type { LoaderArgs } from '@vercel/remix';
import { DevKit } from './components/DevKit/DevKit';

function Document({
  children,
  title = 'Thingtime',
  titlePrefix = ''
}: {
  children: React.ReactNode;
  title?: string;
  titlePrefix?: string;
}) {
  // the favicon will also vary depending on the environment

  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <title>{titlePrefix ? titlePrefix + ' ' + title : title}</title>
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        {/* <LiveReload /> */}
      </body>
    </html>
  );
}

export default function App() {
  // grab env from loader
  const { envFromCookie, titlePrefix } = useLoaderData<typeof loader>();

  // log the cookie
  console.log('envFromCookie in root.tsx:', envFromCookie);

  // add env to window .env
  React.useEffect(() => {
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
        <Analytics />
      </ChakraWrapper>
    </Document>
  );
}

export async function loader({ request }: LoaderArgs) {
  const cookieHeader = request.headers.get('Cookie');

  const cookie = (await Session.parse(cookieHeader)) || {};

  const cookiePingCounter = cookie.pingCounter || 0;

  const pingCounter = cookiePingCounter + 1;

	const processEnv = {};
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

  // .log everyone

	return json(
		{
			envFromCookie: { ...processEnv },
			devKitEnv,
			titlePrefix
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
