import { Flex, Heading } from '@chakra-ui/react';
import { useLocation } from '@remix-run/react';
import { userCheckExists } from '~/api/utils/userCheckExists';
import { userValidatePassword } from '~/api/utils/userValidatePassword';
import { Submit } from '~/components/API/Submit';
import { Thingtime } from '~/components/Thingtime/Thingtime';

const routeName = 'API V1 MongoDB Get Connection';

// for now store valid mongodb urls using env and a default localhost one
const validConnections = [process.env.THINGTIME_PRIVATE_MONGODB_URI, 'mongodb://localhost:27017/'];

export default function Index() {
  // use a MagicInput to allow any args to be passed to this API
  // and use the global API testing component
  // to enable submission and render of response

  const { pathname } = useLocation();

  return (
    <Flex flexDir={'column'}>
      {/* <Thingtime></Thingtime> */}

      <Submit pathname={pathname}></Submit>
    </Flex>
  );
}

const actionExport = async ({ request }) => {
  // test all connection uri's for a successful ping

  let validConnection;

  // loop all connections and remove
  // mongodb:// protocol
  // just ping to check successful response
  for (const connection of validConnections) {
    // replace everything from mongodb to first // which should include
    // mongodb://
    // and mongodb+srv://
    const connectionUrlSanitised = connection.replace(/(mongodb.*?:\/\/)/, '');


    try {
			// test connection
			const testConnection = await fetch(`http://${connectionUrlSanitised}/`, {
				method: 'GET'
			});

			if (testConnection.ok) {
				validConnection = connection;
				break;
			}
		} catch (err) {
			console.error(`Error testing connection ${connection}:`, err);
		}
  }

  if (!validConnection) {
    return earlyReturn({ status: 500, message: `No valid MongoDB connection found` });
  }


  return earlyReturn({
    status: 200,
    message: `successful`,
    data: {
      connection: validConnection
    }
  });
};

const earlyReturn = (args) => {
  return {
    status: args?.status || 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: `Early return triggered in ${routeName} action` + (args?.message ? `: ${args.message}` : ''),
      data: args?.data
    },
    cache: {
      revalidate: 60
    }
  };
};

export const action = actionExport;

export const getConnectionAction = actionExport;
