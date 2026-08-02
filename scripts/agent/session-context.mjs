// AI Reality Town — session context renderer.
//
// Read-only. No network, no API key, no jq, no mutations. Produces a short (<= ~40 line)
// context block for SessionStart and for `npm run agent:context`. Works even if Backlog.md
// is not installed (degrades to a diagnostic).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trimEnd();
  } catch {
    return '';
  }
}

function readFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function backlogTasks() {
  const dir = join(ROOT, 'backlog', 'tasks');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const text = readFile(join(dir, name));
    const id = /^id:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const title = /^title:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const status = /^status:\s*(.+)$/m.exec(text)?.[1]?.trim();
    if (id) out.push({ id, title: title ?? id, status: status ?? 'To Do', name });
  }
  return out;
}

function isBootstrapComplete() {
  const must = [
    'CLAUDE.md',
    '.claude/settings.json',
    '.claude/hooks/session-context.mjs',
    '.claude/hooks/guard-dangerous-command.mjs',
    'scripts/agent/check-bootstrap.mjs',
    'scripts/agent/session-context.mjs',
    'backlog/config.yml',
    'docs/agent/AUTONOMOUS-DEVELOPMENT.md',
    'docs/agent/HUMAN-BLOCKERS.md',
    'docs/agent/SESSION-RECOVERY.md',
    'docs/agent/BACKLOG-WORKFLOW.md',
    'docs/agent/BOOTSTRAP-STATUS.md',
    '.claude/skills/bootstrap-autonomy/SKILL.md',
    '.claude/skills/prd-to-backlog/SKILL.md',
    '.claude/skills/autonomous-task-loop/SKILL.md',
    '.claude/skills/human-blocker/SKILL.md',
  ];
  return must.every((p) => existsSync(join(ROOT, p)));
}

function packageBacklogVersion() {
  const pkg = JSON.parse(readFile(join(ROOT, 'package.json')) || '{}');
  return pkg.devDependencies?.['backlog.md'] || pkg.dependencies?.['backlog.md'] || '';
}

export function renderContext() {
  const branch = git(['branch', '--show-current']) || '(unknown)';
  const status = git(['status', '--porcelain']);
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const log = git(['log', '--oneline', '-5'])
    .split('\n')
    .filter(Boolean)
    .map((l) => `  ${l}`);

  const backlogVersion = packageBacklogVersion();
  const initialized = existsSync(join(ROOT, 'backlog', 'config.yml'));
  const tasks = backlogTasks();
  const inProgress = tasks.find((t) => t.status === 'In Progress');
  const ready = tasks.filter((t) => t.status === 'To Do').length;
  const bootstrapComplete = isBootstrapComplete();
  const prdPresent = existsSync(join(ROOT, 'docs', 'product', 'PRD.md'));

  const lines = [];
  lines.push('AI Reality Town session context');
  lines.push(`Bootstrap: ${bootstrapComplete ? 'complete' : 'INCOMPLETE'}`);
  lines.push(`Branch: ${branch}`);
  lines.push(`Working tree: ${changed === 0 ? 'clean' : `${changed} changed`}`);
  lines.push(
    `Backlog: ${backlogVersion ? `installed (${backlogVersion})` : 'MISSING'}; initialized: ${initialized ? 'yes' : 'no'}`,
  );
  lines.push(`In Progress: ${inProgress ? `${inProgress.id} ${inProgress.title}` : 'none'}`);
  lines.push(`Ready tasks: ${ready}`);
  if (log.length) {
    lines.push('Last commits:');
    lines.push(...log);
  }
  lines.push('Next:');
  lines.push('  npm run agent:check');
  lines.push('  npm run backlog -- instructions overview');
  lines.push('  npm run backlog -- task list --json');

  if (!bootstrapComplete) {
    lines.push('BOOTSTRAP INCOMPLETE: invoke /bootstrap-autonomy before product work.');
  } else if (inProgress) {
    lines.push(`RESUME TASK: ${inProgress.id} ${inProgress.title}`);
  } else if (!prdPresent) {
    lines.push('PRD REQUIRED: do not invent product requirements.');
  } else if (tasks.length === 0) {
    lines.push('PRD INGESTION REQUIRED: invoke /prd-to-backlog.');
  } else {
    lines.push('READY: select next task via /autonomous-task-loop.');
  }
  return lines.join('\n');
}

// When run directly (node scripts/agent/session-context.mjs), print the context.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  process.stdout.write(renderContext() + '\n');
}
