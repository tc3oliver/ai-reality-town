import { ReactNode } from 'react';
import { ConvexReactClient, ConvexProvider } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';

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

const convex = new ConvexReactClient(convexUrl(), { unsavedChangesWarning: false });

/**
 * The Clerk publishable key. Until the operator sets `VITE_CLERK_PUBLISHABLE_KEY`, this is
 * undefined and the bare {@link ConvexProvider} is used — public reads keep working and
 * operator auth falls back to the bootstrap token (audit H-1). Once it is set, Clerk owns
 * authentication and `ctx.auth.getUserIdentity()` is populated on the backend, which the
 * operator registry's identity branch matches.
 */
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

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
