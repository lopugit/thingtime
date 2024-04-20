export const action = async ({ request }) => {
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: 'Hello, World!'
    },
    cache: {
      revalidate: 60
    }
  };
};
