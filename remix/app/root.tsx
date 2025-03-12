// import type { MetaFunction } from "@vercel/remix"
import { defer, Links, LiveReload, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import { Analytics } from '@vercel/analytics/react';

import { GlobalStyles } from './globals/GlobalStyles';

import { Session } from './cookies.server';

import { Main } from './components/Layout/Main';
import { useIcons } from './hooks/useIcons';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';
import { json, LoaderArgs } from '@vercel/remix';
import { DevKit } from './components/DevKit/DevKit';

function Document({ children, title = 'Thingtime' }: { children: React.ReactNode; title?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body>
        {children}
        <GlobalStyles />
        <ScrollRestoration />
        <Scripts />
        {/* <LiveReload /> */}
        <Analytics />
      </body>
    </html>
  );
}

export default function App() {
  useIcons();

  return (
    <Document>
      <ChakraWrapper>
        <ThingtimeProvider>
          <DevKit />
          <Main>
            <Outlet />
          </Main>
        </ThingtimeProvider>
      </ChakraWrapper>
    </Document>
  );
}

export async function loader({ request, context }: LoaderArgs) {
  const { session, store } = context;
  console.log('nik context', context);
  console.log('nik session', session);
  const cookieHeader = request.headers.get('Cookie');

  const cookie = (await Session.parse(cookieHeader)) || {};

  const cookiePingCounter = cookie.pingCounter || 0;

  const pingCounter = cookiePingCounter + 1;

  // .log everyone

  console.log('nik cookie', cookie);
  console.log('nik pingCounter', pingCounter);
  console.log('nik cookie?.pingCounter', cookie?.pingCounter);

  return json(
    {},
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
