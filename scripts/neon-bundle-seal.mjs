// Pure bundle seal/open (Node built-ins only), so a downloaded recovery
// artifact can be opened on an operator laptop without backend dependencies.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { encryptBuffer, decryptBuffer, sha256, requireCondition as check } from './local-backup-drill-core.mjs';

export const NEON_BACKUP_FORMAT = 'simsa-neon-backup-v1';
function mac(body,key) { return createHmac('sha256',key).update(NEON_BACKUP_FORMAT + '\0' + JSON.stringify(body)).digest('hex'); }
export function sealNeonBundle({ metadata, runId, key, archive, evidence }) {
  check(archive.subarray(0,5).toString('ascii') === 'PGDMP', 'Dump is not a PostgreSQL custom archive');
  const sealedArchive = encryptBuffer(archive,key,runId,'archive'), sealedEvidence = encryptBuffer(evidence,key,runId,'evidence');
  const body = { ...metadata, format: NEON_BACKUP_FORMAT, run_id: runId, scope: 'database-only',
    archive_sha256: sha256(sealedArchive), evidence_sha256: sha256(sealedEvidence) };
  return { manifest: { body, hmac: mac(body,key) }, archive: sealedArchive, evidence: sealedEvidence };
}
export function openNeonBundle(bundle,key) {
  const { body,hmac } = bundle.manifest ?? {};
  check(Buffer.isBuffer(key) && key.length === 32 && body && /^[a-f0-9]{64}$/.test(hmac), 'Invalid manifest seal');
  check(timingSafeEqual(Buffer.from(mac(body,key),'hex'),Buffer.from(hmac,'hex')), 'Manifest authentication failed');
  check(body.format === NEON_BACKUP_FORMAT && body.scope === 'database-only' && /^[a-f0-9]{32}$/.test(body.run_id)
    && /^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(body.source?.host)
    && !body.source.host.split('.')[0].endsWith('-pooler') && /^[a-z][a-z0-9_]{2,62}$/.test(body.source.database)
    && !['postgres','template0','template1'].includes(body.source.database) && body.source.role === 'simsa_backup' && body.source.major === 18
    && Number.isFinite(Date.parse(body.snapshot_at)) && Array.isArray(body.migrations) && body.helpers && Object.values(body.helpers).every(h => /^[a-f0-9]{64}$/.test(h)), 'Unsupported backup manifest');
  check(sha256(bundle.archive) === body.archive_sha256 && sha256(bundle.evidence) === body.evidence_sha256, 'Encrypted artifact hash mismatch');
  const archive = decryptBuffer(bundle.archive,key,body.run_id,'archive');
  try {
    const evidence = decryptBuffer(bundle.evidence,key,body.run_id,'evidence');
    check(archive.subarray(0,5).toString('ascii') === 'PGDMP', 'Authenticated dump has an invalid format');
    return { body,archive,evidence };
  } catch (error) { archive.fill(0); throw error; }
}
