// TODO: convert to TS and use ts-node to execute

import { getObjectId } from '~/api/utils/mongodb/objectId';

import { ObjectId } from 'mongodb';

if (process?.env) {
}

export const rickDeckard = async () => ({
  _id: await getObjectId('61fbaf25671c45f3f5f4074a'),
  ttid: 'rick.deckard',
  username: 'rick.deckard',
  password: 'password',
  randId: Math.random().toString()
});

export const getUsers = async () => {
  return [await rickDeckard()];
};
