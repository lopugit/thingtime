export const getMongoDb = async () => {
  // @ts-expect-error
  return await import('mongodb').then((mod) => mod);
};
