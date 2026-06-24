"use client";

// Optional React binding: an <AuthProvider> that resolves the current user on
// mount and a useAuth() hook exposing { user, loading, signIn, signOut, refresh }.
// The core (./cognito) has no React dependency; this file is only loaded when you
// import "@ikeboy003/auth/react".

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getCurrentUser,
  signIn as coreSignIn,
  signOut as coreSignOut,
} from "./cognito.js";
import type { AuthUser } from "./types.js";

export type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setUser(await getCurrentUser());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await coreSignIn(email.trim().toLowerCase(), password);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await coreSignOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
