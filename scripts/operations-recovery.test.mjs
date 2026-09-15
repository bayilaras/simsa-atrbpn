import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryAttestation,publishRecoveryStatus,finalizeRecoveryAttempt } from './operations-recovery.mjs';
import { unwrapRecoveryKeys } from './operations-recovery-delivery.mjs';
import { seal } from './operations-recovery-documents.mjs';
import { randomBytes,scryptSync } from 'node:crypto';
const time='2026-09-15T12:00:00.000Z';
const report={runId:'a'.repeat(32),finishedAt:time,backup:{databaseVerified:true,documentsVerified:true,completedAt:time},restore:{databaseVerified:true,documentsVerified:true,targetStopped:true,completedAt:time}};
test('attestation marks success only after both databases and documents proved',()=>{
 assert.equal(recoveryAttestation(report).restore.status,'success');assert.equal(recoveryAttestation(report).backup.status,'success');
 assert.equal(recoveryAttestation({...report,restore:{...report.restore,targetStopped:false}}).restore.status,'failed');
 assert.equal(recoveryAttestation({...report,backup:{databaseVerified:true,documentsVerified:false}}).backup.status,'failed');
 assert.equal(recoveryAttestation({...report,backup:{...report.backup,deliveryVerified:false}}).backup.status,'failed');
 assert.equal(recoveryAttestation({...report,restore:{}}).restore.status,'failed');
});
test('portable recovery key envelope roundtrip rejects wrong passphrase and unbounded KDF',()=>{
 const passphrase='a safe synthetic passphrase longer than32',salt=randomBytes(32),archiveSha256='b'.repeat(64),documentKey=randomBytes(32);
 const metadata={schemaVersion:1,kdf:'scrypt',N:32768,r:8,p:1,saltBase64:salt.toString('base64'),archiveSha256};
 const key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const bytes=Buffer.from(JSON.stringify({databaseKeyRecord:JSON.stringify({run_id:'a'.repeat(32),key_base64:randomBytes(32).toString('base64')}),documentKeyBase64:documentKey.toString('base64')}));
 const envelope=seal(bytes,key,`simsa-recovery-keys-v1:${archiveSha256}`);assert.deepEqual(unwrapRecoveryKeys(metadata,envelope,passphrase).documentKey,documentKey);
 assert.throws(()=>unwrapRecoveryKeys(metadata,envelope,'wrong password long enough to test encryption'));
 assert.throws(()=>unwrapRecoveryKeys({...metadata,N:2**30},envelope,passphrase));
});
test('status keeps completion age and binds sanitized evidence hash',()=>{
 const actual=recoveryAttestation(report);assert.equal(actual.backup.completedAt,time);assert.match(actual.backup.evidenceSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(actual.backup.evidenceSha256,recoveryAttestation({...report,failureCode:'changed'}).backup.evidenceSha256);
});
test('publisher archives a failure before updating only fixed private latest path',async()=>{
 const calls=[];const put=async(...args)=>{calls.push(args);};
 const failed={...report,backup:{databaseVerified:true,documentsVerified:false}};
 await publishRecoveryStatus(failed,{SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_teststore123_secret',SIMSA_PRIVATE_BLOB_STORE_ID:'teststore123'},{put});
 assert.equal(calls.length,2);assert.equal(calls[0][0],`operations/recovery-runs/${report.runId}.json`);assert.equal(calls[0][2].allowOverwrite,false);
 assert.equal(calls[1][0],'operations/recovery-status-v1.json');assert.equal(calls[1][2].allowOverwrite,true);assert.equal(calls[1][2].access,'private');
 assert.equal(JSON.parse(calls[1][1]).backup.status,'failed');
});
test('publisher rejects independently pinned hostname mismatch without sending request',async()=>{
 let calls=0;await assert.rejects(publishRecoveryStatus(report,{SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_otherstore_secret',OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME:'teststore123.private.blob.vercel-storage.com'},{put:async()=>calls++}));assert.equal(calls,0);
});
test('local proof write failure still publishes a failed attempt, without raw filesystem details',async()=>{
 const attempt=structuredClone({...report,status:'success'});let published;
 await finalizeRecoveryAttempt(attempt,{persist:async()=>{throw new Error('private file path and unexpected sensitive detail');},publish:async()=>{published=recoveryAttestation(attempt);}});
 assert.equal(attempt.status,'failed');assert.equal(attempt.localEvidenceFailure,true);assert.equal(attempt.statusPublished,true);
 assert.equal(published.backup.status,'failed');assert.equal(published.restore.status,'failed');assert.equal(JSON.stringify(attempt).includes('sensitive detail'),false);
});
test('publication failure remains visible even after local report persistence succeeds',async()=>{
 const attempt=structuredClone({...report,status:'success'});let persisted=false;
 await finalizeRecoveryAttempt(attempt,{persist:async()=>{persisted=true;},publish:async()=>{throw new Error('unexpected raw credential detail');}});
 assert.equal(persisted,true);assert.equal(attempt.status,'failed');assert.equal(attempt.publicationFailure,true);assert.equal(attempt.statusPublished,false);
});
