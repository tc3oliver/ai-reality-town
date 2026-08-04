/**
 * Convex identity provider configuration (audit H-1 / NFR-005).
 *
 * Declares Clerk as the JWT issuer so `ctx.auth.getUserIdentity()` is populated with a
 * Convex-verified identity, which is the credential the ART-48 operator registry's
 * identity branch matches. Until the operator sets `CLERK_JWT_ISSUER_DOMAIN` on the
 * deployment, `providers` is empty and Convex returns no identity — exactly the
 * pre-H-1 behaviour, so the shared-token bootstrap path in
 * {@link ./operations/operatorAuthorization.ts} keeps working and nothing is locked out.
 *
 * Activation runbook (see docs/agent/OPERATOR-AUTH.md):
 *   1. Create a Clerk app; copy its Frontend API URL (e.g. `https://<app>.clerk.accounts.dev`).
 *   2. In Clerk, create a JWT template named exactly `convex` (matches `applicationID`).
 *   3. Set Convex env `CLERK_JWT_ISSUER_DOMAIN=<that Frontend API URL>`.
 *   4. Set frontend `VITE_CLERK_PUBLISHABLE_KEY=<Clerk publishable key>` so
 *      `ConvexClientProvider` activates the Clerk provider.
 *   5. Add operator registry entries whose `subjects` are the Clerk `sub` claims.
 *   Once 3 lands, the token branch in `requireOperator` closes automatically.
 */

import type { AuthConfig } from 'convex/server';

const clerkDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: clerkDomain ? [{ domain: clerkDomain, applicationID: 'convex' }] : [],
} satisfies AuthConfig;
