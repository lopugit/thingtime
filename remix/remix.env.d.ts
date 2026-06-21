/// <reference types="@remix-run/dev" />
/// <reference types="@vercel/remix" />

// Opt in to Single Fetch types (Date/Map/etc. survive serialization, `.data` URLs)
import '@remix-run/server-runtime';
declare module '@remix-run/server-runtime' {
  interface Future {
    v3_singleFetch: true;
  }
}
