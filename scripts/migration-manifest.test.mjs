import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewedMigrationManifest, assertReviewedMigrationManifest } from './migration-manifest.mjs';

test('current backup manifest follows the complete ordered repository journal', () => {
  const journal = JSON.parse(readFileSync(new URL('../backend/src/db/migrations/meta/_journal.json', import.meta.url))).entries;
  const manifest = reviewedMigrationManifest();
  assert.equal(manifest.length, journal.length);
  assert.equal(manifest.at(-1).created_at, journal.at(-1).when);
  assert.equal(manifest.at(-1).tag, journal.at(-1).tag);
  assert.doesNotThrow(() => assertReviewedMigrationManifest(manifest));
});

test('stale, reordered, modified and extra backup migration identities fail closed', () => {
  const current = reviewedMigrationManifest();
  const stale = current.slice(0, -1);
  const reordered = structuredClone(current); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const changedHash = structuredClone(current); changedHash.at(-1).sha256 = '0'.repeat(64);
  const changedAccepted = structuredClone(current); changedAccepted.at(-1).accepted_sha256.push('0'.repeat(64));
  const extra = structuredClone(current); extra.at(-1).unexpected = true;
  for (const manifest of [[], null, stale, reordered, changedHash, changedAccepted, extra]) {
    assert.throws(() => assertReviewedMigrationManifest(manifest), /reviewed checkout/);
  }
});
