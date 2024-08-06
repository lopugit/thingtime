import { getMongoDb } from './mongodb';

export const getClient = async () => (await getMongoDb()).MongoClient;
