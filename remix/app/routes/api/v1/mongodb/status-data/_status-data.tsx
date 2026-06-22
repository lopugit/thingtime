import { json } from '@vercel/remix';

import { getMongoStatus } from '~/api/utils/mongodb/status';

// Resource-only endpoint for plain browser fetches. The sibling status route
// renders the in-app API tester, so normal fetch() receives HTML there.
export const loader = async () => {
  const status = await getMongoStatus();
  return json(status);
};
