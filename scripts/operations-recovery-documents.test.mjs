import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seal,unseal,pinnedPrivateUrl,parseCopyTable,documentReferences,backupDocuments,restoreDocuments,sha256,privateBlobConfiguration } from './operations-recovery-documents.mjs';
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
