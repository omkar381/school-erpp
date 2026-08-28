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

/**
 * Uploads a file as multipart/form-data.
 *
 * The shared client always sends JSON, so a file upload goes through `fetch`
 * directly — deliberately without a Content-Type header, so the browser sets
 * the multipart boundary itself.
 */
export async function uploadFile<T>(path: string, file: File, fieldName = 'file'): Promise<T> {
  const form = new FormData();
  form.append(fieldName, file);

  const tokens = readTokens();
  const schoolId = readActiveSchoolId();

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...(schoolId ? { 'X-School-Id': schoolId } : {}),
    },
    body: form,
  });

  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; message: string; code?: string }
    | null;

  if (!response.ok || !payload || payload.success === false) {
    throw new ApiClientError(response.status, {
      message:
        payload && payload.success === false
          ? payload.message
          : `Upload failed with status ${response.status}`,
      code: payload && payload.success === false ? payload.code : undefined,
    });
  }

  return payload.data;
}

/** Turns any thrown value into a sentence worth showing a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
