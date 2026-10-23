/// <reference types="vite/client" />

declare global {
  interface Window {
    env?: Record<string, string | undefined>;
    envFromCookie?: Record<string, string | undefined>;
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
}

export {};
