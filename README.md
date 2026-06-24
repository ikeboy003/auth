# @ikeboy003/auth

Headless Cognito auth/session primitive. Framework-agnostic core + optional React
binding. **Drop-in**: when the pool env vars are set, you wire nothing.

No brand, routing, or UI logic baked in — it gives you a session and a token; the
app decides where to send people and how to render.

## Install

```sh
npm i @ikeboy003/auth aws-amplify
```

`aws-amplify` and `react` are peers. React is optional (only needed for `/react`).

## Configure

Zero-config when any of these env pairs are present (checked in order):

- `NEXT_PUBLIC_COGNITO_USER_POOL_ID` / `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID`
- `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID`

Admin group defaults to `admin` (override with `NEXT_PUBLIC_AUTH_ADMIN_GROUP`).

Or configure explicitly (non-Next apps, or when env isn't inlined):

```ts
import { configureAuth } from "@ikeboy003/auth";
configureAuth({ userPoolId: "...", userPoolClientId: "...", adminGroup: "admin" });
```

## Core (no React)

```ts
import {
  authEnabled, signIn, signOut, getCurrentUser, getIdToken,
} from "@ikeboy003/auth";

const user = await getCurrentUser(); // { sub, email, groups, isAdmin } | null
const token = await getIdToken();    // Cognito ID JWT — send as Bearer for RLS
```

Pair `getIdToken` with any postgREST client so row-level security applies:

```ts
import { createClient } from "@ikeboy003/cloudrest-client";
export const db = createClient({ baseUrl, getToken: getIdToken });
```

## React

```tsx
// Wrap once, at the root.
import { AuthProvider } from "@ikeboy003/auth/react";
<AuthProvider>{children}</AuthProvider>;

// Anywhere below it.
import { useAuth } from "@ikeboy003/auth/react";
const { user, loading, signIn, signOut } = useAuth();
```

## License

MIT
