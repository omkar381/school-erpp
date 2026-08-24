'use client';

import { ApiClient, ApiClientError } from '@erp/api-client';
import { readActiveSchoolId, readTokens, useAuthStore } from './auth-store';

export { ApiClientError };

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * The one API client the app uses.
 *
 * It reads tokens from the auth store rather than holding its own copy, so a
 * sign-out anywhere immediately stops authenticating requests, and a refresh
 * writes the rotated pair straight back into the store.
 */
export const api = new ApiClient({
  baseUrl: BASE_URL,
  getTokens: readTokens,
  getSchoolId: readActiveSchoolId,
  onTokensRefreshed: (tokens) => useAuthStore.getState().setTokens(tokens),
  onAuthFailure: () => {
    useAuthStore.getState().signOut();
    // A full document navigation, not a router push: the session is gone, so
    // the React tree, the query cache and any in-flight request should go with
    // it. A soft navigation would keep all three alive holding dead data.
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  },
});

/** Turns any thrown value into a sentence worth showing a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
