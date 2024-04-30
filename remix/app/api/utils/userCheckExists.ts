// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

import { createConnection } from './mongodb/connection';

export const userCheckExists = async ({ username }) => {
  
  const client = await createConnection();
  const db = client.db('auth');
  const collection = db.collection('users');
  const user = await collection.findOne({ username });
  
  if (user) {
    return true;
  }
  
  return false;
  
}
  