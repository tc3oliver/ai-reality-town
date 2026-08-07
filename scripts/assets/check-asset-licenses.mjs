import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = join(ROOT, 'assets/asset-licenses.json');
const PUBLIC_DIR = join(ROOT, 'public');
const CSS_SOURCE_DIR = join(ROOT, 'src');

// Assets reachable from the current or planned public visual bundle (ART-107's
// "reusable renderer" inventory: PixiGame/PixiStaticMap/Character + the stock
// gentle-obj.png tileset + its FX spritesheets/animations + the character
// spritesheet ART-111 binds + the two shipped fonts + the favicon). Every path
// here must carry an "approved" manifest record with a non-empty licence and
// attribution disposition. This list is deliberately narrower than the full
// asset census in the manifest: assets outside it (editor-only tilesets, brand
// logos, the AI-generated background track) are recorded for audit
// completeness but must not enter the public bundle until they earn their own
// "approved" record.
export const PUBLIC_BUNDLE_PATHS = [
  'public/assets/gentle-obj.png',
  'data/gentle.js',
  'data/mistwood.ts',
  'public/assets/spritesheets/campfire.png',
  'public/assets/spritesheets/gentlesparkle32.png',
  'public/assets/spritesheets/gentlewaterfall32.png',
  'public/assets/spritesheets/windmill.png',
  'data/animations/campfire.json',
  'data/animations/gentlesparkle.json',
  'data/animations/gentlesplash.json',
  'data/animations/gentlewaterfall.json',
  'data/animations/windmill.json',
  'public/assets/fonts/upheaval_pro.ttf',
  'public/assets/fonts/vcr_osd_mono.ttf',
  'public/favicon.ico',
  'public/assets/32x32folk.png',
  'data/spritesheets/f1.ts',
  'data/spritesheets/f2.ts',
  'data/spritesheets/f3.ts',
  'data/spritesheets/f4.ts',
  'data/spritesheets/f5.ts',
  'data/spritesheets/f6.ts',
  'data/spritesheets/f7.ts',
  'data/spritesheets/f8.ts',
];

const REQUIRED_FIELDS = ['path', 'type', 'source', 'author', 'license', 'status'];
const VALID_STATUSES = ['approved', 'restricted', 'quarantined', 'tooling'];
const PLACEHOLDER_PROVENANCE_TERMS = [
  'unresolved',
  'unknown',
  'undetermined',
  'unverified',
  'tbd',
  'todo',
  'pending',
  'n/a',
  'none',
];
const PLACEHOLDER_SEPARATORS = new Set([' ', '-', ':', ',', '.', ';']);

export function isPlaceholderProvenance(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === '') return true;
  for (const term of PLACEHOLDER_PROVENANCE_TERMS) {
    if (normalized === term) return true;
    if (normalized.startsWith(term) && PLACEHOLDER_SEPARATORS.has(normalized[term.length]))
      return true;
  }
  return false;
}

export function loadManifest(path = MANIFEST_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateManifestShape(manifest) {
  const errors = [];
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    errors.push('manifest must declare a non-empty "assets" array');
    return errors;
  }
  const seen = new Set();
  for (const asset of manifest.assets) {
    const label = asset?.path ?? '<unknown path>';
    for (const field of REQUIRED_FIELDS) {
      if (!asset?.[field] || String(asset[field]).trim() === '') {
        errors.push(`${label}: missing required field "${field}"`);
      }
    }
    if (asset?.status && !VALID_STATUSES.includes(asset.status)) {
      errors.push(
        `${label}: invalid status "${asset.status}" (expected one of ${VALID_STATUSES.join(', ')})`,
      );
    }
    if (asset?.status === 'approved' && (!asset.author || !asset.license)) {
      errors.push(
        `${label}: status "approved" requires both "author" and "license" to be recorded`,
      );
    }
    if (asset?.status === 'approved') {
      for (const field of ['source', 'author', 'license']) {
        if (isPlaceholderProvenance(asset?.[field])) {
          errors.push(
            `${label}: status "approved" requires verified provenance, but "${field}" is a placeholder value ("${asset[field]}") -- unresolved provenance must not enter public bundle`,
          );
        }
      }
    }
    if (asset?.path) {
      if (seen.has(asset.path)) errors.push(`${label}: duplicate manifest entry`);
      seen.add(asset.path);
    }
  }
  return errors;
}

/**
 * Checks that every asset reachable from the current or planned public bundle
 * has an "approved" manifest record with licence + attribution evidence. This
 * is the gate FR-N008 / ART-108 requires: it must fail when a required
 * licence record for a public-bundle asset is missing, unapproved, or
 * incomplete.
 */
export function checkPublicBundleCoverage(manifest, publicBundlePaths = PUBLIC_BUNDLE_PATHS) {
  const errors = [];
  const byPath = new Map((manifest.assets ?? []).map((asset) => [asset.path, asset]));
  for (const path of publicBundlePaths) {
    const asset = byPath.get(path);
    if (!asset) {
      errors.push(
        `${path}: reachable from the public bundle but has no licence record in assets/asset-licenses.json`,
      );
      continue;
    }
    if (asset.status !== 'approved') {
      errors.push(
        `${path}: reachable from the public bundle but status is "${asset.status}", not "approved"`,
      );
    }
    if (!asset.license || String(asset.license).trim() === '') {
      errors.push(`${path}: reachable from the public bundle but has no recorded licence`);
    }
    if (asset.attributionRequired && !asset.notes) {
      errors.push(`${path}: attribution is required but no attribution detail is recorded`);
    }
  }
  return errors;
}

function listFilesRecursively(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFilesRecursively(full));
    else files.push(full);
  }
  return files;
}

function toManifestPath(...segments) {
  return segments.join('/').split(sep).join('/');
}

function approvalError(manifest, path, reachability) {
  const asset = (manifest.assets ?? []).find((candidate) => candidate.path === path);
  if (!asset) {
    return `${path}: ${reachability} but has no licence record in assets/asset-licenses.json`;
  }
  if (asset.status !== 'approved') {
    return `${path}: ${reachability} but status is "${asset.status}", not "approved"`;
  }
  return null;
}

/**
 * Vite copies public/ into dist/ verbatim -- no import graph is involved, so
 * PUBLIC_BUNDLE_PATHS cannot describe what actually ships. This walks the real
 * directory instead and demands an approved record for every file in it.
 */
export function checkPublicDirectoryCoverage(
  manifest,
  publicDir = PUBLIC_DIR,
  manifestPrefix = 'public',
) {
  const errors = [];
  for (const file of listFilesRecursively(publicDir)) {
    const path = toManifestPath(manifestPrefix, relative(publicDir, file));
    const error = approvalError(manifest, path, 'is published verbatim from public/');
    if (error) errors.push(error);
  }
  return errors;
}

export function findCssFiles(dir = CSS_SOURCE_DIR) {
  return listFilesRecursively(dir).filter((file) => file.endsWith('.css'));
}

const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/g;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * CSS url() references are not JavaScript imports, but vite emits every one of
 * them into dist/ all the same. Resolves each reference to a repo-relative path
 * and demands an approved record for it.
 */
export function checkCssReferencedAssetsCoverage(
  manifest,
  cssFiles = findCssFiles(),
  root = ROOT,
  publicDir = join(root, 'public'),
) {
  const errors = [];
  for (const cssFile of cssFiles) {
    const source = readFileSync(cssFile, 'utf8');
    for (const [, doubleQuoted, singleQuoted, bare] of source.matchAll(CSS_URL_PATTERN)) {
      const reference = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
      if (reference === '' || URI_SCHEME_PATTERN.test(reference)) continue;
      const resolved = reference.startsWith('/')
        ? join(publicDir, reference)
        : resolve(dirname(cssFile), reference);
      if (!existsSync(resolved)) continue;
      const path = toManifestPath(relative(root, resolved));
      const error = approvalError(
        manifest,
        path,
        `referenced by url(${reference}) in ${toManifestPath(relative(root, cssFile))} and emitted into dist/`,
      );
      if (error) errors.push(error);
    }
  }
  return errors;
}

export function runCheck(manifestPath = MANIFEST_PATH, publicBundlePaths = PUBLIC_BUNDLE_PATHS) {
  const manifest = loadManifest(manifestPath);
  return [
    ...validateManifestShape(manifest),
    ...checkPublicBundleCoverage(manifest, publicBundlePaths),
    ...checkPublicDirectoryCoverage(manifest),
    ...checkCssReferencedAssetsCoverage(manifest),
  ];
}

function main() {
  const errors = runCheck();
  if (errors.length > 0) {
    console.error('Asset licence check failed:\n');
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      `\n${errors.length} problem(s) found. See ASSETS-LICENSE.md and assets/asset-licenses.json.`,
    );
    process.exit(1);
  }
  console.log(
    `Asset licence check passed: ${PUBLIC_BUNDLE_PATHS.length} public-bundle asset(s) verified, ` +
      `plus every file under public/ and every url() reference in ${findCssFiles().length} stylesheet(s).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
