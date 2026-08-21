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
import { Hub } from "aws-amplify/utils";
import {
  configureAuth,
  getCurrentUser,
  signIn as coreSignIn,
  signInWithGoogle as coreSignInWithGoogle,
  signUp as coreSignUp,
  confirmSignUp as coreConfirmSignUp,
  resendSignUpCode as coreResendSignUpCode,
  signOut as coreSignOut,
} from "./cognito.js";
import type { AuthConfig, AuthUser, SignUpAttributes } from "./types.js";

export type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Federated sign-in via Cognito Hosted UI (Google). Navigates away to the
   *  provider; the session resolves on return. No-op unless a Hosted-UI domain
   *  is configured (`oauthEnabled()`). */
  signInWithGoogle: () => Promise<void>;
  /** Register a new account — Cognito emails a confirmation code. Optional
   *  `attributes` set Cognito standard attrs (name/phone/birthdate) at sign-up. */
  signUp: (
    email: string,
    password: string,
    attributes?: SignUpAttributes,
  ) => Promise<void>;
  /** Confirm the new account with the emailed code. */
  confirmSignUp: (email: string, code: string) => Promise<void>;
  /** Resend the sign-up confirmation code. */
  resendSignUpCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-resolve the current user. Pass `{ force: true }` to re-mint the token
   *  first, so a role or group changed since login is picked up without the user
   *  signing out and back in. */
  refresh: (opts?: { force?: boolean }) => Promise<void>;
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

  const refresh = useCallback(async (opts: { force?: boolean } = {}) => {
    setUser(await getCurrentUser(opts));
    setLoading(false);
  }, []);

  useEffect(() => {
    // Force on mount: a full page load is the one moment a user who was just
    // granted access will retry, and the cached token is exactly what would make
    // that retry fail again. The refresh is coalesced and rate-floored in the
    // core, so this costs at most one REFRESH_TOKEN_AUTH per load.
    refresh({ force: true });
    // After a Google redirect returns, Amplify exchanges the `?code=` for tokens
    // asynchronously — the mount refresh() above can run before that finishes.
    // Re-resolve the user when the exchange completes (or clear on sign-out).
    const stop = Hub.listen("auth", ({ payload }) => {
      if (
        payload.event === "signInWithRedirect" ||
        payload.event === "signedIn" ||
        payload.event === "signedOut"
      ) {
        refresh();
      }
    });
    return stop;
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await coreSignIn(email.trim().toLowerCase(), password);
      await refresh();
    },
    [refresh],
  );

  // Navigates away to the Hosted UI; the Hub listener refreshes on return.
  const signInWithGoogle = useCallback(async () => {
    await coreSignInWithGoogle();
  }, []);

  // Sign-up + confirm don't establish a session (the user signs in afterward),
  // so they don't refresh() — they just normalize the email and delegate.
  const signUp = useCallback(
    async (email: string, password: string, attributes?: SignUpAttributes) => {
      await coreSignUp(email.trim().toLowerCase(), password, attributes);
    },
    [],
  );

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    await coreConfirmSignUp(email.trim().toLowerCase(), code.trim());
  }, []);

  const resendSignUpCode = useCallback(async (email: string) => {
    await coreResendSignUpCode(email.trim().toLowerCase());
  }, []);

  const signOut = useCallback(async () => {
    await coreSignOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signInWithGoogle,
        signUp,
        confirmSignUp,
        resendSignUpCode,
        signOut,
        refresh,
      }}
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
