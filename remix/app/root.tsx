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
      <ChakraProvider>
        <Outlet />
      </ChakraProvider>
    </Document>
  )
}
