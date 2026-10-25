import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { boundedFile } from './neon-backup-runtime.mjs';
import { openNeonBundle,migrationManifest } from './neon-backup-core.mjs';
import { neonBackupHelperHashes } from './neon-backup.mjs';
import { restoreDocuments,sha256 } from './operations-recovery-documents.mjs';
import { unwrapRecoveryKeys } from './operations-recovery-keys.mjs';
export { unwrapRecoveryKeys };
import { restoreDatabaseProof } from './operations-recovery-database.mjs';
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{safeCode:code});};
export async function restoreDeliveryProof({directory,passphrase,workspace,targetFactory}){
 let plain,databaseKey,documentKey,targetKey;
 try{
  await workspace.verifyPrivate(directory);
  const metadata=JSON.parse(await boundedFile(join(directory,'key-envelope.json'),2048));
  const keys=unwrapRecoveryKeys(metadata,await boundedFile(join(directory,'recovery-keys.aesgcm'),8192),passphrase);documentKey=keys.documentKey;databaseKey=Buffer.from(keys.database.key_base64,'base64');
  plain=openNeonBundle({manifest:JSON.parse(await boundedFile(join(directory,'database/manifest.json'),65536)),archive:await boundedFile(join(directory,'database/database.dump.aesgcm'),100*1024*1024),evidence:await boundedFile(join(directory,'database/source.evidence.aesgcm'),20*1024*1024)},databaseKey);
  check(keys.database.run_id===plain.body.run_id&&sha256(plain.archive)===metadata.archiveSha256&&JSON.stringify(plain.body.helpers)===JSON.stringify(await neonBackupHelperHashes())&&JSON.stringify(plain.body.migrations)===JSON.stringify(migrationManifest()),'DELIVERY_DATABASE_IDENTITY_MISMATCH');
  const database=await restoreDatabaseProof(plain,workspace,{targetFactory});
  targetKey=randomBytes(32);
  const documents=await restoreDocuments({directory:join(directory,'documents'),key:documentKey,targetDirectory:join(workspace.directory,'restored-delivery-documents'),targetKey,expectedArchiveSha256:metadata.archiveSha256});
  return {database,documents,sourceSnapshotAt:plain.body.snapshot_at,archiveSha256:metadata.archiveSha256,sourceNetworkRequests:0};
 }finally{databaseKey?.fill(0);documentKey?.fill(0);targetKey?.fill(0);plain?.archive.fill(0);plain?.evidence.fill(0);}
}
