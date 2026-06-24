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
  configureAuth,
  getCurrentUser,
  signIn as coreSignIn,
  signOut as coreSignOut,
} from "./cognito.js";
import type { AuthConfig, AuthUser } from "./types.js";

export type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({
  children,
  config,
}: {
  children: ReactNode;
  /**
   * Pool config, applied once before the first session lookup. Pass this in
   * bundled apps (Next/Vite): the env auto-read uses `process.env[name]`
   * dynamically, which bundlers can't statically inline — so in the browser the
   * package would otherwise see no config. Supply the values from your app's own
   * (statically inlined) env here.
   */
  config?: Partial<AuthConfig>;
}) {
  // Runs once, during the first render, before the mount effect calls refresh().
  useState(() => (config ? configureAuth(config) : undefined));
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
