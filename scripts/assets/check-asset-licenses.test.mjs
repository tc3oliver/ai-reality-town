import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_BUNDLE_PATHS,
  checkCssReferencedAssetsCoverage,
  checkPublicBundleCoverage,
  checkPublicDirectoryCoverage,
  findCssFiles,
  isPlaceholderProvenance,
  loadManifest,
  runCheck,
  validateManifestShape,
} from './check-asset-licenses.mjs';

const manifest = loadManifest();
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const approvedRecord = (path) => ({
  path,
  type: 'image',
  source: 'Fixture',
  author: 'Fixture author',
  license: 'CC0',
  status: 'approved',
});

/** Writes `files` (repo-relative path -> contents) into a fresh temp directory. */
function fixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'asset-licence-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('the real manifest has valid shape', () => {
  assert.deepEqual(validateManifestShape(manifest), []);
});

test('every public-bundle asset in the real manifest is approved', () => {
  assert.deepEqual(checkPublicBundleCoverage(manifest), []);
});

test('runCheck() passes clean against the real repository state', () => {
  assert.deepEqual(runCheck(), []);
});

test('fails when a required public-bundle licence record is removed entirely', () => {
  const withoutFont = {
    assets: manifest.assets.filter(
      (asset) => asset.path !== 'public/assets/fonts/upheaval_pro.ttf',
    ),
  };
  const errors = checkPublicBundleCoverage(withoutFont);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /public\/assets\/fonts\/upheaval_pro\.ttf/);
  assert.match(errors[0], /no licence record/);
});

test('fails when a public-bundle asset is demoted from approved to quarantined', () => {
  const demoted = {
    assets: manifest.assets.map((asset) =>
      asset.path === 'public/assets/gentle-obj.png' ? { ...asset, status: 'quarantined' } : asset,
    ),
  };
  const errors = checkPublicBundleCoverage(demoted);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /public\/assets\/gentle-obj\.png/);
  assert.match(errors[0], /not "approved"/);
});

test('fails when a public-bundle asset is missing its licence field', () => {
  const stripped = {
    assets: manifest.assets.map((asset) =>
      asset.path === 'data/animations/windmill.json' ? { ...asset, license: '' } : asset,
    ),
  };
  const errors = validateManifestShape(stripped).concat(checkPublicBundleCoverage(stripped));
  assert.ok(errors.some((error) => error.includes('data/animations/windmill.json')));
});

test('rejects an unknown status value', () => {
  const bogus = {
    assets: manifest.assets.map((asset) =>
      asset.path === 'public/favicon.ico' ? { ...asset, status: 'made-up-status' } : asset,
    ),
  };
  const errors = validateManifestShape(bogus);
  assert.ok(errors.some((error) => error.includes('invalid status')));
});

test('rejects duplicate manifest entries', () => {
  const duplicated = { assets: [...manifest.assets, manifest.assets[0]] };
  const errors = validateManifestShape(duplicated);
  assert.ok(errors.some((error) => error.includes('duplicate manifest entry')));
});

test('PUBLIC_BUNDLE_PATHS is non-empty and every entry is a manifest path', () => {
  assert.ok(PUBLIC_BUNDLE_PATHS.length > 0);
  const paths = new Set(manifest.assets.map((asset) => asset.path));
  for (const path of PUBLIC_BUNDLE_PATHS)
    assert.ok(paths.has(path), `${path} missing from manifest`);
});

test('isPlaceholderProvenance detects placeholder values', () => {
  assert.equal(isPlaceholderProvenance(''), true);
  assert.equal(isPlaceholderProvenance('Unresolved'), true);
  assert.equal(isPlaceholderProvenance('unresolved -- not matched to any pack'), true);
  assert.equal(isPlaceholderProvenance('Unknown'), true);
  assert.equal(isPlaceholderProvenance('TBD'), true);
  assert.equal(isPlaceholderProvenance('N/A'), true);
  assert.equal(isPlaceholderProvenance(' pending: awaiting reply '), true);
  assert.equal(isPlaceholderProvenance('CC-BY 4.0'), false);
  assert.equal(isPlaceholderProvenance('Follows public/assets/32x32folk.png'), false);
  assert.equal(isPlaceholderProvenance('a16z-infra/ai-town'), false);
  assert.equal(
    isPlaceholderProvenance('CC-BY 4.0, attribution unknown one contributing pack'),
    false,
  );
});

test('ART-143: character art is approved under the accepted upstream MIT grant and enforced', () => {
  const characterArtPaths = [
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
  const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));
  for (const path of characterArtPaths) {
    const asset = byPath.get(path);
    assert.ok(asset, `${path} missing from manifest`);
    assert.equal(asset.status, 'approved', `${path} must be approved`);
    assert.match(asset.license, /MIT/, `${path} must record the upstream MIT grant`);
    assert.equal(isPlaceholderProvenance(asset.source), false);
    assert.equal(isPlaceholderProvenance(asset.author), false);
    assert.equal(isPlaceholderProvenance(asset.license), false);
    assert.ok(asset.redistribution && asset.modification, `${path} must carry usable rights`);
    assert.ok(PUBLIC_BUNDLE_PATHS.includes(path), `${path} must be listed in PUBLIC_BUNDLE_PATHS`);
  }
});

test('rejects laundering an unresolved-provenance asset into the public bundle by status flip alone', () => {
  const laundered = {
    assets: manifest.assets.map((asset) =>
      asset.path === 'assets/close.svg' ? { ...asset, status: 'approved' } : asset,
    ),
  };
  const errors = validateManifestShape(laundered);
  assert.ok(
    errors.some(
      (error) => error.includes('assets/close.svg') && error.includes('unresolved provenance'),
    ),
  );
});

test('adding a quarantined path directly to PUBLIC_BUNDLE_PATHS is caught by coverage check', () => {
  const errors = checkPublicBundleCoverage(manifest, [...PUBLIC_BUNDLE_PATHS, 'assets/close.svg']);
  assert.ok(
    errors.some((error) => error.includes('assets/close.svg') && error.includes('not "approved"')),
  );
});

test('ART-144: an unlisted file under public/ fails the check', () => {
  const root = fixtureTree({ 'public/assets/mystery.png': 'fixture' });
  const errors = checkPublicDirectoryCoverage({ assets: [] }, join(root, 'public'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /public\/assets\/mystery\.png/);
  assert.match(errors[0], /no licence record/);
});

test('ART-144: a quarantined file under public/ fails the check', () => {
  const root = fixtureTree({ 'public/assets/mystery.png': 'fixture' });
  const quarantined = {
    assets: [{ ...approvedRecord('public/assets/mystery.png'), status: 'quarantined' }],
  };
  const errors = checkPublicDirectoryCoverage(quarantined, join(root, 'public'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not "approved"/);
});

test('ART-144: public/ coverage passes when every nested file has an approved record', () => {
  const root = fixtureTree({
    'public/favicon.ico': 'fixture',
    'public/assets/fonts/some.ttf': 'fixture',
  });
  const covered = {
    assets: [approvedRecord('public/favicon.ico'), approvedRecord('public/assets/fonts/some.ttf')],
  };
  assert.deepEqual(checkPublicDirectoryCoverage(covered, join(root, 'public')), []);
});

test('ART-144: a CSS url() reference to an unapproved asset fails the check', () => {
  const root = fixtureTree({
    'assets/ui/unknown.svg': '<svg/>',
    'src/app.css': '.chrome { border-image-source: url(../assets/ui/unknown.svg); }',
  });
  const errors = checkCssReferencedAssetsCoverage({ assets: [] }, [join(root, 'src/app.css')], root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /assets\/ui\/unknown\.svg/);
  assert.match(errors[0], /src\/app\.css/);
  assert.match(errors[0], /no licence record/);
});

test('ART-144: a CSS url() reference to an approved public/ asset passes', () => {
  const root = fixtureTree({
    'public/assets/fonts/some.ttf': 'fixture',
    'src/app.css': '@font-face { src: url(/assets/fonts/some.ttf); }',
  });
  const covered = { assets: [approvedRecord('public/assets/fonts/some.ttf')] };
  assert.deepEqual(
    checkCssReferencedAssetsCoverage(covered, [join(root, 'src/app.css')], root),
    [],
  );
});

test('ART-144: data: URIs and remote URLs in url() are ignored without crashing', () => {
  const root = fixtureTree({
    'src/app.css': [
      ".pressed { border-image-source: url(\"data:image/svg+xml,%3Csvg width='16'%3E%3Crect x='1'/%3E%3C/svg%3E\"); }",
      '.remote { background: url(https://example.com/art.png); }',
    ].join('\n'),
  });
  assert.deepEqual(
    checkCssReferencedAssetsCoverage({ assets: [] }, [join(root, 'src/app.css')], root),
    [],
  );
});

test('ART-144: the real public/ directory and stylesheets are fully covered', () => {
  assert.deepEqual(checkPublicDirectoryCoverage(manifest), []);
  assert.deepEqual(checkCssReferencedAssetsCoverage(manifest), []);
  assert.deepEqual(findCssFiles(), [join(REPO_ROOT, 'src/index.css')]);
});

test('ART-144: the assets deleted for unverifiable provenance are gone from the manifest', () => {
  const deleted = [
    'public/assets/player.png',
    'public/assets/rpg-tileset.png',
    'public/assets/magecity.png',
    'public/assets/heart-empty.png',
    'public/assets/tilemap.json',
    'public/assets/background.mp3',
    'assets/background.webp',
    'assets/ui/box.svg',
    'assets/ui/bubble-left.svg',
    'assets/ui/bubble-right.svg',
    'assets/ui/button.svg',
    'assets/ui/button_pressed.svg',
    'assets/ui/chats.svg',
    'assets/ui/desc.svg',
    'assets/ui/frame.svg',
    'assets/ui/jewel_box.svg',
  ];
  const paths = new Set(manifest.assets.map((asset) => asset.path));
  for (const path of deleted) assert.equal(paths.has(path), false, `${path} still recorded`);
});
