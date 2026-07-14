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
  signInWithRedirect as amplifySignInWithRedirect,
  getCurrentUser as amplifyGetCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
} from "aws-amplify/auth";
import type { AuthConfig, AuthUser, SignUpAttributes } from "./types.js";

/** Split a comma/space-separated env list into a trimmed, non-empty array. */
function envList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

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
    oauthDomain:
      overrides.oauthDomain ??
      firstEnv("NEXT_PUBLIC_COGNITO_OAUTH_DOMAIN", "COGNITO_OAUTH_DOMAIN"),
    oauthRedirectSignIn:
      overrides.oauthRedirectSignIn ??
      envList(firstEnv("NEXT_PUBLIC_OAUTH_REDIRECT_SIGN_IN", "OAUTH_REDIRECT_SIGN_IN")),
    oauthRedirectSignOut:
      overrides.oauthRedirectSignOut ??
      envList(firstEnv("NEXT_PUBLIC_OAUTH_REDIRECT_SIGN_OUT", "OAUTH_REDIRECT_SIGN_OUT")),
    oauthScopes:
      overrides.oauthScopes ??
      envList(firstEnv("NEXT_PUBLIC_OAUTH_SCOPES", "OAUTH_SCOPES")),
  };
}

/** Build Amplify's `loginWith.oauth` block from config. Redirects default to the
 *  current origin (`/login` in, `/` out) so no per-site env is needed — Amplify
 *  requires these exact URLs to be registered as the client's CallbackURLs. */
function oauthConfig(config: AuthConfig) {
  if (!config.oauthDomain) return undefined;
  const origin =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const redirectSignIn =
    config.oauthRedirectSignIn ?? (origin ? [`${origin}/login`] : []);
  const redirectSignOut =
    config.oauthRedirectSignOut ?? (origin ? [`${origin}/`] : []);
  return {
    domain: config.oauthDomain,
    scopes: config.oauthScopes ?? ["openid", "email", "profile"],
    redirectSignIn,
    redirectSignOut,
    responseType: "code" as const,
    providers: ["Google" as const],
  };
}

function ensureConfigured(): AuthConfig {
  const config = resolveConfig();
  if (!applied && config.userPoolId && config.userPoolClientId) {
    const oauth = oauthConfig(config);
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.userPoolClientId,
          ...(oauth ? { loginWith: { oauth } } : {}),
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

/** Federated sign-in (Google) is wired iff a Hosted-UI domain is configured. */
export function oauthEnabled(): boolean {
  return !!resolveConfig().oauthDomain;
}

/** Redirect to Cognito's Hosted UI to sign in with Google. On return, Amplify
 *  exchanges the `?code=` for tokens automatically (no callback code needed) —
 *  the app's `getCurrentUser()` then resolves the federated session. Clears any
 *  existing session first: Amplify throws `UserAlreadyAuthenticatedException`
 *  ("There is already a signed in user") if a stale session is present, so we
 *  sign out (best-effort) the same way `signIn` does. */
export async function signInWithGoogle(): Promise<void> {
  ensureConfigured();
  try {
    await amplifySignOut();
  } catch {
    /* nothing to clear */
  }
  await amplifySignInWithRedirect({ provider: "Google" });
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
