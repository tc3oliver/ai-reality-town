// AI Reality Town — bootstrap verification.
//
// Runs the bootstrap checks. Prints `PASS|WARN|FAIL <check>: <detail>`. Exits non-zero
// if any FAIL is present. Never hardcodes success. WARN does not fail but explains itself.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = process.cwd();
const results = [];
const fail = (name, detail) => results.push(['FAIL', name, detail]);
const warn = (name, detail) => results.push(['WARN', name, detail]);
const pass = (name, detail) => results.push(['PASS', name, detail || '']);

function repositoryFiles(dir = ROOT) {
  const files = [];
  const skipped = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipped.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...repositoryFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function repositoryDirectories(dir = ROOT) {
  const directories = [];
  const skipped = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || skipped.has(entry.name)) continue;
    const full = join(dir, entry.name);
    directories.push(full, ...repositoryDirectories(full));
  }
  return directories;
}

function parseCodexConfig(text) {
  const values = new Map();
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match || values.has(match[1])) throw new Error(`invalid or duplicate assignment: ${sourceLine}`);
    const [, key, raw] = match;
    if (/^\d+$/.test(raw)) values.set(key, Number(raw));
    else {
      const items = /^\[(.*)\]$/.exec(raw)?.[1].trim();
      if (items === undefined) throw new Error(`unsupported TOML value: ${sourceLine}`);
      if (!items) values.set(key, []);
      else {
        const strings = items.split(',').map((item) => /^"([^"\\]*)"$/.exec(item.trim())?.[1]);
        if (strings.some((item) => item === undefined)) throw new Error(`invalid string array: ${sourceLine}`);
        values.set(key, strings);
      }
    }
  }
  return values;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trimEnd();
  } catch {
    return null;
  }
}

function backlogBin() {
  const name = process.platform === 'win32' ? 'backlog.cmd' : 'backlog';
  return join(ROOT, 'node_modules', '.bin', name);
}

function runBacklog(args) {
  const bin = backlogBin();
  if (!existsSync(bin)) return { ok: false, stdout: '', stderr: 'backlog binary missing' };
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// --- run checks ---

// 1. inside a git repo
const rev = git(['rev-parse', '--is-inside-work-tree']);
rev === 'true' ? pass('git-repo', 'inside a git work tree') : fail('git-repo', 'not inside a git repository');

// 2. origin exists
const remotes = (git(['remote']) || '').split('\n').filter(Boolean);
remotes.includes('origin') ? pass('origin-exists', 'origin remote present') : fail('origin-exists', 'no origin remote');

// 3. upstream exists (local-only config; absent in fresh clones/CI -> WARN with guidance)
const upstreamUrl = (git(['remote', 'get-url', 'upstream']) || '').toLowerCase();
if (upstreamUrl) {
  pass('upstream-exists', 'upstream remote present');
} else {
  warn(
    'upstream-exists',
    'upstream remote not configured in this checkout (it is local-only config); add it with: git remote add upstream https://github.com/a16z-infra/ai-town.git',
  );
}

// 4. upstream points to AI Town (FAIL only if present and wrong; WARN if absent)
if (!upstreamUrl) {
  warn('upstream-ai-town', 'cannot verify (upstream remote not configured in this checkout)');
} else if (/a16z-infra\/ai-town(\.git)?/.test(upstreamUrl)) {
  pass('upstream-ai-town', upstreamUrl);
} else {
  fail('upstream-ai-town', `upstream does not point to AI Town: ${upstreamUrl}`);
}

// 5. not a GitHub fork (network); WARN if cannot verify
try {
  const out = execFileSync('gh', ['repo', 'view', '--json', 'isFork'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  const isFork = /\bisFork"\s*:\s*true/.test(out);
  isFork ? fail('not-a-fork', 'repository is a GitHub fork') : pass('not-a-fork', 'repository is not a fork');
} catch {
  warn('not-a-fork', 'could not verify fork status (gh/offline)');
}

// 6. backlog.md is a dev dependency
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const hasBacklogDep = Boolean((pkg.devDependencies || {})['backlog.md'] || (pkg.dependencies || {})['backlog.md']);
hasBacklogDep ? pass('backlog-dependency', `backlog.md@${(pkg.devDependencies || {})['backlog.md']}`) : fail('backlog-dependency', 'backlog.md not in dependencies');

// 7. local backlog binary is executable
const r7 = runBacklog(['--version']);
r7.ok ? pass('backlog-binary', r7.stdout.trim() || 'ok') : fail('backlog-binary', r7.stderr || 'cannot run backlog');

// 8. backlog initialized
existsSync(join(ROOT, 'backlog', 'config.yml'))
  ? pass('backlog-initialized', 'backlog/config.yml present')
  : fail('backlog-initialized', 'backlog/config.yml missing');

// 9. backlog instructions overview readable
const r9 = runBacklog(['instructions', 'overview']);
r9.ok && r9.stdout.trim().length > 0
  ? pass('backlog-instructions', `${r9.stdout.trim().split('\n').length} lines`)
  : fail('backlog-instructions', 'cannot read instructions overview');

// 10. root CLAUDE.md exists
existsSync(join(ROOT, 'CLAUDE.md')) ? pass('claude-md', 'present') : fail('claude-md', 'CLAUDE.md missing');

// 11. CLAUDE.md contains Mandatory Session Startup
/## .*Mandatory Session Startup/.test(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'))
  ? pass('claude-md-startup', 'mandatory session startup section present')
  : fail('claude-md-startup', 'mandatory session startup section missing');

// 12. Codex loads the shared repository instructions and has no competing control plane
const codexConfigPath = join(ROOT, '.codex', 'config.toml');
let codexConfig;
if (!existsSync(codexConfigPath)) {
  fail('codex-config-exists', '.codex/config.toml missing');
} else {
  pass('codex-config-exists', '.codex/config.toml present');
  try {
    codexConfig = parseCodexConfig(readFileSync(codexConfigPath, 'utf8'));
    pass('codex-config-toml', 'valid TOML for supported project settings');
  } catch (error) {
    fail('codex-config-toml', error.message);
  }
}
codexConfig?.get('project_doc_fallback_filenames')?.includes('CLAUDE.md')
  ? pass('codex-fallback-claude-md', 'project_doc_fallback_filenames includes CLAUDE.md')
  : fail('codex-fallback-claude-md', 'project_doc_fallback_filenames must include CLAUDE.md');

const repoFiles = repositoryFiles();
const agentInstructionFiles = repoFiles.filter((file) => ['AGENTS.md', 'AGENTS.override.md'].includes(basename(file)));
agentInstructionFiles.length === 0
  ? pass('no-agents-md', 'no AGENTS.md or AGENTS.override.md present')
  : fail('no-agents-md', agentInstructionFiles.map((file) => relative(ROOT, file)).join(', '));

const codexSkills = repositoryDirectories().filter((dir) => /(^|\/)\.agents\/skills(?:\/|$)/.test(relative(ROOT, dir)));
codexSkills.length === 0
  ? pass('no-codex-skills', 'no .agents/skills content present')
  : fail('no-codex-skills', codexSkills.map((dir) => relative(ROOT, dir)).join(', '));

const claudeText = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
const startupCommands = [
  'npm run agent:check',
  'npm run backlog -- instructions overview',
  'npm run backlog -- task list --json',
  'git status --short',
  'git branch --show-current',
  'git log -5 --oneline',
];
const missingStartupCommands = startupCommands.filter((command) => !claudeText.includes(command));
missingStartupCommands.length === 0
  ? pass('claude-mandatory-startup', 'all six mandatory startup commands present')
  : fail('claude-mandatory-startup', `missing: ${missingStartupCommands.join(', ')}`);

const claudeOnlyRequirements = [/Claude must/i, /Claude Code session must/i, /invoke `?\/(?:bootstrap-autonomy|prd-to-backlog|autonomous-task-loop|human-blocker)/i];
const claudeOnlyHit = claudeOnlyRequirements.find((pattern) => pattern.test(claudeText));
claudeOnlyHit
  ? fail('claude-agent-neutral', `requires Claude-only capability: ${claudeOnlyHit}`)
  : pass('claude-agent-neutral', 'does not require Claude-only capabilities');

const taskSourceDeclarations = repoFiles
  .filter((file) => /\.(?:md|txt)$/i.test(file))
  .filter((file) => /(?:sole|single|only) task source of truth/i.test(readFileSync(file, 'utf8')))
  .map((file) => relative(ROOT, file));
taskSourceDeclarations.every((file) => file === 'CLAUDE.md' || file.startsWith('backlog/tasks/'))
  ? pass('sole-task-source', 'Backlog.md remains the sole declared task source of truth')
  : fail('sole-task-source', `competing declarations: ${taskSourceDeclarations.join(', ')}`);

const codexWorkflowDocs = repoFiles
  .map((file) => relative(ROOT, file))
  .filter((file) => /(?:^|\/)(?:codex)[^/]*(?:workflow|task|blocker|recovery)|(?:workflow|task|blocker|recovery)[^/]*codex/i.test(file));
codexWorkflowDocs.length === 0
  ? pass('no-codex-workflow-docs', 'no duplicated Codex workflow documentation present')
  : fail('no-codex-workflow-docs', codexWorkflowDocs.join(', '));

const codexSpecificRulePatterns = [
  /^#{1,6} .*Codex.*(?:Workflow|Human Blocker|Session Recovery|Task Loop)/im,
  /Codex(?:-specific)?\s+(?:task source|human blocker|session recovery|task loop)/i,
];
const codexSpecificRules = repoFiles
  .filter((file) => /\.(?:md|txt)$/i.test(file) && !relative(ROOT, file).startsWith('backlog/tasks/'))
  .filter((file) => codexSpecificRulePatterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))))
  .map((file) => relative(ROOT, file));
codexSpecificRules.length === 0
  ? pass('no-codex-specific-rules', 'no Codex-specific task, blocker, recovery, or loop rules present')
  : fail('no-codex-specific-rules', codexSpecificRules.join(', '));

// 13. four Claude Code convenience skills exist
const skills = ['bootstrap-autonomy', 'prd-to-backlog', 'autonomous-task-loop', 'human-blocker'];
const missingSkills = skills.filter((s) => !existsSync(join(ROOT, '.claude', 'skills', s, 'SKILL.md')));
missingSkills.length === 0 ? pass('skills-exist', `${skills.length} skills`) : fail('skills-exist', `missing: ${missingSkills.join(', ')}`);

// 14. all SKILL.md have valid frontmatter (name + description)
const fmIssues = [];
for (const s of skills) {
  const text = readFileSync(join(ROOT, '.claude', 'skills', s, 'SKILL.md'), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) { fmIssues.push(`${s}: no frontmatter`); continue; }
  const fm = m[1];
  if (!/^name:\s*.+/m.test(fm)) fmIssues.push(`${s}: missing name`);
  if (!/^description:\s*.+/m.test(fm)) fmIssues.push(`${s}: missing description`);
}
fmIssues.length === 0 ? pass('skills-frontmatter', 'all have name + description') : fail('skills-frontmatter', fmIssues.join('; '));

const nonThinSkills = skills.filter((s) => {
  const text = readFileSync(join(ROOT, '.claude', 'skills', s, 'SKILL.md'), 'utf8');
  return !text.includes('convenience entry only') || !text.includes('defines no separate workflow') || text.split('\n').length > 12;
});
nonThinSkills.length === 0
  ? pass('skills-thin-entry', 'Claude Code skills only point to shared workflow documents')
  : fail('skills-thin-entry', `skills contain duplicated workflow rules: ${nonThinSkills.join(', ')}`);

const platformSpecificAgentDocs = docsWithPlatformRequirements();
platformSpecificAgentDocs.length === 0
  ? pass('agent-docs-neutral', 'shared workflow docs do not require platform-specific skills')
  : fail('agent-docs-neutral', platformSpecificAgentDocs.join(', '));

// 14. .claude/settings.json is valid JSON
let settingsValid = false;
try {
  JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
  settingsValid = true;
} catch (e) {
  fail('settings-json', `invalid JSON: ${e.message}`);
}
if (settingsValid) pass('settings-json', 'valid JSON');

// 15. SessionStart hook file exists
existsSync(join(ROOT, '.claude', 'hooks', 'session-context.mjs'))
  ? pass('sessionstart-hook', 'present')
  : fail('sessionstart-hook', '.claude/hooks/session-context.mjs missing');

// 16. safety hook file exists
existsSync(join(ROOT, '.claude', 'hooks', 'guard-dangerous-command.mjs'))
  ? pass('safety-hook', 'present')
  : fail('safety-hook', '.claude/hooks/guard-dangerous-command.mjs missing');

// 17. hook scripts are syntactically runnable by current node
for (const h of ['session-context.mjs', 'guard-dangerous-command.mjs']) {
  const f = join(ROOT, '.claude', 'hooks', h);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail('hook-runnable', `${h}: ${r.stderr || 'syntax check failed'}`);
}
// also check the agent scripts
for (const s of ['check-bootstrap.mjs', 'session-context.mjs']) {
  const f = join(ROOT, 'scripts', 'agent', s);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail('hook-runnable', `${s}: ${r.stderr || 'syntax check failed'}`);
}
results.some((r) => r[0] === 'PASS' && r[1] === 'sessionstart-hook')
  ? pass('hook-runnable', 'hook + agent scripts pass node --check')
  : null;

// 18. autonomous development docs exist
const docs = ['AUTONOMOUS-DEVELOPMENT.md', 'HUMAN-BLOCKERS.md', 'SESSION-RECOVERY.md', 'BACKLOG-WORKFLOW.md'];
const missingDocs = docs.filter((d) => !existsSync(join(ROOT, 'docs', 'agent', d)));
missingDocs.length === 0 ? pass('agent-docs', `${docs.length} docs`) : fail('agent-docs', `missing: ${missingDocs.join(', ')}`);

// 19. bootstrap status doc exists
existsSync(join(ROOT, 'docs', 'agent', 'BOOTSTRAP-STATUS.md'))
  ? pass('bootstrap-status-doc', 'present')
  : fail('bootstrap-status-doc', 'docs/agent/BOOTSTRAP-STATUS.md missing');

// 20. no product milestone or product task created
const milestonesDir = join(ROOT, 'backlog', 'milestones');
let milestoneCount = 0;
if (existsSync(milestonesDir)) milestoneCount = readdirSync(milestonesDir).filter((f) => f.endsWith('.md')).length;
const activeProductTasks = backlogTaskFiles().filter((t) => !['chore', 'docs'].includes(t.type) && t.status !== 'Done');
milestoneCount === 0 && activeProductTasks.length === 0
  ? pass('no-product-tasks', `milestones=${milestoneCount}, active product tasks=${activeProductTasks.length}`)
  : fail('no-product-tasks', `milestones=${milestoneCount}, active product tasks=${activeProductTasks.length}`);

// 21. no real secret committed (offline scan of tracked text files)
const secretPattern = /(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const secretHits = scanTrackedForSecrets(secretPattern);
secretHits.length === 0 ? pass('no-secrets', 'no secret patterns in tracked files') : fail('no-secrets', secretHits.slice(0, 3).join('; '));

// 22. working tree state readable
const st = git(['status', '--porcelain']);
st !== null ? pass('working-tree', `${st ? st.split('\n').filter(Boolean).length : 0} changed`) : fail('working-tree', 'cannot read git status');

// --- report ---
for (const [level, name, detail] of results) {
  const tag = detail ? `: ${detail}` : '';
  console.log(`${level} ${name}${tag}`);
}
const failed = results.filter((r) => r[0] === 'FAIL').length;
const warned = results.filter((r) => r[0] === 'WARN').length;
console.log(`\nSummary: ${results.length} checks — ${failed} FAIL, ${warned} WARN`);
process.exit(failed > 0 ? 1 : 0);

// --- helpers used above ---

function backlogTaskFiles() {
  const dir = join(ROOT, 'backlog', 'tasks');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const id = (/^id:\s*(.+)$/m.exec(text) || [])[1]?.trim();
    const status = (/^status:\s*(.+)$/m.exec(text) || [])[1]?.trim();
    const type = (/^type:\s*(.+)$/m.exec(text) || [])[1]?.trim().toLowerCase();
    if (id) out.push({ id, status: status || 'To Do', type: type || 'task', name });
  }
  return out;
}

function scanTrackedForSecrets(pattern) {
  const list = git(['ls-files']);
  if (!list) return [];
  const hits = [];
  const skip = /(^|\/)(node_modules|dist|coverage|\.next|build)\/|^package-lock\.json$|\.map$/;
  for (const rel of list.split('\n').filter(Boolean)) {
    if (skip.test(rel)) continue;
    const full = join(ROOT, rel);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isFile() || st.size > 256 * 1024) continue;
    const text = readFileSync(full, 'utf8');
    if (pattern.test(text)) hits.push(rel);
  }
  return hits;
}

function docsWithPlatformRequirements() {
  const dir = join(ROOT, 'docs', 'agent');
  if (!existsSync(dir)) return [];
  const platformRequirement = /Claude Code session|Claude must|invoke `?\/(?:bootstrap-autonomy|prd-to-backlog|autonomous-task-loop|human-blocker)/i;
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => platformRequirement.test(readFileSync(join(dir, name), 'utf8')));
}
