// The browser must be asked for the same verification strength the server
// enforces. A preferred request can legally return uv=false, which the server
// then has to reject even though the authenticator completed successfully.
export const PASSKEY_USER_VERIFICATION = 'required' as const;
