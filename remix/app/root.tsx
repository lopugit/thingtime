// import type { MetaFunction } from "@vercel/remix"
import { defer, Links, LiveReload, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import { Analytics } from '@vercel/analytics/react';

import { GlobalStyles } from './globals/GlobalStyles';

import { Session } from './cookies.server';

import { Main } from './components/Layout/Main';
import { useIcons } from './hooks/useIcons';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';
// TODO: See what to replace LoaderArgs with
import { json, LoaderArgs } from '@vercel/remix';
import { DevKit } from './components/DevKit/DevKit';

// intercept console.log and read from window.tt.settings.logging.all whether to log if it includes [tt]
const originalConsoleLog = console.log;
const logConfig = {
  trace: true
};
const whitelistObj = {
  '[tt][undo]': true,
  '[tt][redo]': true,
  '[tt][history]': true,
  '[tt][error]': false,
  '[tt][warn]': false,
  '[tt][info]': false,
  '[tt][debug]': false,
  '[tt][ThingtimeProvider.tsx][set][path]': true
};
const whitelist = [].concat(Object.keys(whitelistObj).filter((key) => whitelistObj[key]));
// console.log = (...args) => {
//   // Check if the first argument is a string and contains '[tt]'
//   try {
//     if (typeof args[0] === 'string' && args[0].startsWith('[tt]')) {
//       const allowLogging = window.tt?.settings?.logging?.all || whitelist.some((item) => args[0].startsWith(item));
//       if (typeof window !== 'undefined' && allowLogging) {
//         if (logConfig.trace) {
//           // If trace is enabled, log the stack trace
//           const stack = new Error().stack;
//           originalConsoleLog(...args, '\nStack Trace:', stack.replace(/^Error\n/, '🌈Thingtime Logger🦄'));
//         } else {
//           // Check if logging is enabled in Thingtime settings
//           originalConsoleLog(...args);
//         }
//       }
//     } else {
//       // For all other logs, just call the original console.log
//       originalConsoleLog(...args);
//     }
//   } catch (err) {
//     // If there's an error (e.g., window.tt is not defined), just call the original console.log
//     originalConsoleLog(...args);
//   }
// };

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

  // assign known process.env variables to window.env object
  try {
    if (typeof window !== 'undefined') {
      window.env = {
        ...window.env,
        BRANCH_NAME: process.env.BRANCH_NAME || 'git/unknown'
      };
    }
  } catch (err) {
    // will error on server
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
  // grab env from loader
  const { envFromCookie } = useLoaderData<typeof loader>();

  // log the cookie
  console.log('envFromCookie in root.tsx:', envFromCookie);

  // add env to window .env
  try {
    if (typeof window !== 'undefined') {
      window.envFromCookie = {
        ...window.env,
        ...envFromCookie
      };
    }
  } catch (err) {
    // will error on server
  }

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

  const processEnv = {};

  // add all process.env variables that start with THINGTIME_ to the cookie
  for (const key in process.env) {
    if (key.startsWith('THINGTIME_') && !key.includes('PRIVATE')) {
      processEnv[key] = process.env[key];
    }
  }

  // .log everyone

  return json(
    {
      envFromCookie: { ...processEnv }
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
