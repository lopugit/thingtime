// import type { MetaFunction } from "@vercel/remix"
import { Links, LiveReload, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import { Analytics } from '@vercel/analytics/react';

import { Globals } from './globals/GlobalStyles';

import { Main } from './components/Layout/Main';
import { useIcons } from './hooks/useIcons';
import { ChakraWrapper } from './Providers/Chakra/ChakraWrapper';
import { ThingtimeProvider } from './Providers/ThingtimeProvider';

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
        <Globals />
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
          <Main>
            <Outlet />
          </Main>
        </ThingtimeProvider>
      </ChakraWrapper>
    </Document>
  );
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
