// @ts-ignore
import { getClient } from './client';
import { getMongoUri } from './config';

export const getConnection = async () => {
	const MongoClient = await getClient();
	const connectionUri = getMongoUri();

	const client = new MongoClient(connectionUri, {});
	await client.connect();
	return client;
};
