// Seed users — plain { username, password, email } that get created through the
// REAL register API (see FUNDAMENTALS.md §2), so a seeded user is identical to a
// real signup: same hashing, validation, schema, and verification flow.
// Passwords are intentionally plaintext here; registerUser hashes them.

export type SeedUser = {
  username: string;
  password: string;
  email: string;
  displayName?: string;
};

export const getUsers = async (): Promise<SeedUser[]> => [
  { username: 'rick.deckard', password: 'password', email: 'rick.deckard@thingtime.com', displayName: 'Rick Deckard' },
  { username: 'rachael', password: 'password', email: 'rachael@thingtime.com', displayName: 'Rachael' }
];
