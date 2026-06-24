// Headless Cognito (Amplify v6) session core. Framework-agnostic — no React,
// no routing, no brand logic. Configure-at-import: if the pool ids are present
// in the environment it just works; otherwise call `configureAuth({...})` once
// before use. Pairs with any postgREST client via `getIdToken` (Bearer → RLS).

import { Amplify } from "aws-amplify";
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  getCurrentUser as amplifyGetCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
} from "aws-amplify/auth";
import type { AuthConfig, AuthUser } from "./types.js";

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
