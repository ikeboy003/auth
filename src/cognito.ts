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

/** LOCAL sign-out — clears the Cognito token store and reloads to the site root.
 *
 *  Deliberately does NOT call Amplify's `signOut()`: with `loginWith.oauth`
 *  configured it force-redirects to the Cognito Hosted-UI `/logout` page (the
 *  "ugly" screen) and then to the FIRST registered logout URL — i.e. off your
 *  own site. Clearing the `CognitoIdentityServiceProvider.*` keys (Amplify's
 *  default localStorage token store) signs the user out locally; the hard reload
 *  to `/` drops Amplify's in-memory token cache too, so the app comes back
 *  signed-out ON THE CURRENT SITE. The Cognito/Google IdP session cookie is left
 *  intact — fine for staff; a shared-device "full" logout isn't needed here. */
export async function signOut() {
  ensureConfigured();
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const store = window.localStorage;
    const del: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith("CognitoIdentityServiceProvider.")) del.push(k);
    }
    del.forEach((k) => store.removeItem(k));
  } catch {
    /* storage blocked — fall through to reload anyway */
  }
  // Reload to the site's own root: clears in-memory tokens, stays on this site.
  window.location.replace("/");
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

/** The signed-in user (sub + email + Cognito groups), or null.
 *
 *  Reads identity from the ID token claims — NOT the Cognito `GetUser` API.
 *  `GetUser` (what `fetchUserAttributes` calls) requires the access token to
 *  carry the `aws.cognito.signin.user.admin` scope, which the Hosted-UI / OAuth
 *  flow (Google federation) does NOT grant — so `fetchUserAttributes` 400s
 *  ("Access Token does not have required scopes") for every federated user,
 *  making them look signed-out. The ID token already holds sub/email/groups for
 *  both password and federated sign-ins, so we decode it and skip the call. */
export async function getCurrentUser(
  opts: { force?: boolean } = {},
): Promise<AuthUser | null> {
  const config = ensureConfigured();
  if (!config.userPoolId || !config.userPoolClientId) return null;
  try {
    if (opts.force) await refreshSession();
    const session = await fetchAuthSession();
    const claims = session.tokens?.idToken?.payload;
    if (!claims) return null; // no valid session
    const rawGroups = claims["cognito:groups"];
    const groups = Array.isArray(rawGroups) ? (rawGroups as string[]) : [];
    return {
      sub: typeof claims.sub === "string" ? claims.sub : "",
      email: typeof claims.email === "string" ? claims.email : "",
      groups,
      isAdmin: groups.includes(config.adminGroup),
    };
  } catch {
    return null;
  }
}

/** The Cognito ID token (JWT) — send as the Bearer so postgREST RLS applies.
 *
 *  `force` re-mints the token from the refresh token instead of returning the
 *  cached one. See `refreshSession` for why that is the ONLY way an authorization
 *  change reaches a signed-in browser. */
export async function getIdToken(
  opts: { force?: boolean } = {},
): Promise<string | null> {
  ensureConfigured();
  if (opts.force) return refreshSession();
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

// ── Re-minting the session ───────────────────────────────────────────────────
//
// WHY THIS EXISTS. Cognito stamps a user's attributes and groups INTO the ID
// token at issuance. An operator who promotes someone — a `custom:role` write, a
// group add — changes the user record, not the token already sitting in that
// person's browser. Amplify serves the cached token out of localStorage until it
// expires (an hour by default), so the promoted user keeps presenting the claims
// they had at login and the API keeps refusing them. Reloading the page does
// NOTHING: the reload re-reads the same cached token. Signing out and back in
// works only because it mints a new one, which is why the symptom reads as "you
// have to log in again to get your permissions."
//
// THE FIX IS A REFRESH, NOT A RE-LOGIN. `forceRefresh` runs REFRESH_TOKEN_AUTH,
// and Cognito builds those fresh tokens from the user's CURRENT attributes and
// groups. So the new claims arrive without touching the user's credentials.
//
// COALESCED ON PURPOSE. A page that fires a dozen queries at once will see a
// dozen refusals at once. Each one asking for its own refresh would send a dozen
// REFRESH_TOKEN_AUTH calls for one stale token, so concurrent callers share the
// in-flight promise, and a short floor keeps a retry loop from hammering Cognito
// when the refusal is genuine rather than stale.

let inflightRefresh: Promise<string | null> | null = null;
let lastRefreshAt = 0;
const REFRESH_MIN_INTERVAL_MS = 10_000;

/** Mint a NEW ID token from the refresh token, picking up any attribute/group
 *  change made since login. Concurrent calls share one refresh; calls inside the
 *  cooldown return the current cached token instead of re-hitting Cognito.
 *  Returns null when there is no session to refresh. */
export async function refreshSession(): Promise<string | null> {
  ensureConfigured();
  if (inflightRefresh) return inflightRefresh;

  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return getIdToken();
  lastRefreshAt = now;

  inflightRefresh = (async () => {
    try {
      const session = await fetchAuthSession({ forceRefresh: true });
      return session.tokens?.idToken?.toString() ?? null;
    } catch {
      // Refresh token expired or revoked — the caller's existing token is the
      // best available answer, and the next 401 sends them to /login.
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}
