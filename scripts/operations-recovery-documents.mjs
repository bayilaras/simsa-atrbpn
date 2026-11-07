import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { safeCode: code }); };
const MAX_OBJECT = 50 * 1024 * 1024;
// Hard, reviewed budgets. Every run GETs each unique stored object once with
// cache=0 (one Blob simple operation plus its bytes as data transfer), so bytes
// and objects are counted after URL deduplication. Sized for the Vercel Pro
// plan, where Blob usage is billed instead of blocked, and the 60-minute job
// timeout; never use these limits on Hobby (10 GB transfer and 10,000 simple
// operations per 30 days, then Blob is blocked for 30 days). References stay a
// separate metadata sanity bound. Raise only after the owner review described
// in docs/OPERATIONS_RECOVERY.md.
const MAX_TOTAL = 1024 * 1024 * 1024;
const MAX_OBJECTS = 1000;
const MAX_COUNT = 2000;
// One envelope seals one document; the manifest and wrapped keys are far smaller.
const MAX_ENVELOPE = MAX_OBJECT + 28;
// Largest single user action: one confirmed bulk-upload batch, mirroring
// BULK_UPLOAD_LIMITS in the backend bulk-upload service and the upload hook.
const BULK_UPLOAD_BATCH = Object.freeze({ objects: 50, bytes: 100 * 1024 * 1024 });
export const DOCUMENT_BUDGET = Object.freeze({ maxReferences: MAX_COUNT, maxObjects: MAX_OBJECTS, maxObjectBytes: MAX_OBJECT, maxTotalBytes: MAX_TOTAL,
  warningRatio: 0.75, bulkUploadBatch: BULK_UPLOAD_BATCH });
function uniqueDocuments(references) {
  const unique = new Map();
  for (const ref of references) { const prior = unique.get(ref.url);
    check(!prior || prior.sha256 === ref.sha256 && prior.sizeBytes === ref.sizeBytes, 'CONFLICTING_DOCUMENT_REFERENCES'); if (!prior) unique.set(ref.url, ref); }
  return [...unique.values()];
}
// Measured like the hard check in documentReferences. A ratio alone cannot
// predict that failure: one bulk-upload batch between two daily runs can take
// usage from below the ratio straight past a limit. The headroom warning
// therefore also fires whenever the room left is smaller than one batch.
export function documentBudgetUsage(references) {
  const objects = uniqueDocuments(references), bytes = objects.reduce((sum, ref) => sum + ref.sizeBytes, 0);
  const referencesRatio = references.length / MAX_COUNT, objectsRatio = objects.length / MAX_OBJECTS, bytesRatio = bytes / MAX_TOTAL;
  const referencesHeadroom = MAX_COUNT - references.length, objectsHeadroom = MAX_OBJECTS - objects.length, bytesHeadroom = MAX_TOTAL - bytes;
  const ratioWarning = Math.max(referencesRatio, objectsRatio, bytesRatio) >= DOCUMENT_BUDGET.warningRatio;
  const headroomWarning = referencesHeadroom < BULK_UPLOAD_BATCH.objects || objectsHeadroom < BULK_UPLOAD_BATCH.objects || bytesHeadroom < BULK_UPLOAD_BATCH.bytes;
  return { references: references.length, objects: objects.length, bytes, maxReferences: MAX_COUNT, maxObjects: MAX_OBJECTS, maxTotalBytes: MAX_TOTAL,
    referencesRatio, objectsRatio, bytesRatio, referencesHeadroom, objectsHeadroom, bytesHeadroom, ratioWarning, headroomWarning, warning: ratioWarning || headroomWarning };
}
const mib = bytes => (bytes / (1024 * 1024)).toFixed(1);
// GitHub Actions annotation for a usage record, or null when nothing needs attention.
// Numbers only (no '%', no newline), so the workflow command needs no escaping.
export function documentBudgetAnnotation(usage, { failed = false } = {}) {
  if (!failed && !usage.warning) return null;
  const numbers = `${usage.objects}/${usage.maxObjects} objek unik, ${mib(usage.bytes)}/${mib(usage.maxTotalBytes)} MiB, ${usage.references}/${usage.maxReferences} referensi`;
  if (failed) return `::error title=SIMSA backup melewati batas dokumen::${numbers}. Dokumen tidak dicadangkan pada run ini. Lihat docs/OPERATIONS_RECOVERY.md.`;
  const batch = usage.headroomWarning ? ` Sisa ruang (${usage.objectsHeadroom} objek, ${mib(usage.bytesHeadroom)} MiB) lebih kecil dari satu batch unggah massal (${BULK_UPLOAD_BATCH.objects} berkas, ${mib(BULK_UPLOAD_BATCH.bytes)} MiB); satu unggahan massal dapat membuat backup berikutnya gagal tanpa peringatan lain.` : '';
  return `::warning title=SIMSA backup mendekati batas::${numbers}.${batch} Tinjau kuota Blob dan batas di docs/OPERATIONS_RECOVERY.md.`;
}
export function seal(bytes, key, context) {
  check(Buffer.isBuffer(key) && key.length === 32, 'INVALID_KEY');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  return Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
export function unseal(bytes, key, context) {
  check(bytes.length >= 28 && bytes.length <= MAX_ENVELOPE, 'INVALID_ENVELOPE');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
}
export function privateBlobConfiguration(environment) {
  const token=environment.SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN;
  const match=/^vercel_blob_rw_([a-z0-9]{8,64})_[a-z0-9_-]+$/i.exec(token||'');
  check(match,'INVALID_BLOB_TOKEN_SHAPE');
  const hostname=`${match[1].toLowerCase()}.private.blob.vercel-storage.com`;
  // Vercel's control-plane store_<id> is not the host prefix in the token.
  // Source URLs are bound below; an optional independently pinned host can also
  // constrain fixed-path status publication. Never compare control-plane IDs.
  const expected=environment.OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME;
  if(expected)check(expected.toLowerCase()===hostname,'PRIVATE_STORE_HOSTNAME_MISMATCH');
  return {token,hostname};
}
export function pinnedPrivateUrl(value, token) {
  const {hostname}=privateBlobConfiguration({SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN:token});
  let url; try { url = new URL(value); } catch { throw Object.assign(new Error('INVALID_DOCUMENT_URL'), {safeCode:'INVALID_DOCUMENT_URL'}); }
  check(url.protocol === 'https:' && url.hostname.toLowerCase() === hostname
    && !url.port && !url.username && !url.password && !url.search && !url.hash, 'DOCUMENT_STORE_NOT_PINNED');
  url.searchParams.set('cache', '0'); return url;
}
export function parseCopyTable(sql, table) {
  check(/^[a-z_]+$/.test(table), 'INVALID_TABLE');
  const match = new RegExp(`^COPY public\\.${table} \\(([^)]+)\\) FROM stdin;\\r?\\n([\\s\\S]*?)^\\\\\\.\\r?$`, 'm').exec(sql);
  check(match, 'COPY_TABLE_MISSING');
  const columns = match[1].split(', ').map(value => value.replaceAll('"', ''));
  const decode = value => value === '\\N' ? null : value.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g, (_, escape) =>
    /^[0-7]+$/.test(escape) ? String.fromCharCode(parseInt(escape, 8)) : /^x[0-9a-fA-F]+$/.test(escape) ? String.fromCharCode(parseInt(escape.slice(1), 16)) : ({b:'\b',f:'\f',n:'\n',r:'\r',t:'\t',v:'\v','\\':'\\'}[escape] ?? escape));
  const lines=match[2]===''?[]:match[2].replace(/\r?\n$/,'').split(/\r?\n/);
  return lines.map(line => { const cells = line.split('\t');
    check(cells.length === columns.length, 'COPY_ROW_WIDTH'); return Object.fromEntries(columns.map((key, i) => [key, decode(cells[i])])); });
}
export function documentReferences(attachments, ruleSets, {captureMissingHashes=false}={}) {
  const refs = attachments.map(row => ({id:row.id, kind:'attachment', entityType:row.entity_type, entityId:row.entity_id,
    url:row.file_url, sha256:row.sha256?.toLowerCase(), sizeBytes:Number(row.size_bytes), storageAccess:row.storage_access,
    fileName:row.file_name ?? null}));
  for (const row of ruleSets) if (row.source_document_blob_url) refs.push({id:row.id,kind:'regulatory_source',url:row.source_document_blob_url,
    sha256:row.source_document_sha256?.toLowerCase(),sizeBytes:Number(row.source_document_size_bytes),storageAccess:'private'});
  check(refs.length > 0 && refs.length <= MAX_COUNT, 'DOCUMENT_COUNT_OUTSIDE_BUDGET');
  for (const ref of refs) check(/^[a-f0-9-]{36}$/i.test(ref.id) && (/^[a-f0-9]{64}$/.test(ref.sha256 || '') || captureMissingHashes && ref.sha256 == null)
    && Number.isSafeInteger(ref.sizeBytes) && ref.sizeBytes > 0 && ref.sizeBytes <= MAX_OBJECT && ref.storageAccess === 'private', 'DOCUMENT_METADATA_INCOMPLETE');
  const usage = documentBudgetUsage(refs);
  // The usage record (counts and sizes only) travels with the failure so a red run still reports its numbers.
  const over = usage.objects > MAX_OBJECTS ? 'DOCUMENT_OBJECTS_OUTSIDE_BUDGET' : usage.bytes > MAX_TOTAL ? 'DOCUMENT_BYTES_OUTSIDE_BUDGET' : null;
  if (over) throw Object.assign(new Error(over), { safeCode: over, documentBudget: usage });
  return refs;
}
async function exclusiveDirectory(path) {
  await mkdir(path, {mode:0o700});
  const info=await lstat(path); check(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_DOCUMENT_DIRECTORY');
}
export async function backupDocuments({references, token, directory, key, sourceSnapshotAt, archiveSha256, captureMissingHashes=false, fetchImpl=fetch, applicationReader}) {
  await exclusiveDirectory(directory);
  const objects=[]; let requests=0;
  for (const ref of uniqueDocuments(references)) {
    // An operator recovery can use an authenticated application route when a
    // sensitive managed storage token cannot be exported. Its reader is local
    // trusted code; the default scheduled path always pins the private store.
    const response=applicationReader ? await applicationReader(ref) : await fetchImpl(pinnedPrivateUrl(ref.url, token),
      {method:'GET',redirect:'error',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)}); requests++;
    check(response.status === 200 && response.body, 'DOCUMENT_GET_FAILED');
    const length=response.headers.get('content-length'); if(length)check(Number(length)===ref.sizeBytes,'DOCUMENT_LENGTH_MISMATCH');
    const chunks=[];let size=0;
    try { for await(const chunk of response.body){size+=chunk.length;check(size<=ref.sizeBytes && size<=MAX_OBJECT,'DOCUMENT_BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
      const bytes=Buffer.concat(chunks);
      try { const capturedHash=sha256(bytes);
        check(bytes.length===ref.sizeBytes && (ref.sha256 ? capturedHash===ref.sha256 : captureMissingHashes),'DOCUMENT_HASH_MISMATCH');
        const objectId=sha256(ref.url), context=`simsa-document-v1:${archiveSha256}:${objectId}`;
        await writeFile(join(directory,`${objectId}.aesgcm`),seal(bytes,key,context),{flag:'wx',mode:0o600});
        objects.push({...ref,sourceSha256:ref.sha256??null,sha256:capturedHash,hashBasis:ref.sha256?'existing_database_hash':'captured_at_backup',objectId,context});
      } finally {bytes.fill(0);} }
    finally {chunks.forEach(chunk=>chunk.fill(0));}
  }
  const manifest={schemaVersion:1,sourceSnapshotAt,archiveSha256,references,objects};
  const plaintext=Buffer.from(JSON.stringify(manifest));
  try {await writeFile(join(directory,'manifest.aesgcm'),seal(plaintext,key,'simsa-document-manifest-v1'),{flag:'wx',mode:0o600});}
  finally {plaintext.fill(0);}
  return {references:references.length,objects:objects.length,totalBytes:objects.reduce((sum,row)=>sum+row.sizeBytes,0),sourceGetRequests:requests,
    existingHashReferences:references.filter(row=>row.sha256).length,capturedHashReferences:references.filter(row=>!row.sha256).length,sourceTransport:applicationReader?'authenticated_application':'pinned_private_blob'};
}
export async function restoreDocuments({directory,key,targetDirectory,targetKey,expectedArchiveSha256}) {
  const manifestBytes=unseal(await readFile(join(directory,'manifest.aesgcm')),key,'simsa-document-manifest-v1');
  let manifest;try{manifest=JSON.parse(manifestBytes);}finally{manifestBytes.fill(0);}
  check(manifest.schemaVersion===1 && manifest.archiveSha256===expectedArchiveSha256,'DOCUMENT_DATABASE_BINDING_MISMATCH');
  const expected=documentReferences(manifest.references.filter(r=>r.kind==='attachment').map(r=>({id:r.id,entity_type:r.entityType,entity_id:r.entityId,file_url:r.url,sha256:r.sha256,size_bytes:r.sizeBytes,storage_access:r.storageAccess})),
    manifest.references.filter(r=>r.kind==='regulatory_source').map(r=>({id:r.id,source_document_blob_url:r.url,source_document_sha256:r.sha256,source_document_size_bytes:r.sizeBytes})),{captureMissingHashes:true});
  check(expected.length===manifest.references.length && manifest.objects.length>0,'DOCUMENT_MANIFEST_INVALID');
  await exclusiveDirectory(targetDirectory);
  const restored=[];
  for(const row of manifest.objects){
    check(row.objectId===sha256(row.url) && row.context===`simsa-document-v1:${expectedArchiveSha256}:${row.objectId}`
      && /^[a-f0-9]{64}$/.test(row.sha256) && (row.sourceSha256===null || row.sourceSha256===row.sha256),'DOCUMENT_OBJECT_BINDING_MISMATCH');
    const bytes=unseal(await readFile(join(directory,`${row.objectId}.aesgcm`)),key,row.context);
    try {check(bytes.length===row.sizeBytes && sha256(bytes)===row.sha256,'RESTORED_DOCUMENT_HASH_MISMATCH');
      await writeFile(join(targetDirectory,`${row.objectId}.aesgcm`),seal(bytes,targetKey,row.context),{flag:'wx',mode:0o600});restored.push(row);
    }finally{bytes.fill(0);}
  }
  check(manifest.references.every(ref=>restored.some(row=>row.url===ref.url && row.sizeBytes===ref.sizeBytes && (!ref.sha256 || row.sha256===ref.sha256))), 'DOCUMENT_REFERENCE_NOT_RESTORED');
  // Private loopback recovery gateway tests transport authentication and restored
  // byte delivery. This does not claim a production user login or application RBAC.
  const credential=randomBytes(32).toString('hex'); let delivered=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const supplied=Buffer.from(req.headers.authorization||''),allowed=Buffer.from(`Bearer ${credential}`);
    if(supplied.length!==allowed.length||!timingSafeEqual(supplied,allowed)){res.writeHead(401).end();return;}
    const row=restored.find(item=>req.url===`/${item.objectId}`);
    if(req.method!=='GET'||!row){res.writeHead(404).end();return;}
    try {const bytes=unseal(await readFile(join(targetDirectory,`${row.objectId}.aesgcm`)),targetKey,row.context);
      check(sha256(bytes)===row.sha256,'DOWNLOAD_HASH_MISMATCH');res.setHeader('Content-Type','application/octet-stream');res.end(bytes,()=>bytes.fill(0));delivered++;
    }catch{res.writeHead(500).end();}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  let unauthorizedDenied=false;
  try {const origin=`http://127.0.0.1:${server.address().port}`;
    unauthorizedDenied=(await fetch(origin+'/'+restored[0].objectId)).status===401;check(unauthorizedDenied,'ANONYMOUS_DOWNLOAD_ALLOWED');
    for(const row of restored){const response=await fetch(origin+'/'+row.objectId,{headers:{authorization:`Bearer ${credential}`},redirect:'error',signal:AbortSignal.timeout(10000)});
      const bytes=Buffer.from(await response.arrayBuffer());try{check(response.status===200&&bytes.length===row.sizeBytes&&sha256(bytes)===row.sha256,'AUTHORIZED_DOWNLOAD_MISMATCH');}finally{bytes.fill(0);}}
  }finally{await new Promise(done=>server.close(done));}
  return {restoredObjects:restored.length,authorizedDownloads:delivered,unauthorizedDenied,downloadScope:'isolated_private_recovery_gateway',applicationRbacRetested:false,
    allHashesMatch:true,targetEncrypted:true,plaintextDocumentWritten:false,localGatewayStopped:true};
}
