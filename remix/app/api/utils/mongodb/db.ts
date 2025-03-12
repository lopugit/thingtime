import { getConnection } from './connection';

export const getDb = async (props: any = {}) => {
  const connection = await getConnection();

  const db = await connection.db('thingtime');

  return db;
};
