import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seal,unseal,pinnedPrivateUrl,parseCopyTable,documentReferences,documentBudgetUsage,documentBudgetAnnotation,documentBudgetFailureMessage,documentBudgetFromEnvironment,DOCUMENT_BUDGET,DOCUMENT_BUDGET_DEFAULTS,DOCUMENT_BUDGET_SETTINGS,DOCUMENT_BUDGET_CEILINGS,backupDocuments,restoreDocuments,sha256,privateBlobConfiguration } from './operations-recovery-documents.mjs';
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
// A small explicit budget keeps the boundary cases cheap and proves every limit is a setting, not a constant.
const small=Object.freeze({maxReferences:2000,maxObjects:1000,maxTotalBytes:1024*mib});
const refs=(rows,limits=small)=>documentReferences(rows,[],{limits}),used=(rows,limits=small)=>documentBudgetUsage(refs(rows,limits),limits);
test('document budget defaults are named settings sized for months of daily use and bounded by ceilings',()=>{
 assert.deepEqual({...DOCUMENT_BUDGET_DEFAULTS},{maxReferences:10000,maxObjects:5000,maxTotalBytes:4*1024*mib});
 assert.deepEqual({...DOCUMENT_BUDGET_SETTINGS},{maxReferences:'OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES',maxObjects:'OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS',maxTotalBytes:'OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES'});
 assert.equal(DOCUMENT_BUDGET.warningRatio,0.8);
 for(const key of Object.keys(DOCUMENT_BUDGET_DEFAULTS)){assert.equal(DOCUMENT_BUDGET[key],DOCUMENT_BUDGET_DEFAULTS[key]);assert.ok(DOCUMENT_BUDGET_CEILINGS[key]>=DOCUMENT_BUDGET_DEFAULTS[key]);}
 // The 19 objects / 77,723,422 bytes of 31 October 2026 use under 2 percent of every default.
 const today=documentBudgetUsage(documentReferences(Array.from({length:19},(_,n)=>row(n,n<18?4090706:77723422-18*4090706)),[]));
 assert.ok(Math.max(today.referencesRatio,today.objectsRatio,today.bytesRatio)<0.02);assert.equal(today.exceeded,null);
 // Without an explicit budget the defaults apply: 5,000 objects fit, 5,001 do not.
 const many=Array.from({length:5001},(_,n)=>row(n,1));
 assert.equal(documentReferences(many.slice(0,5000),[]).length,5000);assert.throws(()=>documentReferences(many,[]),/DOCUMENT_OBJECTS_OUTSIDE_BUDGET/);
});
test('workflow environment overrides each limit and a mistyped value stops the run',()=>{
 assert.deepEqual(documentBudgetFromEnvironment({}),DOCUMENT_BUDGET_DEFAULTS);
 // GitHub passes an unset repository variable as an empty string.
 assert.deepEqual(documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES:'',OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS:'',OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES:''}),DOCUMENT_BUDGET_DEFAULTS);
 assert.deepEqual({...documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES:String(8*1024*mib),OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS:'9000'})},
  {maxReferences:10000,maxObjects:9000,maxTotalBytes:8*1024*mib});
 assert.equal(documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES:'40000'}).maxReferences,40000);
 for(const [setting,value] of [['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES','4GiB'],['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES','4294967296.0'],['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES',' 4294967296'],
  ['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES','0'],['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES',String(100*mib-1)],['OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES',String(16*1024*mib+1)],
  ['OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS','-5'],['OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS','49'],['OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS','20001'],
  ['OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES','1e4'],['OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES','40001']])
  assert.throws(()=>documentBudgetFromEnvironment({[setting]:value}),error=>error.safeCode==='DOCUMENT_BUDGET_SETTING_INVALID'&&error.documentBudgetSetting===setting,`${setting}=${value}`);
 // A raised limit admits what the default refuses.
 const many=Array.from({length:5001},(_,n)=>row(n,1));
 assert.equal(documentReferences(many,[],{limits:documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS:'6000'})}).length,5001);
});
test('document budget counts unique stored objects, keeps the reference sanity bound, and warns at 80 percent',()=>{
 const shared=used(Array.from({length:5},(_,n)=>row(n,50*mib,'shared')));
 assert.deepEqual([shared.references,shared.objects,shared.bytes,shared.exceeded],[5,1,50*mib,null]);
 const full=[...Array.from({length:20},(_,n)=>row(n,50*mib)),row(20,24*mib)];
 assert.equal(refs(full).length,21);assert.equal(used(full).bytes,small.maxTotalBytes);
 assert.throws(()=>refs([...full,row(21,1)]),/DOCUMENT_BYTES_OUTSIDE_BUDGET/);
 const many=Array.from({length:small.maxObjects},(_,n)=>row(n,1));
 assert.equal(refs(many).length,1000);assert.throws(()=>refs([...many,row(1000,1)]),/DOCUMENT_OBJECTS_OUTSIDE_BUDGET/);
 assert.equal(used(many.slice(0,799)).ratioWarning,false);assert.equal(used(many.slice(0,800)).ratioWarning,true);
 // 80 percent of the byte and reference limits warns too, and still returns every reference.
 assert.equal(used([...Array.from({length:16},(_,n)=>row(n,50*mib)),row(16,19*mib)]).ratioWarning,false);
 assert.equal(used([...Array.from({length:16},(_,n)=>row(n,50*mib)),row(16,20*mib)]).ratioWarning,true);
 assert.equal(used(Array.from({length:1599},(_,n)=>row(n,1,'shared'))).ratioWarning,false);assert.equal(used(Array.from({length:1600},(_,n)=>row(n,1,'shared'))).ratioWarning,true);
 assert.equal(refs(Array.from({length:2000},(_,n)=>row(n,1,'shared'))).length,2000);
 assert.throws(()=>refs(Array.from({length:2001},(_,n)=>row(n,1,'shared'))),error=>error.safeCode==='DOCUMENT_COUNT_OUTSIDE_BUDGET'
  &&error.documentBudget.references===2001&&error.documentBudget.exceeded.setting==='OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES');
 assert.throws(()=>refs([]),/DOCUMENT_COUNT_OUTSIDE_BUDGET/);
 assert.throws(()=>refs([row(0,1,'shared'),row(1,2,'shared')]),/CONFLICTING_DOCUMENT_REFERENCES/);
});
test('budget warns once the room left is smaller than one bulk-upload batch',()=>{
 const batch=DOCUMENT_BUDGET.bulkUploadBatch,perFile=Math.floor(batch.bytes/batch.objects);
 // 19 unique objects, 77,723,422 bytes on 31 October 2026: far from every limit, and one more batch still fits.
 const today=Array.from({length:19},(_,n)=>row(n,n<18?4090706:77723422-18*4090706));
 const usage=used(today);
 assert.deepEqual([usage.objects,usage.bytes,usage.ratioWarning,usage.headroomWarning,usage.warning],[19,77723422,false,false,false]);
 assert.equal(usage.bytesHeadroom,small.maxTotalBytes-77723422);
 assert.equal(refs([...today,...Array.from({length:batch.objects},(_,n)=>row(100+n,perFile))]).length,69);
 // A hard failure carries its usage record and names the limit and its setting.
 assert.throws(()=>refs([...Array.from({length:20},(_,n)=>row(n,50*mib)),row(20,24*mib),row(21,1)]),error=>error.safeCode==='DOCUMENT_BYTES_OUTSIDE_BUDGET'
  &&error.documentBudget.objects===22&&error.documentBudget.bytesHeadroom===-1
  &&error.documentBudget.exceeded.limit==='maxTotalBytes'&&error.documentBudget.exceeded.setting==='OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES');
 // Bytes: exactly one batch of room is quiet, one byte less warns.
 const shortBy=extra=>used([...Array.from({length:18},(_,n)=>row(n,50*mib)),row(18,small.maxTotalBytes-batch.bytes-18*50*mib+extra)]);
 assert.equal(shortBy(0).bytesHeadroom,batch.bytes);assert.equal(shortBy(0).headroomWarning,false);assert.equal(shortBy(1).headroomWarning,true);
 // Objects: room for exactly one batch is quiet, one object more warns.
 const objects=n=>used(Array.from({length:n},(_,i)=>row(i,1)));
 assert.equal(objects(950).headroomWarning,false);assert.equal(objects(951).headroomWarning,true);
 assert.throws(()=>refs(Array.from({length:1001},(_,i)=>row(i,1))),error=>error.safeCode==='DOCUMENT_OBJECTS_OUTSIDE_BUDGET'&&error.documentBudget.objects===1001
  &&error.documentBudget.exceeded.setting==='OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS');
});
test('budget annotation states the numbers and the one-batch risk without workflow-command escapes',()=>{
 const today=used(Array.from({length:19},(_,n)=>row(n,n<18?4090706:77723422-18*4090706)));
 assert.equal(documentBudgetAnnotation(today),null);
 const nearFull=used([...Array.from({length:19},(_,n)=>row(n,50*mib)),row(19,10*mib)]);
 const warning=documentBudgetAnnotation(nearFull);
 assert.match(warning,/^::warning title=SIMSA backup mendekati batas::20\/1000 objek unik, 960\.0\/1024\.0 MiB, 20\/2000 referensi\. Sisa ruang \(980 objek, 64\.0 MiB\) lebih kecil dari satu batch unggah massal \(50 berkas, 100\.0 MiB\)/);
 assert.match(warning,/Backup run ini tetap lengkap\./);
 for(const line of [warning,documentBudgetAnnotation(today,{failed:true})])assert.doesNotMatch(line,/[%\r\n]/);
});
test('a crossed limit fails loudly: which limit, what was measured, what was lost and how to raise it',()=>{
 const failure=rows=>{try{refs(rows);}catch(error){return error.documentBudget;}throw new Error('expected a budget failure');};
 const bytes=documentBudgetFailureMessage(failure([...Array.from({length:20},(_,n)=>row(n,50*mib)),row(20,25*mib)]));
 assert.equal(bytes,'Ukuran total objek unik 1025.0 MiB (1074790400 byte) melewati batas 1024.0 MiB (1073741824 byte). Run ini TIDAK mencadangkan dokumen apa pun; hanya database terenkripsi yang tersimpan. '
  +'Pemakaian: 21/1000 objek unik, 1025.0/1024.0 MiB, 21/2000 referensi. Untuk menaikkan batas, isi variabel OPERATIONS_RECOVERY_MAX_DOCUMENT_BYTES pada environment production-recovery dengan angka yang lebih besar, lalu jalankan ulang. Lihat docs/OPERATIONS_RECOVERY.md.');
 const objects=failure(Array.from({length:1001},(_,n)=>row(n,1)));
 assert.match(documentBudgetFailureMessage(objects),/^Jumlah objek unik 1001 melewati batas 1000\. Run ini TIDAK mencadangkan dokumen apa pun.*isi variabel OPERATIONS_RECOVERY_MAX_DOCUMENT_OBJECTS /);
 assert.match(documentBudgetFailureMessage(failure(Array.from({length:2001},(_,n)=>row(n,1,'shared')))),/^Jumlah referensi dokumen 2001 melewati batas 2000\..*isi variabel OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES /);
 const annotation=documentBudgetAnnotation(objects,{failed:true});
 assert.equal(annotation,`::error title=SIMSA backup melewati batas dokumen::${documentBudgetFailureMessage(objects)}`);
 assert.doesNotMatch(annotation,/[%\r\n]|teststore|\.pdf/);
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
test('a backup made with a raised limit restores without repeating the setting',async()=>{
 const root=await mkdtemp(join(tmpdir(),'simsa-raised-unit-')),key=randomBytes(32),directory=join(root,'backup');
 const rows=Array.from({length:DOCUMENT_BUDGET_DEFAULTS.maxReferences+1},(_,n)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,entity_type:'arsip',entity_id:id,file_url:url,sha256:hash,size_bytes:bytes.length,storage_access:'private'}));
 assert.throws(()=>documentReferences(rows,[]),/DOCUMENT_COUNT_OUTSIDE_BUDGET/);
 const references=documentReferences(rows,[],{limits:documentBudgetFromEnvironment({OPERATIONS_RECOVERY_MAX_DOCUMENT_REFERENCES:'12000'})});
 const backup=await backupDocuments({references,token,directory,key,archiveSha256:archive,fetchImpl:async()=>new Response(bytes,{status:200})});
 assert.deepEqual([backup.references,backup.objects,backup.sourceGetRequests],[10001,1,1]);
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
