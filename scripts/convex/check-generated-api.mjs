/**
 * Keep `convex/_generated/api.d.ts` equal to the Convex modules actually in the tree (ART-153).
 *
 * ## The drift, and why nothing caught it
 *
 * The checked-in file was last generated on 2026-08-10. By ART-153 it was missing **34** modules
 * and still declared **one that had been deleted** (`simulation/queries`). Nothing broke, and that
 * is precisely the problem: the architecture gate does not read it, and every function reference in
 * this repository resolves by string path through `internalFunctionRef` / `publicFunctionRef`
 * rather than through the generated `api` object. So the file is checked in, is trusted by anyone
 * reading it, and has no consumer that would fail when it is wrong.
 *
 * ## Why this reimplements the module list instead of running `convex codegen`
 *
 * AC#3 requires the check to run without a Convex deployment or network access. `npx convex
 * codegen` does not: it downloads the current deployment state and uploads functions to compute
 * types, which needs a credential and a live deployment. That is fine for a developer with one and
 * unusable as a gate.
 *
 * So the enumeration is reimplemented — narrowly, and from the CLI's own rules rather than from a
 * guess. `entryPoints()` in `node_modules/convex/dist/cli.bundle.cjs` skips, in this order: files
 * whose extension is not a JS/TS one, anything under `_generated/`, dotfiles, emacs `#` tempfiles,
 * ANY file named `schema.ts`/`schema.js` at any depth, any basename containing more than one dot
 * (which is what excludes `*.test.ts` and `auth.config.ts`), any path containing a space, and
 * directories that are nested components (`convex.config.ts`), and — the one rule that needs the
 * file's CONTENTS — a `.ts`/`.tsx` file with no top-level `import` or `export`. `_deps/` is an error
 * rather than a skip.
 *
 * The RISK of reimplementing is real and is bounded deliberately: this compares the MODULE LIST,
 * not the file byte-for-byte. If Convex changes how it renders the file, this check keeps passing
 * and `convex dev` produces a diff a human sees. If Convex changes which files are modules, the
 * rules above are wrong and `check-generated-api.test.mjs` pins each one so the failure is legible.
 *
 * `--write` regenerates the file from the same rules, so `npm run codegen:api` and the check can
 * never disagree about what the answer is.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CONVEX_DIR = join(ROOT, 'convex');
export const GENERATED_API_PATH = join(CONVEX_DIR, '_generated/api.d.ts');

/** `ENTRY_POINT_EXTENSIONS` in the Convex CLI. */
export const ENTRY_POINT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.jsx'];

/**
 * Whether the CLI would treat `relativePath` (posix-style, relative to `convex/`) as a module.
 *
 * Each clause mirrors one branch of `entryPoints()`, in the same order, so a reader can check them
 * against the source rather than against this comment.
 */
export function isConvexModule(relativePath) {
  const parts = relativePath.split('/');
  const base = parts[parts.length - 1];
  if (!ENTRY_POINT_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) return false;
  if (parts[0] === '_generated') return false;
  if (base.startsWith('.')) return false;
  if (base.startsWith('#')) return false;
  // ANY depth, not just the root: `convex/canon/schema.ts` is skipped exactly as `convex/schema.ts`
  // is. This is why every `*/schema.ts` in this repository is correctly absent from the generated
  // file, which looked like drift until the rule was read.
  if (base === 'schema.ts' || base === 'schema.js') return false;
  // More than one dot. This one clause is what excludes every `*.test.ts` AND `auth.config.ts`.
  if ((base.match(/\./g) ?? []).length > 1) return false;
  if (relativePath.includes(' ')) return false;
  return true;
}

/** Whether a TS entry point declares anything an api could reference. */
export const hasTopLevelImportOrExport = (source) => /^\s*(import|export)\b/m.test(source);

/** Every module path (extension stripped), sorted as the generated file sorts them. */
export function convexModules(dir = CONVEX_DIR) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        // A nested component directory owns its own generated api; the CLI skips it here.
        if (readdirSync(full).includes('convex.config.ts')) continue;
        walk(full);
        continue;
      }
      const relativePath = relative(dir, full).split(sep).join('/');
      if (relativePath.startsWith('_deps/')) {
        throw new Error(`"${relativePath}" is under the reserved "_deps" directory`);
      }
      if (!isConvexModule(relativePath)) continue;
      // The one rule that needs the file's contents rather than its name: the CLI drops a `.ts`/
      // `.tsx` entry point with no top-level `import` or `export`, because such a file exports
      // nothing an api could reference. It matches nothing in this repository today, which is
      // exactly why it is easy to omit — and omitting it would make this check demand a module
      // `convex dev` excludes.
      if (/\.tsx?$/.test(relativePath) && !hasTopLevelImportOrExport(readFileSync(full, 'utf8'))) continue;
      found.push(relativePath.replace(/\.[^.]+$/, ''));
    }
  };
  walk(dir);
  return found.sort();
}

/** The alias the generated file gives a module: path separators become underscores. */
export const aliasFor = (modulePath) => modulePath.split('/').join('_');

/** The module paths the file's `import type` lines declare, in order. */
export function declaredModules(source) {
  return [...source.matchAll(/^import type \* as \S+ from "\.\.\/(.+?)\.js";$/gm)]
    .map((match) => match[1]);
}

/**
 * The module paths the `fullApi` block declares, in order.
 *
 * Read SEPARATELY from the imports, because the file states its module list twice and the two can
 * disagree. Two injections written against an imports-only check passed cleanly — a stale entry
 * added to `fullApi` alone, and the `fullApi` entries reordered — and both would have produced a
 * file `convex dev` rewrites. The second list is the one that decides the shape of `api`, so an
 * imports-only check was reading the less important half.
 */
export function fullApiEntries(source) {
  const block = /declare const fullApi: ApiFromModules<\{\n([\s\S]*?)\n\}>;/.exec(source);
  if (block === null) return [];
  return [...block[1].matchAll(/^ {2}"(.+?)": typeof \S+;$/gm)].map((match) => match[1]);
}

/** Render the whole file from a module list. Byte-identical in shape to what `convex dev` writes. */
export function renderGeneratedApi(modules) {
  const imports = modules
    .map((modulePath) => `import type * as ${aliasFor(modulePath)} from "../${modulePath}.js";`)
    .join('\n');
  const entries = modules
    .map((modulePath) => `  "${modulePath}": typeof ${aliasFor(modulePath)};`)
    .join('\n');
  return `/* eslint-disable */
/**
 * Generated \`api\` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run \`npx convex dev\`.
 * @module
 */

${imports}

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
${entries}
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * \`\`\`js
 * const myFunctionReference = api.myModule.myFunction;
 * \`\`\`
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * \`\`\`js
 * const myFunctionReference = internal.myModule.myFunction;
 * \`\`\`
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
`;
}

export function runCheck(dir = CONVEX_DIR, generatedPath = GENERATED_API_PATH) {
  const expected = convexModules(dir);
  const source = readFileSync(generatedPath, 'utf8');
  const declared = declaredModules(source);
  const entries = fullApiEntries(source);
  const errors = [];

  // The file states its module list twice; both halves must agree with the tree AND with each
  // other. `fullApi` is the half that decides the shape of `api`, so checking only the imports
  // would leave the more important one unchecked.
  if (declared.join('\n') !== entries.join('\n')) {
    const importsOnly = declared.filter((modulePath) => !entries.includes(modulePath));
    const entriesOnly = entries.filter((modulePath) => !declared.includes(modulePath));
    if (importsOnly.length === 0 && entriesOnly.length === 0) {
      errors.push('the generated api imports and its `fullApi` block list the same modules in different orders');
    }
    for (const modulePath of importsOnly) {
      errors.push(`"${modulePath}" is imported by the generated api but missing from its \`fullApi\` block`);
    }
    for (const modulePath of entriesOnly) {
      errors.push(`"${modulePath}" is in the generated api's \`fullApi\` block but is not imported`);
    }
  }

  if (expected.length === 0) {
    errors.push(
      `no Convex modules found under ${dir} — the walk matched nothing, so every comparison below `
      + 'would be vacuously satisfied',
    );
  }

  const missing = expected.filter((modulePath) => !declared.includes(modulePath));
  const extra = declared.filter((modulePath) => !expected.includes(modulePath));
  for (const modulePath of missing) {
    errors.push(`"${modulePath}" is a Convex module but is not declared in the generated api`);
  }
  for (const modulePath of extra) {
    errors.push(`"${modulePath}" is declared in the generated api but is not a module in the tree`);
  }
  // Order matters as well as membership: the generated file is sorted, and an unsorted checked-in
  // file would produce a diff the next time anyone ran `convex dev`.
  if (missing.length === 0 && extra.length === 0
      && declared.join('\n') !== expected.join('\n')) {
    errors.push('the generated api declares every module but not in sorted order');
  }

  return { errors, expected, declared, missing, extra };
}

function main() {
  const write = process.argv.includes('--write');
  if (write) {
    const modules = convexModules();
    writeFileSync(GENERATED_API_PATH, renderGeneratedApi(modules));
    console.log(`Wrote ${relative(ROOT, GENERATED_API_PATH)} with ${modules.length} module(s).`);
    return;
  }
  const { errors, expected } = runCheck();
  if (errors.length > 0) {
    console.error('Generated Convex api check failed:\n');
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\n${errors.length} problem(s). Run \`npm run codegen:api\` to regenerate.`);
    process.exit(1);
  }
  console.log(`Generated Convex api check passed: ${expected.length} module(s) declared, and no others exist.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
