// Headless Cognito (Amplify v6) session core. Framework-agnostic — no React,
// no routing, no brand logic. Configure-at-import: if the pool ids are present
// in the environment it just works; otherwise call `configureAuth({...})` once
// before use. Pairs with any postgREST client via `getIdToken` (Bearer → RLS).

import { Amplify } from "aws-amplify";
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendSignUpCode,
  signOut as amplifySignOut,
  getCurrentUser as amplifyGetCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
} from "aws-amplify/auth";
import type { AuthConfig, AuthUser, SignUpAttributes } from "./types.js";

function readEnv(name: string): string | undefined {
  // Guarded — `process` may be undefined in some browser bundles.
  return typeof process !== "undefined" && process.env
    ? process.env[name]
    : undefined;
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

let overrides: Partial<AuthConfig> = {};
let applied = false;

/** Override (or supply) the pool config explicitly. Useful outside Next, or
 *  when the env isn't inlined. Re-applies on the next auth call. */
export function configureAuth(config: Partial<AuthConfig>): void {
  overrides = { ...overrides, ...config };
  applied = false;
}

function resolveConfig(): AuthConfig {
  return {
    userPoolId:
      overrides.userPoolId ??
      firstEnv(
        "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
        "VITE_COGNITO_USER_POOL_ID",
        "COGNITO_USER_POOL_ID",
      ),
    userPoolClientId:
      overrides.userPoolClientId ??
      firstEnv(
        "NEXT_PUBLIC_COGNITO_CLIENT_ID",
        "VITE_COGNITO_CLIENT_ID",
        "COGNITO_CLIENT_ID",
      ),
    adminGroup:
      overrides.adminGroup ??
      firstEnv("NEXT_PUBLIC_AUTH_ADMIN_GROUP", "AUTH_ADMIN_GROUP") ??
      "admin",
  };
}

function ensureConfigured(): AuthConfig {
  const config = resolveConfig();
  if (!applied && config.userPoolId && config.userPoolClientId) {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.userPoolClientId,
        },
      },
    });
    applied = true;
  }
  return config;
}

/** Cognito is configured iff the pool ids resolved (apps work without it). */
export function authEnabled(): boolean {
  const config = resolveConfig();
  return !!config.userPoolId && !!config.userPoolClientId;
}

/** The configured admin group name (snapshot; `getCurrentUser` reads it live). */
export const ADMIN_GROUP = resolveConfig().adminGroup;

/** Sign in (clears any stale session first), USER_AUTH / password challenge. */
export async function signIn(email: string, password: string) {
  ensureConfigured();
  try {
    await amplifySignOut();
  } catch {
    /* nothing to clear */
  }
  return amplifySignIn({
    username: email,
    password,
    options: { authFlowType: "USER_AUTH", preferredChallenge: "PASSWORD" },
  });
}

export async function signOut() {
  ensureConfigured();
  return amplifySignOut();
}

/** Register a new user. Cognito emails a confirmation code; the account stays
 *  unconfirmed until `confirmSignUp`. The email is the username (these pools are
 *  email sign-in) and is also stored as the `email` attribute for delivery. */
export async function signUp(
  email: string,
  password: string,
  attributes: SignUpAttributes = {},
) {
  ensureConfigured();
  // Attributes are passed through verbatim as Cognito user attributes — the
  // caller supplies the standard names its pool uses (e.g. `phone_number`,
  // `birthdate`). The library holds no per-app opinion about which fields a
  // sign-up collects. email is always set as the username + email attribute;
  // empty values are skipped so we never write blank attrs.
  const userAttributes: Record<string, string> = { email };
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null || value === "") continue;
    userAttributes[name] = value;
  }
  return amplifySignUp({ username: email, password, options: { userAttributes } });
}

/** Confirm a freshly-registered account with the code Cognito emailed. After
 *  this resolves the account is active and `signIn` will succeed. */
export async function confirmSignUp(email: string, code: string) {
  ensureConfigured();
  return amplifyConfirmSignUp({ username: email, confirmationCode: code });
}

/** Resend the sign-up confirmation code (e.g. it expired or never arrived). */
export async function resendSignUpCode(email: string) {
  ensureConfigured();
  return amplifyResendSignUpCode({ username: email });
}

/** The signed-in user (sub + email + Cognito groups), or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const config = ensureConfigured();
  if (!config.userPoolId || !config.userPoolClientId) return null;
  try {
    await amplifyGetCurrentUser();
    const attrs = await fetchUserAttributes();
    let groups: string[] = [];
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      if (idToken) {
        const payload = JSON.parse(atob(idToken.split(".")[1] ?? "")) as {
          "cognito:groups"?: string[];
        };
        groups = payload["cognito:groups"] ?? [];
      }
    } catch {
      /* no session / no groups claim */
    }
    return {
      sub: attrs.sub ?? "",
      email: attrs.email ?? "",
      groups,
      isAdmin: groups.includes(config.adminGroup),
    };
  } catch {
    return null;
  }
}

/** The Cognito ID token (JWT) — send as the Bearer so postgREST RLS applies. */
export async function getIdToken(): Promise<string | null> {
  ensureConfigured();
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}
