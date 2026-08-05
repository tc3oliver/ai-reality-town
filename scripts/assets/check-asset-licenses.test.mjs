import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_BUNDLE_PATHS,
  checkPublicBundleCoverage,
  loadManifest,
  runCheck,
  validateManifestShape,
} from './check-asset-licenses.mjs';

const manifest = loadManifest();

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
    assets: manifest.assets.filter((asset) => asset.path !== 'public/assets/fonts/upheaval_pro.ttf'),
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
  for (const path of PUBLIC_BUNDLE_PATHS) assert.ok(paths.has(path), `${path} missing from manifest`);
});
