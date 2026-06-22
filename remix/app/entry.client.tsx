import { hydrate } from 'react-dom';
// import { RemixBrowser } from "remix";
import { RemixBrowser } from '@remix-run/react';

try {
  window.process = window.process || { env: {} };
} catch (err) {
  // nothing
}

hydrate(<RemixBrowser />, document);
