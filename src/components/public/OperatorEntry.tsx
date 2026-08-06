import { SignInButton, UserButton } from '@clerk/clerk-react';
import { Authenticated, Unauthenticated } from 'convex/react';

import { clerkEnabled } from '../ConvexClientProvider';

/**
 * Clerk sign-in entry point for operators (ART-113 / FR-N002 AC#9, ART-105).
 *
 * ART-105 put this in `App.tsx` so an operator could sign in and read their
 * Clerk `subject` for `SIMULATION_OPS_OPERATORS`; ART-112 removed it along with
 * the interactive game route it was nested in. It comes back here, with two
 * differences:
 *
 * 1. The copy promises authentication only. Signing in grants no world-control
 *    capability -- there is none to grant on the public surface -- so the label
 *    says "operator sign-in" rather than inviting anyone to join the town.
 * 2. It renders nothing unless Clerk is actually configured. `Authenticated` /
 *    `Unauthenticated` call `useConvexAuth`, which *throws* outside a
 *    `ConvexProviderWithClerk`; without this guard every public page would
 *    crash on a deployment that has not set `VITE_CLERK_PUBLISHABLE_KEY`.
 */
export function OperatorEntry() {
  if (!clerkEnabled) return null;
  return (
    <div className="p-3 absolute top-0 right-0 z-10">
      <Authenticated>
        <UserButton afterSignOutUrl="/" />
      </Authenticated>
      <Unauthenticated>
        <SignInButton>
          <button className="public-tap text-sm underline" type="button">
            營運者登入
          </button>
        </SignInButton>
      </Unauthenticated>
    </div>
  );
}
