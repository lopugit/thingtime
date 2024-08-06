// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

import { getConnection } from './mongodb/connection';

import bcrypt from 'bcrypt';

export const userValidatePassword = async ({ username, password }) => {
  const client = await getConnection();
  const db = client.db('auth');
  const collection = db.collection('users');
  const user = await collection.findOne({ username });

  if (!user) {
    return false;
  }

  const { password: hash } = user;

  const match = await bcrypt.compare(password, hash);

  if (match) {
    return true;
  }

  return false;
};
