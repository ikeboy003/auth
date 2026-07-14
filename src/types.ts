/** A resolved, signed-in principal. `isAdmin` reflects membership in the
 *  configured admin group (from the Cognito `cognito:groups` claim). */
export type AuthUser = {
  sub: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
};

/** Extra Cognito user attributes to set at registration, keyed by their Cognito
 *  attribute names and passed through verbatim — the library has no per-app
 *  opinion about which fields a sign-up collects. `phone_number` and `birthdate`
 *  are named only as common conveniences (phone is E.164 `+15551234567`,
 *  birthdate is `YYYY-MM-DD`); any other standard/custom attribute works too.
 *  email is set automatically from the username. Empty values are skipped. */
export type SignUpAttributes = {
  phone_number?: string;
  birthdate?: string;
  name?: string;
  [attribute: string]: string | undefined;
};

/** Pool configuration. Resolved from env at import, or set via `configureAuth`. */
export type AuthConfig = {
  userPoolId?: string;
  userPoolClientId?: string;
  /** Cognito group that grants elevated access. Defaults to `"admin"`. */
  adminGroup: string;
  /** Hosted-UI domain enabling federated sign-in (Google/OIDC), e.g.
   *  `"ar-web-mcp.auth.us-east-1.amazoncognito.com"`. Omit → password-only.
   *  Present → `signInWithGoogle()` and the redirect callback are wired. */
  oauthDomain?: string;
  /** Allowed post-login redirect URLs (must be registered as the app client's
   *  CallbackURLs). Amplify picks the entry whose origin matches the current
   *  page. Omit → defaults to `${location.origin}/login` at runtime. */
  oauthRedirectSignIn?: string[];
  /** Allowed post-logout redirect URLs. Omit → `${location.origin}/`. */
  oauthRedirectSignOut?: string[];
  /** OAuth scopes requested. Defaults to `["openid","email","profile"]`. */
  oauthScopes?: string[];
};
