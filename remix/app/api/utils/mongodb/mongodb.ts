export const getMongoDb = async () => {
  return await import('mongodb').then((mod) => mod);
};
