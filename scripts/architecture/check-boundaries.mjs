import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
];

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
  return roots.find(([, root]) => under(candidate, root))?.[0] ?? null;
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
  if (!policy.providerBoundary?.contractVersion) errors.push('provider contract version is required');
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
 */
export function validateReadOnlyClientSource({ sourcePath, source, policy }) {
  const boundary = policy.readOnlyClientBoundary;
  if (!boundary?.roots?.some((root) => under(posix(sourcePath), root))) return [];
  return boundary.forbiddenSymbols
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

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

export function checkRepository(root = ROOT, policy = loadPolicy()) {
  const errors = validatePolicy(policy);
  for (const definition of Object.values(policy.modules)) {
    for (const moduleRoot of definition.roots) {
      for (const absolutePath of sourceFiles(join(root, moduleRoot))) {
        const sourcePath = posix(relative(root, absolutePath));
        for (const specifier of extractImports(readFileSync(absolutePath, 'utf8'))) {
          errors.push(...validateImport({ sourcePath, specifier, policy }));
        }
      }
    }
  }
  for (const boundaryRoot of policy.readOnlyClientBoundary?.roots ?? []) {
    for (const absolutePath of sourceFiles(join(root, boundaryRoot))) {
      const sourcePath = posix(relative(root, absolutePath));
      const source = readFileSync(absolutePath, 'utf8');
      errors.push(...validateReadOnlyClientSource({ sourcePath, source, policy }));
    }
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
