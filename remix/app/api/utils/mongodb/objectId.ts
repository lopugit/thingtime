import { getMongoDb } from './mongodb';

export const getObjectId = async (id: any = {}) => {
  try {
    const ObjectId = (await getMongoDb()).ObjectId;

    // just add wildcard characters to the id to make it 24 characters if it isn't

    if (typeof id === 'string') {
      const filler = 'x'.repeat(24);

      const idSanitised = id?.replace(/\./g, 'x');

      if (idSanitised !== id) {
        const errMsg = `[tt] You cannot inculde dots, ID must be hexadecimal so only numbers and letters sorry! id: ${id}, sanitised: ${idSanitised} `;
        throw new Error(errMsg);
      }

      const adjustedId = (id + filler).slice(0, 24);

      console.log('nik adjustedId', adjustedId);

      return new ObjectId(adjustedId);
    }

    if (!(id instanceof ObjectId)) {
      return new ObjectId(id);
    }
  } catch (err) {
    // console.error(err);
  }

  return id;
};
