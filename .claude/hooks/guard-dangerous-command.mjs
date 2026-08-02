// PreToolUse guard for AI Reality Town.
//
// Inspects Bash commands and blocks dangerous operations, returning a clear reason so
// Claude can choose a safe alternative. This is defense-in-depth; the same rules live in
// CLAUDE.md. Fails open (allows) on parse errors so it never breaks a session.

import { readFileSync } from 'node:fs';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  // No stdin (e.g. manual run) — nothing to guard.
  process.exit(0);
}

let input = {};
try {
  input = JSON.parse(raw);
} catch {
  // Unparseable input — fail open.
  process.exit(0);
}

if (input.tool_name !== 'Bash') {
  process.exit(0);
}

const command = String(input.tool_input?.command || '');

// Each rule: [pattern, reason]. Patterns are scoped to a single command segment
// (no crossing of ; | && so combined commands are checked piecewise below).
const RULES = [
  [/\bgit\b[^;|&]*\bpush\b[^;|&]*\bupstream\b/, 'Never push to the upstream remote. Push to origin instead.'],
  [/\bgit\b[^;|&]*\bpush\b[^;|&]*(--force\b|-f\b)/, 'Never force-push. Use a normal push or rebase onto main.'],
  [/\bgit\b[^;|&]*\breset\b[^;|&]*--hard\b[^;|&]*origin\/main\b/, 'Never hard-reset to origin/main. Reconcile changes deliberately.'],
  [/\bgh\b[^;|&]*\brepo\b[^;|&]*(\bdelete\b|\barchive\b)/, 'Never delete or archive the remote repository.'],
  [/\bgh\b[^;|&]*\brelease\b[^;|&]*\bcreate\b/, 'Do not create GitHub releases during autonomous work.'],
  [/\bnpm\b[^;|&]*\bpublish\b/, 'Never publish to the npm registry.'],
  [/\bnetworksetup\b[^;|&]*-setdnsservers\b/, 'Never change DNS settings.'],
  [/\bscutil\b[^;|&]*--(set|write)\b/, 'Never mutate system configuration via scutil.'],
  [/\bterraform\b[^;|&]*\bdestroy\b/, 'Never run terraform destroy autonomously.'],
  [/\b(serverless|sls)\b[^;|&]*\bremove\b/, 'Never remove a serverless deployment autonomously.'],
  [/\brm\s+-rf?\s+\/(?:\s|$)/, 'Never recursively delete from the filesystem root.'],
];

function findViolation(cmd) {
  // Check the whole command, and also each sub-command split on ; | && ||.
  const segments = [cmd, ...cmd.split(/(?:&&|\|\||;|\|)/)];
  for (const seg of segments) {
    for (const [pattern, reason] of RULES) {
      if (pattern.test(seg)) return reason;
    }
  }
  return null;
}

const reason = findViolation(command);
if (reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}
process.exit(0);
