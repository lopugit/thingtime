import { userCheckExists } from '~/api/utils/userCheckExists';
import { userValidatePassword } from '~/api/utils/userValidatePassword';

export default function Index() {
  return <div>Login</div>;
}

export const action = async ({ request }) => {
  console.log('nik request', request);

  // get remix action body

  const body = await request.json();

  const { username, password } = body;

  console.log('nik body', body);

  console.log('nik username', username);
  console.log('nik password', password);

  const userExists = userCheckExists(username);

  if (!userExists) {
    // validate password
    return earlyReturn({ status: 401, message: 'User does not exist' });
  }

  // validate password
  const passwordMatches = userValidatePassword({ username, password });

  if (!passwordMatches) {
    return earlyReturn({ status: 401, message: 'Password does not match' });
  }

  return earlyReturn({ status: 200, message: 'Login successful' });
};

const earlyReturn = (args) => {
  return {
    status: args?.status || 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: 'Early return triggered in login action' + (args?.message ? `: ${args.message}` : '')
    },
    cache: {
      revalidate: 60
    }
  };
};
