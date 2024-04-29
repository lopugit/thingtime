import { MongoClient } from 'mongodb';

export const createConnection = async () => {
  const client = new MongoClient(process.env.MONGODB_URI, {});
  await client.connect();
  return client;
};
