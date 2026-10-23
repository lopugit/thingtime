import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export const hashPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
