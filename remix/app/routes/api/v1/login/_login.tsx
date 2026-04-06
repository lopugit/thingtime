import { getUser } from '~/api/utils/getUser';
import { userCheckExists } from '~/api/utils/userCheckExists';
import { userCreateSession } from '~/api/utils/userCreateSession';
import { userValidatePassword } from '~/api/utils/userValidatePassword';

export default function Index() {
  return <div>Login</div>;
}

export const action = async ({ request }) => {
	const { context } = request;

	// get remix action body
	const body = await request.json();

	const { username, password } = body;

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

	const user = getUser(username);

	const session = await userCreateSession(user);

	const keypair = await crypto.generateKeyPair('rsa', {
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1])
	});

	// @ts-ignore
	// const keypair = await crypt.generateKeyPairSync('ec', {
	//   namedCurve: 'prime256v1'

	//   // namedCurve: 'secp256k1',
	//   // publicKeyEncoding: {
	//   //   type: 'spki',
	//   //   format: 'pem'
	//   // },
	//   // privateKeyEncoding: {
	//   //   type: 'pkcs8',
	//   //   format: 'pem'
	//   // }
	// });

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
