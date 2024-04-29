// import type { MetaFunction } from "@vercel/remix"
import { Analytics } from '@vercel/analytics/react';

import { Html, Head, Main, NextScript } from 'next/document';

import { Globals } from '~/globals/GlobalStyles';

export default function Document({ children, title = 'Thingtime' }: { children: React.ReactNode; title?: string }) {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
      </Head>
      <body>
        <Main />
        <NextScript />
        <Globals />
        <Analytics />
      </body>
    </Html>
  );
}
