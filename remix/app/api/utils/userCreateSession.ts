// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

import { getCollection } from './mongodb/collection';

export const userCreateSession = async (user) => {
  const userId = user?._id;

  const token = Math.random().toString(36).substring(7);

  const session = {
    userId: userId,
    created: Date.now(),
    expires: 0,
    token: token,
    type: 'tt.session'
  };

  const thingsCollection = await getCollection();

  const resp = await thingsCollection.insertOne(session);

  return resp;
};
