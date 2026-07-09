import { json } from '~/api/http';
import { getEmailTestConfig } from '~/api/utils/email/testConfig';

export const loader = async () => {
  return json({
    ok: true,
    email: getEmailTestConfig()
  });
};

export const action = loader;
