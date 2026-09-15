import { loadMigrations } from '../backend/scripts/migrate-database.mjs';

/** Same canonical shape as the Python release verifier; SQL bytes own the hashes. */
export function reviewedMigrationManifest() {
  return loadMigrations().map((migration, idx) => ({
    idx, created_at: migration.timestamp, tag: migration.tag,
    sha256: migration.hash, accepted_sha256: migration.acceptedHashes,
  }));
}

export function assertReviewedMigrationManifest(value) {
  const expected = reviewedMigrationManifest();
  if (!Array.isArray(value) || value.length !== expected.length || value.some((entry, idx) => {
    const canonical = expected[idx];
    return !entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).length !== Object.keys(canonical).length
      || ['idx', 'created_at', 'tag', 'sha256'].some(key => entry[key] !== canonical[key])
      || !Array.isArray(entry.accepted_sha256)
      || JSON.stringify(entry.accepted_sha256) !== JSON.stringify(canonical.accepted_sha256);
  })) throw new Error('Migration manifest differs from the complete reviewed checkout');
  return value;
}
