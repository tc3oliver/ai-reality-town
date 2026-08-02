// SessionStart hook for AI Reality Town.
// Thin wrapper around the shared context renderer (scripts/agent/session-context.mjs).
// Read-only: never modifies the repository. Prints a short context block.

import { renderContext } from '../../scripts/agent/session-context.mjs';

try {
  process.stdout.write(renderContext() + '\n');
} catch (err) {
  // Never break the session on a diagnostic failure.
  process.stdout.write(`AI Reality Town: session-context hook failed: ${err?.message || err}\n`);
}
process.exit(0);
