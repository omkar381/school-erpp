'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrentUser, SchoolSummary } from '@erp/shared-types';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  tokens: Tokens | null;
  user: CurrentUser | null;
  school: SchoolSummary | null;
  /** Which school a super administrator is currently acting within. */
  activeSchoolId: string | null;
  /** False until the persisted state has been read back on the client. */
  hydrated: boolean;

  signIn: (payload: { tokens: Tokens; user: CurrentUser; school: SchoolSummary | null }) => void;
  markHydrated: () => void;
  setTokens: (tokens: Tokens) => void;
  setUser: (user: CurrentUser) => void;
  setSchool: (school: SchoolSummary | null) => void;
  setActiveSchool: (schoolId: string | null) => void;
  signOut: () => void;
}

/**
 * Session state, persisted so a reload does not sign the user out.
 *
 * Tokens live in localStorage rather than a cookie because the API is a
 * separate origin and authenticates with a bearer header; the tradeoff is
 * accepted deliberately, and the access token is short-lived with rotation on
 * refresh so a stolen one has a narrow window.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      tokens: null,
      user: null,
      school: null,
      activeSchoolId: null,
      hydrated: false,

      signIn: ({ tokens, user, school }) =>
        set({
          tokens,
          user,
          school,
          activeSchoolId: school?.id ?? user.schoolId ?? null,
        }),

      setTokens: (tokens) => set({ tokens }),
      setUser: (user) => set({ user }),
      setSchool: (school) => set({ school }),
      setActiveSchool: (activeSchoolId) => set({ activeSchoolId }),

      signOut: () =>
        set({ tokens: null, user: null, school: null, activeSchoolId: null }),

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'erp.session',
      partialize: (state) => ({
        tokens: state.tokens,
        user: state.user,
        school: state.school,
        activeSchoolId: state.activeSchoolId,
      }),
      // Fires whether or not anything was stored, so `hydrated` becomes true
      // even for a first-time visitor. Until then, `tokens === null` only
      // means "not read yet" and must not redirect anyone to sign in.
      onRehydrateStorage: () => (state) => state?.markHydrated(),
    },
  ),
);

// -----------------------------------------------------------------------------

/** Reads tokens outside React, for the API client. */
export function readTokens(): Tokens | null {
  return useAuthStore.getState().tokens;
}

export function readActiveSchoolId(): string | null {
  const state = useAuthStore.getState();
  // Only a super administrator needs the header; for everyone else the server
  // already knows the school from the token.
  return state.user?.isSuperAdmin ? state.activeSchoolId : null;
}

/** True when the signed-in user holds every listed permission. */
export function hasPermission(...required: string[]): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return required.every((permission) => user.permissions.includes(permission));
}

/** True when the signed-in user holds at least one of the listed permissions. */
export function hasAnyPermission(...required: string[]): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return required.some((permission) => user.permissions.includes(permission));
}
