// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

import { getConnection } from './mongodb/connection';

export const userCheckExists = async ({ username }) => {
  const client = await getConnection();
  const db = client.db('auth');
  const collection = db.collection('users');
  const user = await collection.findOne({ username });

  if (user) {
    return true;
  }

  return false;
};
