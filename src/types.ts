/** A resolved, signed-in principal. `isAdmin` reflects membership in the
 *  configured admin group (from the Cognito `cognito:groups` claim). */
export type AuthUser = {
  sub: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
};

/** Pool configuration. Resolved from env at import, or set via `configureAuth`. */
export type AuthConfig = {
  userPoolId?: string;
  userPoolClientId?: string;
  /** Cognito group that grants elevated access. Defaults to `"admin"`. */
  adminGroup: string;
};
