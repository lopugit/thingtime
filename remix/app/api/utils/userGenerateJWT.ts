// query mongodb for user objects with the username provided
// if user exists, return true
// if user does not exist, return false

export const userGenerateJWT = async ({ username, password }) => {
  const uuid = Math.random().toString(36).substring(7);

  const jwt = {};
};
