import { hydrate } from 'react-dom'
// import { RemixBrowser } from "remix";
import { RemixBrowser } from '@remix-run/react'
try {
  window.process = {}
} catch (err) {
  // nothing
}

hydrate(<RemixBrowser />, document)
