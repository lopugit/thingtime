import { ChakraProvider } from '@chakra-ui/react'
// import type { MetaFunction } from "@vercel/remix"
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration
} from '@remix-run/react'
import { Analytics } from '@vercel/analytics/react'
import { Main } from './components/Layout/Main'
import { StateProvider } from './Providers/State'

function Document ({
  children,
  title = 'Thingtime'
}: {
  children: React.ReactNode
  title?: string
}) {
  return (
    <html lang='en'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width,initial-scale=1' />
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body>
        <Main>{children}</Main>
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
        <Analytics />
      </body>
    </html>
  )
}

export default function App () {
  return (
    <Document>
      <StateProvider>
        <ChakraProvider>
          <Outlet />
        </ChakraProvider>
      </StateProvider>
    </Document>
  )
}

// limiter

const setThingtime = glob => {
  try {
    glob.thingtime = {
      tmp: {},
      subscribers: {},
      state: {},
      things: {
        db: {},
        limit: 9999,
        maxDepth: 10,
        count: 0
      }
    }
  } catch (err) {
    // will error on server
  }
}

try {
  setThingtime(window)
} catch {
  setThingtime(globalThis)
}
