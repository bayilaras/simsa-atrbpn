import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseIntegrityEnvironment,createPrivateIntegrityReader,runIntegrityWithPool} from './check-file-integrity.mjs';
const blobToken='vercel_blob_rw_teststore123_syntheticsecret';
const env={NEON_WORKER_DATABASE_URL:'postgresql://simsa_worker:synthetic-password@ep-synthetic-test.ap-southeast-1.aws.neon.tech/simsa?sslmode=verify-full&channel_binding=require',NEON_WORKER_EXPECTED_HOST:'ep-synthetic-test.ap-southeast-1.aws.neon.tech',NEON_WORKER_EXPECTED_DATABASE:'simsa',SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:blobToken};
test('worker config requires pinned direct worker identity and bounded execution',()=>{
 const actual=parseIntegrityEnvironment({...env,FIXITY_BATCH_SIZE:'3'});assert.equal(actual.clientConfig.user,'simsa_worker');assert.equal(actual.clientConfig.ssl.rejectUnauthorized,true);assert.equal(actual.fixity.batchSize,3);
 for(const changed of [{NEON_WORKER_EXPECTED_HOST:'ep-other.ap-southeast-1.aws.neon.tech'},{NEON_WORKER_DATABASE_URL:env.NEON_WORKER_DATABASE_URL.replace('simsa_worker:','simsa_api:')},{FIXITY_BATCH_SIZE:'101'},{FIXITY_MAX_BYTES:String(513*1024*1024)}])assert.throws(()=>parseIntegrityEnvironment({...env,...changed}));
});
test('private reader denies another host and redirect, and forwards service abort signal',async()=>{
 const abort=new AbortController();let calls=0;
 const reader=createPrivateIntegrityReader(env,{fetchImpl:async(url,options)=>{calls++;assert.equal(url.hostname,'teststore123.private.blob.vercel-storage.com');assert.equal(options.redirect,'error');assert.equal(options.signal,abort.signal);return new Response('bytes',{status:200,headers:{'content-length':'5'}});}});
 await assert.rejects(reader('https://attacker.example/test.pdf',{abortSignal:abort.signal}));assert.equal(calls,0);
 const result=await reader('https://teststore123.private.blob.vercel-storage.com/test.pdf',{abortSignal:abort.signal});let text='';for await(const chunk of result.stream)text+=chunk;assert.equal(text,'bytes');assert.equal(calls,1);
});
const fileBytes=Buffer.from('synthetic immutable archive');
const hash=createHash('sha256').update(fileBytes).digest('hex');
const file={id:'00000000-0000-4000-8000-000000000001',claimToken:'claim',fileUrl:'https://teststore123.private.blob.vercel-storage.com/test.pdf',driveFileId:null,objectGeneration:null,storageAccess:'private',sha256:hash,sizeBytes:fileBytes.length};
function poolFor(files){
 const statements=[];const client={release(){},async query(sql,args){statements.push({sql,args});if(sql.startsWith('SELECT attachment_id'))return {rows:[{attachment_id:file.id}]};if(sql.startsWith('UPDATE file_attachments'))return {rows:[{id:file.id}]};return {rows:[]};}};
 return {statements,async connect(){return client;},async query(sql,args){statements.push({sql,args});if(sql.includes('WITH candidate AS'))return {rows:files.length?[files.shift()]:[]};return {rows:[]};}};
}
test('real FileFixityService matches bounded file and writes its existing audit without overwriting hash',async()=>{
 const pool=poolFor([{...file},{...file}]);const report=await runIntegrityWithPool(pool,{...env,FIXITY_BATCH_SIZE:'1'},{fetchImpl:async()=>new Response(fileBytes,{status:200})});
 assert.equal(report.summary.checked,1);assert.equal(report.summary.matched,1);assert.equal(report.status,'success');
 const updates=pool.statements.filter(row=>row.sql.startsWith('UPDATE file_attachments'));assert.equal(updates.length,1);assert.equal(updates[0].args[2],hash);assert.match(updates[0].sql,/last_fixity_check_at=now\(\)/);assert.doesNotMatch(updates[0].sql,/SET\s+sha256/i);
 assert.equal(pool.statements.filter(row=>row.sql.includes('INSERT INTO audit_log')).length,1);
});
test('real service reports mismatch and preserves expected hash in guarded update',async()=>{
 const pool=poolFor([{...file}]);const report=await runIntegrityWithPool(pool,{...env,FIXITY_BATCH_SIZE:'1'},{fetchImpl:async()=>new Response('different bytes',{status:200})});
 assert.equal(report.status,'attention');assert.equal(report.summary.mismatched,1);
 const update=pool.statements.find(row=>row.sql.startsWith('UPDATE file_attachments'));assert.equal(update.args[1],'mismatch');assert.equal(update.args[2],hash);
});
test('reader failure persists stable error via service without raw credential text',async()=>{
 const pool=poolFor([{...file}]);const report=await runIntegrityWithPool(pool,{...env,FIXITY_BATCH_SIZE:'1'},{fetchImpl:async()=>{throw new Error('secret-token-value');}});
 assert.equal(report.status,'attention');assert.equal(report.summary.failed,1);assert.equal(JSON.stringify(report).includes('secret-token-value'),false);
 const audit=pool.statements.find(row=>row.sql.includes('INSERT INTO audit_log'));assert.equal(JSON.parse(audit.args[1]).errorCode,'READ_FAILED');
});
