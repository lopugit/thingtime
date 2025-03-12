import { getDb } from './db';

export const getCollection = async (props: any = {}) => {
  const db = await getDb();

  const collection = await db.collection('things');

  return collection;
};
