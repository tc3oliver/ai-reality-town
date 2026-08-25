import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_PATH = join(ROOT, 'architecture/module-boundaries.json');
const REQUIRED_MODULES = [
  'canon', 'simulation', 'knowledge', 'story', 'editorial', 'publicRead',
  'viewer', 'operations', 'safety', 'observability', 'shared',
  // Visual modules (ART-110 / ART-114). `visualRuntime` is required so the
  // Canon-free movement runtime cannot quietly be folded back into a module
  // that is allowed to reach the Canon write surface.
  'visual', 'visualRuntime',
  // Client modules (ART-113 / FR-N002). Listed as required so the read-only
  // public surface cannot be dissolved back into an undeclared blob.
  'clientPublic', 'clientWorldReadOnly',
  // ART-128 / FR-O009. `clientShell` owns the rest of `src` so the app shell, the
  // entry point and the shared buttons are inside the read-only boundary too, and
  // `clientProvider` isolates the one file that may construct a Convex client.
  'clientShell', 'clientProvider',
  // ART-118 / FR-O001. `clientLive` owns the live map page and its camera chrome --
  // the one client module that carries click handlers -- so "no camera operation can
  // write" is a boundary the build checks rather than a review convention.
  // `clientLiveRoute` is the pure URL module both it and the public pages link
  // through, kept dependency-free so neither has to depend on the other.
  'clientLive', 'clientLiveRoute',
];

/** Convex registration helpers that publish a function to unauthenticated clients. */
const CLIENT_REACHABLE_REGISTRATIONS = ['httpAction', 'query', 'mutation', 'action'];
const PUBLIC_FUNCTION_KINDS = ['query', 'mutation', 'action'];
/**
 * `viewer` (ART-45 / FR-J001) is the third gate, and the only one that admits an anonymous
 * write. It exists because PRD 1.0 §5.1 G11 requires a daily viewer ballot while PRD 2.0 §22.16
 * requires that public **viewing** never mutates — two statements that are only compatible if
 * "viewing never writes" is proven per surface instead of by a repo-wide ban on anonymous
 * mutations. Every extra rule in {@link validateViewerWriteBoundary} exists to keep the gate
 * from becoming a general-purpose hole; see `docs/daily-environment-vote.md` §2.
 */
const PUBLIC_FUNCTION_GATES = ['anonymous', 'operator', 'viewer'];

export function loadPolicy(path = POLICY_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function posix(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function under(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function withoutExtension(path) {
  return path.replace(/\.tsx?$/, '');
}

export function moduleForPath(path, policy) {
  const candidate = posix(path);
  const roots = Object.entries(policy.modules)
    .flatMap(([name, value]) => value.roots.map((root) => [name, root]))
    .sort((a, b) => b[1].length - a[1].length);
  // A root may name a single file, and a relative import usually omits the extension,
  // so a file root is also matched extension-free.
  return roots.find(([, root]) => under(candidate, root) || withoutExtension(root) === withoutExtension(candidate))?.[0] ?? null;
}

export function validatePolicy(policy) {
  const errors = [];
  if (!Number.isInteger(policy.version) || policy.version < 1) errors.push('policy version must be a positive integer');
  for (const name of REQUIRED_MODULES) {
    if (!policy.modules?.[name]) errors.push(`required module is missing: ${name}`);
  }
  for (const [name, definition] of Object.entries(policy.modules ?? {})) {
    if (!Array.isArray(definition.roots) || definition.roots.length === 0) errors.push(`${name} must declare at least one root`);
    for (const dependency of definition.mayDependOn ?? []) {
      if (!policy.modules[dependency]) errors.push(`${name} references unknown dependency ${dependency}`);
      if (dependency === name) errors.push(`${name} must not list itself as a dependency`);
    }
  }
  const readOnly = policy.readOnlyClientBoundary;
  if (!Array.isArray(readOnly?.roots) || readOnly.roots.length === 0) {
    errors.push('read-only client boundary must declare at least one root');
  }
  if (!Array.isArray(readOnly?.forbiddenSymbols) || readOnly.forbiddenSymbols.length === 0) {
    errors.push('read-only client boundary must declare at least one forbidden symbol');
  }
  for (const root of readOnly?.roots ?? []) {
    // A root nobody owns could not be checked for illegal imports, so the
    // read-only guarantee would only be half enforced.
    if (!moduleForPath(root, policy)) errors.push(`read-only client root ${root} belongs to no module`);
  }
  const canonWrite = policy.canonWriteBoundary;
  if (!Array.isArray(canonWrite?.writePaths) || canonWrite.writePaths.length === 0) {
    errors.push('canon write boundary must declare at least one write path');
  }
  if (!Array.isArray(canonWrite?.forbiddenModules) || canonWrite.forbiddenModules.length === 0) {
    errors.push('canon write boundary must declare at least one forbidden module');
  }
  if (!Array.isArray(canonWrite?.forbiddenSymbols) || canonWrite.forbiddenSymbols.length === 0) {
    errors.push('canon write boundary must declare at least one forbidden symbol');
  }
  for (const writePath of canonWrite?.writePaths ?? []) {
    // A write path nobody owns could never be matched against an import, so the
    // rule would silently pass while the file stayed reachable.
    if (!moduleForPath(writePath, policy)) errors.push(`canon write path ${writePath} belongs to no module`);
    if (!existsSync(join(ROOT, writePath))) errors.push(`canon write path ${writePath} does not exist`);
  }
  for (const name of canonWrite?.forbiddenModules ?? []) {
    if (!policy.modules?.[name]) errors.push(`canon write boundary references unknown module ${name}`);
  }
  const surface = policy.publicFunctionSurface;
  if (!Array.isArray(surface?.scanRoots) || surface.scanRoots.length === 0) {
    errors.push('public function surface must declare at least one scan root');
  }
  if (!Array.isArray(surface?.forbiddenRegistrations)) {
    errors.push('public function surface must declare forbiddenRegistrations');
  }
  if (!Array.isArray(surface?.allowed) || surface.allowed.length === 0) {
    errors.push('public function surface must declare at least one allowed function');
  }
  const declared = new Set();
  for (const entry of surface?.allowed ?? []) {
    const key = `${entry.path}:${entry.name}`;
    if (declared.has(key)) errors.push(`public function surface declares ${key} twice`);
    declared.add(key);
    if (!existsSync(join(ROOT, entry.path))) errors.push(`public function ${key} does not exist`);
    if (!moduleForPath(entry.path, policy)) errors.push(`public function path ${entry.path} belongs to no module`);
    if (!PUBLIC_FUNCTION_KINDS.includes(entry.kind)) errors.push(`public function ${key} has unknown kind ${entry.kind}`);
    if (!PUBLIC_FUNCTION_GATES.includes(entry.gate)) errors.push(`public function ${key} has unknown gate ${entry.gate}`);
    // PRD 2.0 §22.16 sets successful mutations from public VIEWING to exactly zero, so a
    // public mutation may exist only as an operator control -- or, since ART-45, as the one
    // declared viewer ballot, which is not viewing and which carries its own stricter rules.
    // The `viewer` gate is deliberately NOT sufficient on its own: it must ALSO be declared in
    // `viewerWriteBoundary.allowed`, so opening a viewer write takes two edits in two places
    // rather than one word in one.
    if (entry.kind !== 'query' && entry.gate === 'anonymous') {
      errors.push(`public ${entry.kind} ${key} must be operator-gated`);
    }
    if (entry.gate === 'viewer' && !viewerWriteDeclares(policy, entry)) {
      errors.push(`viewer-gated ${entry.kind} ${key} is not declared in viewerWriteBoundary.allowed`);
    }
  }
  errors.push(...validateViewerWritePolicy(policy));
  if (!policy.providerBoundary?.contractVersion) errors.push('provider contract version is required');
  return errors;
}

const viewerWriteDeclares = (policy, entry) =>
  (policy.viewerWriteBoundary?.allowed ?? []).some(
    (allowed) => allowed.path === entry.path && allowed.name === entry.name,
  );

/**
 * Structural rules on the viewer write gate (ART-45 / FR-J001).
 *
 * Checked at POLICY level, before a single file is read, because every one of these is a rule
 * about what the policy is allowed to say. The gate's whole justification is that it is one
 * declared, capped, safety-bound channel; a policy that could quietly declare a second one, or
 * put one outside `convex/viewer`, would have the same words and none of the meaning.
 */
export function validateViewerWritePolicy(policy) {
  const boundary = policy.viewerWriteBoundary;
  const gated = (policy.publicFunctionSurface?.allowed ?? []).filter((entry) => entry.gate === 'viewer');
  if (!boundary) {
    return gated.length > 0 ? ['viewer-gated functions are declared but viewerWriteBoundary is missing'] : [];
  }
  const errors = [];
  if (!Array.isArray(boundary.roots) || boundary.roots.length === 0) {
    errors.push('viewer write boundary must declare at least one root');
  }
  if (!Array.isArray(boundary.requiredSymbols) || boundary.requiredSymbols.length === 0) {
    errors.push('viewer write boundary must require at least one safety symbol');
  }
  if (!Array.isArray(boundary.forbiddenSymbols) || boundary.forbiddenSymbols.length === 0) {
    errors.push('viewer write boundary must forbid at least one Canon-write symbol');
  }
  if (!Number.isInteger(boundary.maxViewerMutations) || boundary.maxViewerMutations < 0) {
    errors.push('viewer write boundary must cap viewer mutations with a non-negative integer');
  }
  for (const entry of boundary.allowed ?? []) {
    if (!existsSync(join(ROOT, entry.path))) errors.push(`viewer write ${entry.path}:${entry.name} does not exist`);
    // A viewer write outside `convex/viewer` would sit in a module that is allowed to reach
    // Canon, the read model or the simulation, and the forbidden-symbol sweep below only
    // covers the declared roots.
    if (!boundary.roots?.some((root) => under(posix(entry.path), root))) {
      errors.push(`viewer write ${entry.path}:${entry.name} must live under a viewerWriteBoundary root`);
    }
    if (!gated.some((allowed) => allowed.path === entry.path && allowed.name === entry.name)) {
      errors.push(`viewer write ${entry.path}:${entry.name} is not declared as a viewer-gated public function`);
    }
  }
  const mutations = gated.filter((entry) => entry.kind === 'mutation');
  if (mutations.length > (boundary.maxViewerMutations ?? 0)) {
    errors.push(
      `${mutations.length} viewer-gated mutations are declared; the boundary caps them at ${boundary.maxViewerMutations}`,
    );
  }
  for (const entry of gated) {
    if (entry.kind === 'action') errors.push(`viewer-gated ${entry.path}:${entry.name} may not be an action`);
  }
  // The client half of the same argument. `ConvexClientProvider` is exempted for CONSTRUCTION
  // (`ConvexReactClient`) and stays as unable to write as everything else; an exemption for a
  // symbol that actually issues a write may only be granted inside the declared vote root, so
  // `/live`, the world surface and every public page remain provably write-free by the same
  // check that always covered them.
  const writeSymbols = ['useMutation', 'useAction', 'useConvex'];
  for (const exempt of policy.readOnlyClientBoundary?.exemptFiles ?? []) {
    const granted = (exempt.symbols ?? []).filter((symbol) => writeSymbols.includes(symbol));
    if (granted.length === 0) continue;
    if (!boundary.clientRoots?.some((root) => under(posix(exempt.path), root))) {
      errors.push(
        `${exempt.path}: '${granted.join("', '")}' may only be exempted under a viewerWriteBoundary clientRoot`,
      );
    }
  }
  return errors;
}

/**
 * Source rules on the viewer write module (ART-45 / FR-J001).
 *
 * Two sweeps over `convex/viewer`, and they say opposite things on purpose:
 *
 * - **`requiredSymbols` must appear.** A viewer write that never names the FR-L003 classifier or
 *   the rate limiter is not a viewer write this policy sanctioned — it is an unguarded one. This
 *   is the only rule in the file that fails on ABSENCE, because "we forgot the abuse control" is
 *   exactly the failure a symbol denylist cannot see.
 * - **`forbiddenSymbols` must not.** The module handling untrusted viewer input may not name a
 *   Canon writer or a replay entry point, so 「觀眾只能提案」 is a build failure rather than a
 *   review note. The module is already forbidden from IMPORTING `canon` by the dependency graph;
 *   this catches the other spelling, where it grows its own.
 */
export function validateViewerWriteSources(root = ROOT, policy = loadPolicy()) {
  const boundary = policy.viewerWriteBoundary;
  if (!boundary?.roots) return [];
  const errors = [];
  const sources = new Map();
  for (const moduleRoot of boundary.roots) {
    for (const absolutePath of sourceFiles(join(root, moduleRoot))) {
      sources.set(posix(relative(root, absolutePath)), readFileSync(absolutePath, 'utf8'));
    }
  }
  const names = (symbol) => new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  for (const [sourcePath, source] of sources) {
    for (const symbol of boundary.forbiddenSymbols ?? []) {
      if (names(symbol).test(source)) {
        errors.push(`${sourcePath}: the viewer write module may not reference Canon-write symbol '${symbol}'`);
      }
    }
  }
  // Required symbols are checked across the module rather than per file: the classifier belongs
  // in the decision layer and the handler belongs in the adapter, and forcing both names into
  // one file would buy a passing check by making the code worse.
  for (const symbol of boundary.requiredSymbols ?? []) {
    if (![...sources.values()].some((source) => names(symbol).test(source))) {
      errors.push(`no file under the viewer write boundary references required safety symbol '${symbol}'`);
    }
  }
  return errors;
}

export function extractImports(source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) imports.push(match[1] ?? match[2]);
  return imports;
}

function resolveRelativeImport(sourcePath, specifier) {
  const base = posix(normalize(join(dirname(sourcePath), specifier)));
  return extname(base) ? base.replace(/\.(?:js|mjs|cjs)$/, '.ts') : base;
}

export function validateImport({ sourcePath, specifier, policy }) {
  const sourceModule = moduleForPath(sourcePath, policy);
  if (!sourceModule) return [];
  const errors = [];
  const adapter = policy.providerBoundary.adapterRoots.some((root) => under(posix(sourcePath), root));
  if (!specifier.startsWith('.') && policy.providerBoundary.providerPackagePatterns.some((value) => new RegExp(value).test(specifier)) && !adapter) {
    errors.push(`${sourcePath}: provider package '${specifier}' is only allowed inside an adapter root`);
  }
  if (!specifier.startsWith('.')) return errors;
  const targetPath = resolveRelativeImport(posix(sourcePath), specifier);
  const targetModule = moduleForPath(targetPath, policy);
  if (policy.providerBoundary.adapterRoots.some((root) => under(targetPath, root)) && !adapter) {
    errors.push(`${sourcePath}: provider adapters may only be imported from within an adapter root`);
  }
  const canonWrite = policy.canonWriteBoundary;
  if (canonWrite?.forbiddenModules.includes(sourceModule)) {
    // A relative specifier usually omits its extension, so both sides are compared
    // extension-free rather than requiring the policy to list every spelling.
    const writePath = canonWrite.writePaths.find((path) => withoutExtension(path) === withoutExtension(targetPath));
    if (writePath) {
      errors.push(`${sourcePath}: ${sourceModule} may not import Canon write path ${writePath} (${specifier})`);
    }
  }
  if (!targetModule || targetModule === sourceModule) return errors;
  if (!policy.modules[sourceModule].mayDependOn.includes(targetModule)) {
    errors.push(`${sourcePath}: ${sourceModule} may not depend on ${targetModule} (${specifier})`);
  }
  return errors;
}

/**
 * Read-only client surface check (ART-113 / FR-N002 AC#6, AC#7).
 *
 * Import direction alone cannot express "this component may not write to the
 * world": the mutation entry points live in `convex/react`, the same package
 * the read-only surface legitimately imports `useQuery` from. So the boundary
 * is stated at the symbol level instead -- if a file under a read-only root
 * so much as names a write API, the build fails and the reviewer has to move
 * the code outside the boundary or change the policy on purpose.
 *
 * ART-128 (FR-O009) widened the root from the two component directories to the whole of
 * `src`. Scoping the rule to the pages a visitor is shown proved the wrong thing: the app
 * shell, the client provider and the shared buttons were all unpoliced, so a write could
 * be added to the shipped bundle without tripping the rule that exists to forbid it.
 * `excludeRoots` drops the dev-only level editor, a separate Vite root that is not part
 * of the shipped app.
 *
 * An `exemptFiles` entry exempts the symbols it names and nothing else: the client
 * provider legitimately CONSTRUCTS a Convex client, but it must stay as unable to issue a
 * write as every other file, so `useMutation`/`useAction` remain denied there.
 */
export function validateReadOnlyClientSource({ sourcePath, source, policy }) {
  const boundary = policy.readOnlyClientBoundary;
  const candidate = posix(sourcePath);
  if (!boundary?.roots?.some((root) => under(candidate, root))) return [];
  if (boundary.excludeRoots?.some((root) => under(candidate, root))) return [];
  const exempt = boundary.exemptFiles?.find((entry) => entry.path === candidate)?.symbols ?? [];
  return boundary.forbiddenSymbols
    .filter((symbol) => !exempt.includes(symbol))
    .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(source))
    .map((symbol) => `${sourcePath}: read-only client surface may not reference world-write API '${symbol}'`);
}

/**
 * Canon write boundary check (ART-114 / FR-N010 AC#3, AC#7).
 *
 * The same argument as the read-only client surface, one layer deeper. Import
 * direction stops a module *importing* the Canon writers, but a module could
 * still grow its own `internalMutation` writing straight into `canonEvents`,
 * or be handed a `ctx` and patch a document. Naming any of those symbols inside
 * a forbidden module's roots fails the build, so the Visual Runtime cannot
 * acquire a write path without someone editing this policy on purpose.
 */
export function validateCanonWriteBoundarySource({ sourcePath, source, policy }) {
  const boundary = policy.canonWriteBoundary;
  if (!boundary) return [];
  const roots = boundary.forbiddenModules.flatMap((name) => policy.modules[name]?.roots ?? []);
  if (!roots.some((root) => under(posix(sourcePath), root))) return [];
  return boundary.forbiddenSymbols
    .filter((symbol) => new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(source))
    .map((symbol) => `${sourcePath}: module is outside the Canon write boundary and may not reference '${symbol}'`);
}

/**
 * Find every Convex registration that is reachable by an unauthenticated client.
 *
 * `internalQuery`/`internalMutation`/`internalAction` are deliberately NOT matched:
 * the bare helpers are exactly the ones Convex publishes to the client. Matching is
 * anchored on the assignment (`= query(`) rather than on `export`, because a
 * registration reaches the client through whatever name the module exports it under
 * -- `const init = mutation({...}); export default init;` is just as public as
 * `export const init = mutation({...})`, and the first spelling is how a public
 * mutation survived unnoticed until FR-O009.
 */
export function extractClientReachableRegistrations(source) {
  const kinds = CLIENT_REACHABLE_REGISTRATIONS.join('|');
  const found = [];
  for (const match of source.matchAll(
    new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(${kinds})\s*\(`, 'g'),
  )) {
    found.push({ name: match[1], kind: match[2] });
  }
  for (const match of source.matchAll(new RegExp(String.raw`export\s+default\s+(${kinds})\s*\(`, 'g'))) {
    found.push({ name: 'default', kind: match[1] });
  }
  return found;
}

/**
 * Public function surface check (ART-128 / FR-O009 AC#1, AC#6).
 *
 * PRD 2.0 §18.1 sets successful public mutations to exactly zero, which is a claim
 * about the WHOLE client-reachable surface, not about the pages a visitor happens to
 * be shown. Neither the import-direction rules nor the read-only client boundary can
 * make that claim: both reason about who calls what, while an anonymous caller holding
 * the deployment URL never goes through the client at all. So the surface is enumerated
 * from source and diffed against an explicit allowlist in BOTH directions -- an
 * undeclared registration fails the build, and so does a declaration whose function has
 * been deleted, which is what keeps the allowlist from decaying into fiction.
 */
export function validatePublicFunctionSurface(root = ROOT, policy = loadPolicy()) {
  const surface = policy.publicFunctionSurface;
  if (!surface?.allowed) return ['public function surface policy is missing'];
  const errors = [];
  const forbidden = new Set(surface.forbiddenRegistrations ?? []);
  const allowed = new Map(surface.allowed.map((entry) => [`${entry.path}:${entry.name}`, entry]));
  const seen = new Set();
  for (const scanRoot of surface.scanRoots ?? []) {
    for (const absolutePath of sourceFiles(join(root, scanRoot))) {
      const sourcePath = posix(relative(root, absolutePath));
      if (sourcePath.includes('/_generated/')) continue;
      const source = readFileSync(absolutePath, 'utf8');
      for (const registration of extractClientReachableRegistrations(source)) {
        const key = `${sourcePath}:${registration.name}`;
        if (forbidden.has(registration.kind)) {
          errors.push(`${sourcePath}: '${registration.name}' registers a forbidden ${registration.kind}`);
          continue;
        }
        const entry = allowed.get(key);
        if (!entry) {
          errors.push(`${sourcePath}: client-reachable ${registration.kind} '${registration.name}' is not declared in publicFunctionSurface`);
          continue;
        }
        seen.add(key);
        if (entry.kind !== registration.kind) {
          errors.push(`${sourcePath}: '${registration.name}' is declared as a ${entry.kind} but registers a ${registration.kind}`);
        }
      }
    }
  }
  for (const [key, entry] of allowed) {
    if (!seen.has(key)) errors.push(`publicFunctionSurface declares ${entry.kind} ${key}, which no longer exists`);
  }
  return errors;
}

// Every extension Convex's bundler accepts as a function entry point. A narrower list
// would let a registration in, say, a `.cts` file deploy without ever being scanned.
// The `.test.` exclusion matches Convex, which skips multi-dot basenames entirely.
/**
 * The blunt half of the `httpAction` ban (ART-128 / FR-O009).
 *
 * {@link extractClientReachableRegistrations} anchors on an assignment, which misses the
 * spelling Convex's own docs use -- `http.route({ handler: httpAction(...) })` binds the
 * action to no name at all, so a re-introduced unauthenticated webhook in the idiomatic
 * form would pass the allowlist diff untouched. Policy already says the deployment routes
 * zero HTTP endpoints, so nothing here needs parsing: naming `httpAction` under a scanned
 * root IS the violation. Kept deliberately separate from the extraction regex so the two
 * checks cannot share a blind spot.
 */
export function usesHttpAction(source) {
  return /\bhttpAction\s*\(/.test(source);
}

export function validateForbiddenHttpActions(root = ROOT, policy = loadPolicy()) {
  const surface = policy.publicFunctionSurface;
  if (!surface?.forbiddenRegistrations?.includes('httpAction')) return [];
  const errors = [];
  for (const scanRoot of surface.scanRoots ?? []) {
    for (const absolutePath of sourceFiles(join(root, scanRoot))) {
      const sourcePath = posix(relative(root, absolutePath));
      if (sourcePath.includes('/_generated/')) continue;
      if (usesHttpAction(readFileSync(absolutePath, 'utf8'))) {
        errors.push(`${sourcePath}: 'httpAction' is forbidden anywhere under a scanned root; the deployment routes zero public HTTP endpoints`);
      }
    }
  }
  return errors;
}

const isSourceFile = (name) => /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/.test(name) && !/\.test\./.test(name);

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  // A module root may name a single file rather than a directory -- `clientProvider`
  // is exactly one file, and widening it to a directory would hand every sibling the
  // right to construct a Convex client.
  if (!statSync(dir).isDirectory()) return isSourceFile(dir) ? [dir] : [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return isSourceFile(entry.name) ? [path] : [];
  });
}

export function checkRepository(root = ROOT, policy = loadPolicy()) {
  const errors = validatePolicy(policy);
  // Roots nest -- `clientShell` owns `src`, `clientPublic` owns a directory inside it --
  // so files are collected into a set first and each is checked once. `moduleForPath`
  // resolves the most specific owner either way; without the set the shared files would
  // simply report every error twice.
  const filesUnder = (roots) =>
    new Set((roots ?? []).flatMap((moduleRoot) => sourceFiles(join(root, moduleRoot))));
  for (const absolutePath of filesUnder(Object.values(policy.modules).flatMap((d) => d.roots))) {
    const sourcePath = posix(relative(root, absolutePath));
    for (const specifier of extractImports(readFileSync(absolutePath, 'utf8'))) {
      errors.push(...validateImport({ sourcePath, specifier, policy }));
    }
  }
  for (const absolutePath of filesUnder(policy.readOnlyClientBoundary?.roots)) {
    const sourcePath = posix(relative(root, absolutePath));
    const source = readFileSync(absolutePath, 'utf8');
    errors.push(...validateReadOnlyClientSource({ sourcePath, source, policy }));
  }
  for (const name of policy.canonWriteBoundary?.forbiddenModules ?? []) {
    for (const moduleRoot of policy.modules[name]?.roots ?? []) {
      for (const absolutePath of sourceFiles(join(root, moduleRoot))) {
        const sourcePath = posix(relative(root, absolutePath));
        const source = readFileSync(absolutePath, 'utf8');
        errors.push(...validateCanonWriteBoundarySource({ sourcePath, source, policy }));
      }
    }
  }
  errors.push(...validatePublicFunctionSurface(root, policy));
  errors.push(...validateForbiddenHttpActions(root, policy));
  errors.push(...validateViewerWriteSources(root, policy));
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkRepository();
  if (errors.length) {
    console.error(errors.map((error) => `BOUNDARY ERROR: ${error}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Architecture boundaries valid (policy v${loadPolicy().version}, ${REQUIRED_MODULES.length} modules).`);
  }
}
