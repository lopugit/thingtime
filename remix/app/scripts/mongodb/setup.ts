// TODO: convert to TS and use ts-node to execute

import { getConnectionAction } from '~/routes/api/v1/mongodb/get-connection/_get-connection';
import { getConnection } from '~/api/utils/mongodb/connection';

// import users from './data/users';
import { getCollection } from '~/api/utils/mongodb/collection';
import { getUsers } from './data/users';

// save all users to mongodb

export const saveUsers = async () => {
  // log setting up
  console.log('[tt.setup.ts] Setting up users...');

  const thingsCollection = await getCollection();

  const users = await getUsers();

  for (const user of users) {
    await thingsCollection.deleteMany({
      _id: user._id
    });
    await thingsCollection.insertOne(user);
  }
};

export const setup = async () => {
  try {
    await saveUsers();
  } catch (err) {
    return err;
  }

  return true;
};

export default setup;
