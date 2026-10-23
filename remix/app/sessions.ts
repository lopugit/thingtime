type SessionData = {
  userId: string;
};

type SessionFlashData = {
  error: string;
};

const getSession = async () => new Map<keyof (SessionData & SessionFlashData), string>();
const commitSession = async () => '';
const destroySession = async () => '';

export { getSession, commitSession, destroySession };
