// Built-in first-party sign-in authorities, shared by client selection and
// build-time CSP. A client-side hub override never grants network permission.
export const SSO_HUB_PRODUCTION = 'https://thingtime.com';
export const SSO_HUB_DEVELOP = 'https://dev.thingtime.com';
export const FIRST_PARTY_SSO_HUB_ORIGINS = Object.freeze([SSO_HUB_PRODUCTION, SSO_HUB_DEVELOP]);
