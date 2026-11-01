import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seal,unseal,pinnedPrivateUrl,parseCopyTable,documentReferences,documentBudgetUsage,documentBudgetAnnotation,DOCUMENT_BUDGET,backupDocuments,restoreDocuments,sha256,privateBlobConfiguration } from './operations-recovery-documents.mjs';
const token='vercel_blob_rw_teststore123_secret', url='https://teststore123.private.blob.vercel-storage.com/test.pdf';
const bytes=Buffer.from('synthetic recovery test bytes'),hash=sha256(bytes),archive='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
const reference={id,kind:'attachment',entityType:'arsip',entityId:id,url,sha256:hash,sizeBytes:bytes.length,storageAccess:'private'};
test('Vercel control-plane store identifier is distinct from the token hostname',()=>{
 const result=privateBlobConfiguration({SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:token,SIMSA_PRIVATE_BLOB_STORE_ID:'store_oCG80crbZI1PLMP4'});
 assert.equal(result.hostname,'teststore123.private.blob.vercel-storage.com');
 assert.equal(pinnedPrivateUrl(url,result.token).hostname,result.hostname);
 assert.throws(()=>pinnedPrivateUrl('https://store_ocg80crbzi1plmp4.private.blob.vercel-storage.com/test.pdf',result.token));
});
test('authenticated encryption rejects tampering, wrong key and changed database binding',()=>{
 const key=randomBytes(32),encrypted=seal(bytes,key,'context');assert.deepEqual(unseal(encrypted,key,'context'),bytes);
 assert.throws(()=>unseal(encrypted,randomBytes(32),'context'));assert.throws(()=>unseal(encrypted,key,'other'));
 encrypted[15]^=1;assert.throws(()=>unseal(encrypted,key,'context'));
});
test('envelope bound admits the largest allowed document and nothing larger',()=>{
 const key=randomBytes(32),largest=seal(Buffer.alloc(DOCUMENT_BUDGET.maxObjectBytes),key,'context');
 assert.equal(unseal(largest,key,'context').length,DOCUMENT_BUDGET.maxObjectBytes);
 assert.throws(()=>unseal(Buffer.concat([largest,Buffer.alloc(1)]),key,'context'),/INVALID_ENVELOPE/);
});
const mib=1024*1024,row=(n,size,name=n)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,file_url:`https://teststore123.private.blob.vercel-storage.com/${name}.pdf`,sha256:sha256(String(name)),size_bytes:size,storage_access:'private'});
test('document budget counts unique stored objects, keeps the reference sanity bound, and warns at 75 percent',()=>{
 const shared=documentBudgetUsage(documentReferences(Array.from({length:5},(_,n)=>row(n,50*mib,'shared')),[]));
 assert.deepEqual([shared.references,shared.objects,shared.bytes],[5,1,50*mib]);
 const full=[row(0,50*mib),row(1,50*mib),row(2,50*mib),row(3,10*mib)];
 assert.equal(documentReferences(full,[]).length,4);assert.equal(documentBudgetUsage(documentReferences(full,[])).bytes,DOCUMENT_BUDGET.maxTotalBytes);
 assert.throws(()=>documentReferences([...full,row(4,1)],[]),/DOCUMENT_BYTES_OUTSIDE_BUDGET/);
 const many=Array.from({length:DOCUMENT_BUDGET.maxObjects},(_,n)=>row(n,1));
 assert.equal(documentReferences(many,[]).length,100);assert.throws(()=>documentReferences([...many,row(100,1)],[]),/DOCUMENT_OBJECTS_OUTSIDE_BUDGET/);
 assert.equal(documentBudgetUsage(documentReferences(many.slice(0,74),[])).ratioWarning,false);assert.equal(documentBudgetUsage(documentReferences(many.slice(0,75),[])).ratioWarning,true);
 assert.equal(documentReferences(Array.from({length:1000},(_,n)=>row(n,1,'shared')),[]).length,1000);
 assert.throws(()=>documentReferences(Array.from({length:1001},(_,n)=>row(n,1,'shared')),[]),/DOCUMENT_COUNT_OUTSIDE_BUDGET/);
 assert.throws(()=>documentReferences([row(0,1,'shared'),row(1,2,'shared')],[]),/CONFLICTING_DOCUMENT_REFERENCES/);
});
test('budget warns once the room left is smaller than one bulk-upload batch, which a 75 percent ratio alone misses',()=>{
 const batch=DOCUMENT_BUDGET.bulkUploadBatch,perFile=Math.floor(batch.bytes/batch.objects);
 // 19 unique objects, 77,723,422 bytes: below 75 percent, yet one batch more fails the hard check.
 const today=Array.from({length:19},(_,n)=>row(n,n<18?4090706:77723422-18*4090706));
 const usage=documentBudgetUsage(documentReferences(today,[]));
 assert.deepEqual([usage.objects,usage.bytes,usage.ratioWarning,usage.headroomWarning,usage.warning],[19,77723422,false,true,true]);
 assert.equal(usage.bytesHeadroom,DOCUMENT_BUDGET.maxTotalBytes-77723422);
 const oneBatch=Array.from({length:batch.objects},(_,n)=>row(100+n,perFile));
 assert.throws(()=>documentReferences([...today,...oneBatch],[]),error=>error.safeCode==='DOCUMENT_BYTES_OUTSIDE_BUDGET'
  &&error.documentBudget.objects===69&&error.documentBudget.bytes===77723422+batch.objects*perFile&&error.documentBudget.bytesHeadroom<0);
 // Bytes: exactly one batch of room is quiet, one byte less warns.
 const shortBy=extra=>documentBudgetUsage(documentReferences([row(0,30*mib),row(1,DOCUMENT_BUDGET.maxTotalBytes-batch.bytes-30*mib+extra)],[]));
 assert.equal(shortBy(0).bytesHeadroom,batch.bytes);assert.equal(shortBy(0).warning,false);assert.equal(shortBy(1).headroomWarning,true);
 // Objects: 50 objects leave room for one batch, 51 do not, both below the 75 percent ratio.
 const objects=n=>documentBudgetUsage(documentReferences(Array.from({length:n},(_,i)=>row(i,1)),[]));
 assert.equal(objects(50).warning,false);assert.deepEqual([objects(51).ratioWarning,objects(51).headroomWarning],[false,true]);
 assert.throws(()=>documentReferences(Array.from({length:101},(_,i)=>row(i,1)),[]),error=>error.safeCode==='DOCUMENT_OBJECTS_OUTSIDE_BUDGET'&&error.documentBudget.objects===101);
});
test('budget annotation states the numbers and the one-batch risk without workflow-command escapes',()=>{
 const today=documentBudgetUsage(documentReferences(Array.from({length:19},(_,n)=>row(n,n<18?4090706:77723422-18*4090706)),[]));
 const warning=documentBudgetAnnotation(today);
 assert.match(warning,/^::warning title=SIMSA backup mendekati batas::19\/100 objek unik, 74\.1\/160\.0 MiB, 19\/1000 referensi\. Sisa ruang \(81 objek, 85\.9 MiB\) lebih kecil dari satu batch unggah massal \(50 berkas, 100\.0 MiB\)/);
 assert.equal(documentBudgetAnnotation(documentBudgetUsage(documentReferences([row(0,mib)],[]))),null);
 assert.match(documentBudgetAnnotation(documentBudgetUsage(documentReferences([row(0,mib)],[])),{failed:true}),/^::error title=SIMSA backup melewati batas dokumen::1\/100 objek unik/);
 for(const line of [warning,documentBudgetAnnotation(today,{failed:true})])assert.doesNotMatch(line,/[%\r\n]/);
});
test('bulk-upload batch mirrors the backend and frontend upload limits',async()=>{
 const limits=async path=>{const source=await readFile(new URL(path,import.meta.url),'utf8');
  const block=/BULK_UPLOAD_LIMITS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source)?.[1]??'';
  const files=Number(/maxFiles:\s*(\d+),/.exec(block)?.[1]);
  const bytes=(/maxBatchBytes:\s*([\d\s*]+),/.exec(block)?.[1]??'0').split('*').reduce((product,factor)=>product*Number(factor),1);
  return {objects:files,bytes};};
 for(const path of ['../backend/src/services/bulk-upload.service.ts','../frontend/src/hooks/useOCRUpload.js'])assert.deepEqual(await limits(path),{...DOCUMENT_BUDGET.bulkUploadBatch});
});
test('private URL pins exact store before any authenticated fetch',()=>{
 assert.equal(pinnedPrivateUrl(url,token).search,'?cache=0');
 for(const bad of ['https://otherstore.private.blob.vercel-storage.com/x','https://teststore123.public.blob.vercel-storage.com/x','http://teststore123.private.blob.vercel-storage.com/x',url+'?redirect=x',url+'#x','https://user@teststore123.private.blob.vercel-storage.com/x'])assert.throws(()=>pinnedPrivateUrl(bad,token));
});
test('COPY decoder preserves escaped tabs, newlines and nulls',()=>{
 const sql='COPY public.sample (id, value, missing) FROM stdin;\n1\tline\\tand\\nnext\\\\end\t\\N\n\\.\n';
 assert.deepEqual(parseCopyTable(sql,'sample'),[{id:'1',value:'line\tand\nnext\\end',missing:null}]);assert.throws(()=>parseCopyTable(sql,'missing'));
});
test('COPY final row preserves empty and whitespace-only final cells',()=>{
 assert.deepEqual(parseCopyTable('COPY public.sample (id, value) FROM stdin;\n1\t\n\\.\n','sample'),[{id:'1',value:''}]);
 assert.deepEqual(parseCopyTable('COPY public.sample (value) FROM stdin;\n   \n\\.\n','sample'),[{value:'   '}]);
 assert.deepEqual(parseCopyTable('COPY public.sample (value) FROM stdin;\n\n\\.\n','sample'),[{value:''}]);
});
test('regulatory-source-only database has a valid document backup and restore',async()=>{
 const root=await mkdtemp(join(tmpdir(),'simsa-regdoc-unit-')),key=randomBytes(32),directory=join(root,'backup');
 const references=documentReferences([],[{id,source_document_blob_url:url,source_document_sha256:hash,source_document_size_bytes:bytes.length}]);
 await backupDocuments({references,token,directory,key,archiveSha256:archive,fetchImpl:async()=>new Response(bytes,{status:200})});
 const proof=await restoreDocuments({directory,key,targetDirectory:join(root,'restored'),targetKey:randomBytes(32),expectedArchiveSha256:archive});
 assert.equal(proof.restoredObjects,1);assert.equal(proof.allHashesMatch,true);
});
test('missing historical hash needs explicit capture policy; malformed hash never accepted',()=>{
 const row={id,file_url:url,sha256:null,size_bytes:bytes.length,storage_access:'private'};
 assert.throws(()=>documentReferences([row],[]));assert.equal(documentReferences([row],[],{captureMissingHashes:true}).length,1);
 assert.throws(()=>documentReferences([{...row,sha256:'broken'}],[],{captureMissingHashes:true}));
});
test('backup and actual encrypted restore verify authenticated downloads and deny anonymous',async()=>{
 const root=await mkdtemp(join(tmpdir(),'simsa-doc-unit-')),key=randomBytes(32),targetKey=randomBytes(32);
 const directory=join(root,'backup');let calls=0;
 const result=await backupDocuments({references:[reference],token,directory,key,sourceSnapshotAt:new Date().toISOString(),archiveSha256:archive,
   fetchImpl:async(target,options)=>{calls++;assert.equal(target.hostname,'teststore123.private.blob.vercel-storage.com');assert.equal(options.redirect,'error');return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});}});
 assert.equal(calls,1);assert.equal(result.objects,1);
 const restored=await restoreDocuments({directory,key,targetDirectory:join(root,'restored'),targetKey,expectedArchiveSha256:archive});
 assert.equal(restored.allHashesMatch,true);assert.equal(restored.authorizedDownloads,1);assert.equal(restored.unauthorizedDenied,true);assert.equal(restored.applicationRbacRetested,false);
 await assert.rejects(restoreDocuments({directory,key,targetDirectory:join(root,'wrong-db'),targetKey,expectedArchiveSha256:'b'.repeat(64)}));
 const path=join(directory,sha256(url)+'.aesgcm'),cipher=await readFile(path);cipher[14]^=1;await writeFile(path,cipher);
 await assert.rejects(restoreDocuments({directory,key,targetDirectory:join(root,'tampered'),targetKey,expectedArchiveSha256:archive}));
});
test('existing hash mismatch fails closed and null historical hash is separately captured',async()=>{
 const root=await mkdtemp(join(tmpdir(),'simsa-doc-unit-')),key=randomBytes(32),fetchImpl=async()=>new Response(bytes,{status:200});
 await assert.rejects(backupDocuments({references:[{...reference,sha256:'b'.repeat(64)}],token,directory:join(root,'bad'),key,archiveSha256:archive,fetchImpl}));
 const result=await backupDocuments({references:[{...reference,sha256:null}],token,directory:join(root,'captured'),key,archiveSha256:archive,captureMissingHashes:true,fetchImpl});
 assert.equal(result.existingHashReferences,0);assert.equal(result.capturedHashReferences,1);
});
