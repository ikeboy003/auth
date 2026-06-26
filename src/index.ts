// Framework-agnostic entry. Import the React binding from "@ikeboy003/auth/react".
export {
  ADMIN_GROUP,
  authEnabled,
  configureAuth,
  getCurrentUser,
  getIdToken,
  signIn,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  signOut,
} from "./cognito.js";
export type { AuthConfig, AuthUser, SignUpAttributes } from "./types.js";
