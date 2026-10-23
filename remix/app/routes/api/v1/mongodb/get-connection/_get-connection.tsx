import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { safeErrorText } from '~/api/utils/errors/safeError';
import { getMongoUri, sanitiseMongoHost } from '~/api/utils/mongodb/config';
import { Submit } from '~/components/API/Submit';

const routeName = 'API V1 MongoDB Get Connection';

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

const actionExport = async () => {
	try {
		return earlyReturn({
			status: 200,
			message: `successful`,
			data: {
				host: sanitiseMongoHost(getMongoUri())
			}
		});
	} catch (err: any) {
		return earlyReturn({
			status: 500,
			message: safeErrorText(err, 'mongodb get-connection', 'No valid MongoDB connection found')
		});
	}
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
