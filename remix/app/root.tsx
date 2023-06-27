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
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body>
        {children}
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
