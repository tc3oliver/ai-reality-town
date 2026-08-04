# Operator Authentication Setup (audit H-1)

The administrative boundary (the simulation console: pause/resume, emergency stop, canon
correction, audit review) authenticates operators through the ART-48 registry in
`convex/operations/operatorAuthorization.ts`. Until a real identity provider is configured,
the registry's **shared-token** branch is the only working credential — and because that
token travels in a mutation argument it is likely written to the Convex function log (the
finding the ART-62 audit records as **H-1**).

This document is the activation runbook for retiring that token by configuring **Clerk** as
the Convex identity provider. Public reads are unaffected: viewers never log in. Only the
operator (and, later, voting viewers — FR-J001 / ART-45) authenticate.

## What ships in the repository

- `convex/auth.config.ts` — declares Clerk as the JWT issuer **only when
  `CLERK_JWT_ISSUER_DOMAIN` is set**. With it unset, `providers` is empty and `ctx.auth`
  stays null, exactly as before.
- `src/components/ConvexClientProvider.tsx` — uses `ClerkProvider` **only when
  `VITE_CLERK_PUBLISHABLE_KEY` is set**; otherwise the bare `ConvexProvider` (today's
  behaviour).
- `convex/operations/opsConsoleFunctions.ts` `requireOperator` — the shared-token branch
  closes automatically once `CLERK_JWT_ISSUER_DOMAIN` is set, unless an operator
  explicitly sets `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK=1` as an escape hatch.

So nothing changes until you set the env vars below; you cannot lock yourself out by
merely deploying this code.

## Activation steps

### 1. Create the Clerk app
Create an application at clerk.com. Copy two values from its dashboard:
- **Frontend API URL** — looks like `https://<your-app>.clerk.accounts.dev` (or your custom
  domain). This is the **JWT issuer domain**.
- **Publishable key** — looks like `pk_live_…` (or `pk_test_…`).

### 2. Create a JWT template named `convex`
In Clerk → **JWT Templates** → New → name it **exactly `convex`** (this matches
`applicationID: "convex"` in `auth.config.ts`). No claims customization is required.

### 3. Set the backend env
```bash
npx convex env --prod set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env --dev  set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
```
The moment this lands, the shared-token branch in `requireOperator` closes — verified
identity becomes the only way into the console. (Set `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK=1`
first only if you need the token during the transition.)

### 4. Set the frontend env
In `.env.local` (and your hosting provider):
```
VITE_CLERK_PUBLISHABLE_KEY=pk_…
```
`ConvexClientProvider` will now mount `ClerkProvider` and send verified tokens.

### 5. Register operators by Clerk subject
The registry lives in the `SIMULATION_OPS_OPERATORS` deployment env (JSON). After step 3,
entries authenticate by their Clerk `sub` claim. Add your Clerk user(s):
```bash
npx convex env --prod set SIMULATION_OPS_OPERATORS '[{"operatorId":"ops-admin","role":"admin","subjects":["https://<your-app>.clerk.accounts.dev|user_<clerk-user-id>"]}]'
```
The `subjects` value is the full identity `subject` Convex reports — the easiest way to
learn yours is to call `describeOperatorSession` (or `ctx.auth.getUserIdentity()` in a
scratch query) once signed in, then copy that `subject` verbatim into the entry. `token`
fields can be removed once identity is working.

## Verifying it took effect
1. Sign in via the frontend; `describeOperatorSession` returns a principal with
   `source: "identity"`.
2. A privileged call without a signed-in identity is rejected with `OPS_UNAUTHORIZED` even
   if the old token is supplied — confirming the token branch is closed.
