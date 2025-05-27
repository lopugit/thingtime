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

// intercept console.log and read from window.tt.settings.logging.all whether to log if it includes [tt.Thingtime]
const originalConsoleLog = console.log;
console.log = (...args) => {
  // Check if the first argument is a string and contains '[tt.Thingtime]'
  try {
    
    if (typeof args[0] === 'string' && args[0].includes('[tt.Thingtime]')) {
      
      if (typeof window !== 'undefined' && window.tt?.settings?.logging?.all) {
        // Check if logging is enabled in Thingtime settings
        originalConsoleLog(...args);
      }
      
    } else {
      // For all other logs, just call the original console.log
      originalConsoleLog(...args);
    }
  } catch (err) {
    // If there's an error (e.g., window.tt is not defined), just call the original console.log
    originalConsoleLog(...args);
  }
}

function Document({ children, title = 'Thingtime' }: { children: React.ReactNode; title?: string }) {
  // check Remix environment
  // for dev mode
  let titlePrefix = '';
  // log the process.env.NODE_ENV
  console.log('process.env.NODE_ENV', process.env.NODE_ENV);
  if (process.env.NODE_ENV === 'development') {
    titlePrefix = '🧑‍💻';
  }

  try {
    // actually also check if the domain is not thingtime.com
    // then add the prefix
    const hostname = window.location.hostname;
    if (hostname !== 'thingtime.com') {
      titlePrefix = '🧑‍💻';
    }
  } catch (err) {
    // will error on server
    // do nothing
  }

  // the favicon will also vary depending on the environment

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <title>{titlePrefix ? titlePrefix + ' ' + title : title}</title>
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
  const cookieHeader = request.headers.get('Cookie');

  const cookie = (await Session.parse(cookieHeader)) || {};

  const cookiePingCounter = cookie.pingCounter || 0;

  const pingCounter = cookiePingCounter + 1;

  // .log everyone


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
