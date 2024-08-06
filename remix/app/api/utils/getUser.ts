// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

import { getCollection } from './mongodb/collection';

export const getUser = async (username) => {
  const thingsCollection = await getCollection();

  const resp = await thingsCollection.findOne({
    username: username
  });

  return resp;
};
