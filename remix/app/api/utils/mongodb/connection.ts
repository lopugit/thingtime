// @ts-ignore
import { getClient } from './client';
import { getConnectionAction } from '../../../routes/api/v1/mongodb/get-connection/_get-connection';

export const getConnection = async () => {
  const MongoClient = await getClient();

  const connectionResp = await getConnectionAction({ request: { method: 'GET' } });

  if (!connectionResp?.body?.data) {
    throw new Error('No valid connection found');
  }

  const connectionUri = connectionResp.body.data.connection || process.env.THINGTIME_PRIVATE_MONGODB_URI;

  const client = new MongoClient(connectionUri, {});
  await client.connect();
  return client;
};
