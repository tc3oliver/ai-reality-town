import { ReactNode } from 'react';
import { ConvexReactClient, ConvexProvider } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';

import {
  createFixtureConvexClient,
  e2eFixtureEnabled,
  installRecorder,
} from '../e2e/fixtureConvexClient';

/**
 * Determines the Convex deployment to use.
 *
 * We perform load balancing on the frontend, by randomly selecting one of the available instances.
 * We use localStorage so that individual users stay on the same instance.
 */
function convexUrl(): string {
  const url = import.meta.env.VITE_CONVEX_URL as string;
  if (!url) {
    throw new Error('Couldn’t find the Convex deployment URL.');
  }
  return url;
}

/**
 * The E2E fixture transport (FR-Q006 / ART-137), or the real deployment.
 *
 * Only the TRANSPORT is swapped. Every component, hook, view model and renderer in an E2E run is
 * the shipped one — which is the entire point of browser evidence, and why the branch is here
 * rather than inside any component.
 *
 * `import.meta.env.VITE_E2E_FIXTURE` is replaced by Vite at build time, so an ordinary build
 * evaluates this to `false` as a literal and the fixture modules are tree-shaken out of the
 * bundle entirely. `e2eFixtureBuild.test.ts` asserts that: a production bundle containing the
 * fixture would be a far worse defect than any it was written to catch.
 */
const convex = e2eFixtureEnabled()
  ? (createFixtureConvexClient(installRecorder()) as unknown as ConvexReactClient)
  : new ConvexReactClient(convexUrl(), { unsavedChangesWarning: false });

/**
 * The Clerk publishable key. Until the operator sets `VITE_CLERK_PUBLISHABLE_KEY`, this is
 * undefined and the bare {@link ConvexProvider} is used — public reads keep working and
 * operator auth falls back to the bootstrap token (audit H-1). Once it is set, Clerk owns
 * authentication and `ctx.auth.getUserIdentity()` is populated on the backend, which the
 * operator registry's identity branch matches.
 */
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/**
 * Whether Clerk owns authentication in this deployment. Components that use
 * `Authenticated`/`Unauthenticated` (or any Clerk component) must check this
 * first: those helpers call `useConvexAuth`, which throws when the tree is
 * wrapped in the bare {@link ConvexProvider} fallback below.
 */
export const clerkEnabled = Boolean(clerkPublishableKey);

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!clerkPublishableKey) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
