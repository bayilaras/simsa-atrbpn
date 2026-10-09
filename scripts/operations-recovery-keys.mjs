// Passphrase-wrapped recovery keys. Node built-ins only (laptop-safe).
import { scryptSync } from 'node:crypto';
import { unseal } from './operations-recovery-documents.mjs';
const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{safeCode:code});};
export function unwrapRecoveryKeys(metadata,envelope,passphrase){
 check(metadata?.schemaVersion===1&&metadata.kdf==='scrypt'&&metadata.N===32768&&metadata.r===8&&metadata.p===1&&/^[a-f0-9]{64}$/.test(metadata.archiveSha256),'KEY_ENVELOPE_CONFIGURATION_MISMATCH');
 const salt=Buffer.from(metadata.saltBase64||'','base64');check(salt.length===32&&salt.toString('base64')===metadata.saltBase64&&typeof passphrase==='string'&&passphrase.length>=32,'INVALID_KEY_ENVELOPE');
 const wrappingKey=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});let bytes;
 try{bytes=unseal(envelope,wrappingKey,`simsa-recovery-keys-v1:${metadata.archiveSha256}`);const keys=JSON.parse(bytes);
  const database=JSON.parse(keys.databaseKeyRecord),documentKey=Buffer.from(keys.documentKeyBase64,'base64');check(documentKey.length===32,'INVALID_DOCUMENT_RECOVERY_KEY');return {database,documentKey};
 }finally{wrappingKey.fill(0);bytes?.fill(0);}
}
