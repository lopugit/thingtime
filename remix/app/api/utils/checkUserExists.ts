// query mongodb for user objects with the email provided
// if user exists, return true
// if user does not exist, return false

import { createConnection } from './mongodb/connection';

export const checkUserExists = async ({ email }) => {
  
  const client = await createConnection();
  const db = client.db('auth');
  const collection = db.collection('users');
  const user = await collection.findOne({ email });
  
  if (user) {
    return true;
  }
  
  return false;
  
}
  