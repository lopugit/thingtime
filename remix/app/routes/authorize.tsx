import React from 'react';

import { AuthorizePage } from '~/components/OAuth/AuthorizePage';

// /authorize — the "Login with Thingtime" popup opened by the embed SDK
// (public/sdk/thingtime-login.js) from third-party sites.
export default function Authorize() {
  return <AuthorizePage />;
}
