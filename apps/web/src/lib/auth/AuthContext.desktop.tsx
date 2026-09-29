import type { ReactNode } from 'react';
import type { AuthState as BrowserAuthState } from './AuthContext';

export type { AuthState, AuthUser } from './AuthContext';

const unavailable = async () => null;
const state: BrowserAuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  signIn: unavailable,
  signInWithGoogle: unavailable,
  signInWithEmail: unavailable,
  signOut: async () => undefined,
  clearError: () => undefined,
  getToken: unavailable,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const GoogleAuthProvider = AuthProvider;

export function useAuth(): BrowserAuthState {
  return state;
}
