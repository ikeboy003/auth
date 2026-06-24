// Framework-agnostic entry. Import the React binding from "@ikeboy003/auth/react".
export {
  ADMIN_GROUP,
  authEnabled,
  configureAuth,
  getCurrentUser,
  getIdToken,
  signIn,
  signOut,
} from "./cognito.js";
export type { AuthConfig, AuthUser } from "./types.js";
