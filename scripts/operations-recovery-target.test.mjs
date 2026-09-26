import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,lstat,rmdir,rm,realpath} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {makeBackupWorkspace} from './neon-backup-runtime.mjs';
import {createRecoveryTarget,initializeRecoveryCluster} from './operations-recovery-target.mjs';

const pgBin=process.env.OPERATIONS_RECOVERY_TEST_PG_BIN;
const unixUser=process.platform==='linux' && process.getuid()!==0;
async function privateFixture(command){
 const directory=await mkdtemp(join(tmpdir(),'simsa-initdb-contract-'));
 return {directory,command,verifyPrivate:async()=>{const stat=await lstat(directory);assert.equal(stat.uid,process.getuid());assert.equal(stat.mode&0o777,0o700);}};
}
test('initdb uses one owner-only transient file; never stdin or password arguments', {skip:!unixUser},async()=>{
 const secret='a'.repeat(64);let path;
 const workspace=await privateFixture(async(tool,args,options)=>{
  assert.equal(tool,'initdb');assert.equal(options,undefined);assert.equal(args.includes(secret),false);assert.equal(args.includes('/dev/stdin'),false);
  path=args[args.indexOf('--pwfile')+1];assert.equal(path.startsWith(workspace.directory+'/init-password-'),true);
  assert.equal(await readFile(path,'utf8'),secret+'\n');const info=await lstat(path);assert.equal(info.mode&0o777,0o600);assert.equal(info.uid,process.getuid());
  assert(args.includes('--auth-host=scram-sha-256'));assert(args.includes('--auth-local=scram-sha-256'));
 });
 await initializeRecoveryCluster(workspace,{dataDir:join(workspace.directory,'restore-data'),admin:'simsa_restore_admin',password:secret});
 await assert.rejects(lstat(path),{code:'ENOENT'});assert.deepEqual(await readdir(workspace.directory),[]);await rmdir(workspace.directory);
});
test('initdb failure removes the transient password and exposes only a fixed stage code', {skip:!unixUser},async()=>{
 let path;const workspace=await privateFixture(async(tool,args)=>{path=args[args.indexOf('--pwfile')+1];throw new Error('secret=DO_NOT_EXPOSE raw stderr');});
 await assert.rejects(initializeRecoveryCluster(workspace,{dataDir:join(workspace.directory,'restore-data'),admin:'simsa_restore_admin',password:'b'.repeat(64)}),error=>error.safeCode==='RECOVERY_INITDB_FAILED'&&error.message==='RECOVERY_INITDB_FAILED'&&JSON.stringify(error).includes('DO_NOT_EXPOSE')===false);
 await assert.rejects(lstat(path),{code:'ENOENT'});await rmdir(workspace.directory);
});
test('unsafe private directory is refused before initdb without leaking its error', {skip:!unixUser},async()=>{
 let calls=0;const workspace=await privateFixture(async()=>calls++);workspace.verifyPrivate=async()=>{throw Error('private path secret');};
 await assert.rejects(initializeRecoveryCluster(workspace,{dataDir:join(workspace.directory,'restore-data'),admin:'simsa_restore_admin',password:'c'.repeat(64)}),{safeCode:'RECOVERY_PASSWORD_DIRECTORY_UNSAFE'});
 assert.equal(calls,0);assert.deepEqual(await readdir(workspace.directory),[]);await rmdir(workspace.directory);
});
test('target path escape is rejected before creating password or invoking initdb', {skip:!unixUser},async()=>{
 let calls=0;const workspace=await privateFixture(async()=>calls++);
 await assert.rejects(initializeRecoveryCluster(workspace,{dataDir:join(workspace.directory,'..','other'),admin:'simsa_restore_admin',password:'d'.repeat(64)}),{safeCode:'RECOVERY_TARGET_CHANGED'});
 assert.equal(calls,0);assert.deepEqual(await readdir(workspace.directory),[]);await rmdir(workspace.directory);
});
test('real Node24 Linux PG18 target initializes, proves identity and stops with no password file',
 {skip:!pgBin,timeout:120000},async()=>{
  assert.equal(process.platform,'linux');assert.notEqual(process.getuid(),0);
  const parent=await mkdtemp(join(tmpdir(),'simsa-target-test-'));
  const workspace=await makeBackupWorkspace(pgBin,parent);let target;
  try{
   target=await createRecoveryTarget(workspace);await target.guard();
   const value=await target.query("SELECT current_database()||'|'||current_user");
   assert.equal(value.trim(),'postgres|simsa_restore_admin');
   assert.equal((await readdir(workspace.directory)).some(name=>/password|pwfile/.test(name)),false);
  }finally{
   if(target){
    await target.stop();
    // Delete only this test's new physical directory, after PID/port/identity
    // shutdown verification. A failed stop preserves the target for diagnosis.
    assert.equal(dirname(parent),resolve(tmpdir()));assert.match(basename(parent),/^simsa-target-test-[A-Za-z0-9]+$/);
    assert.equal(await realpath(parent),parent);assert.equal((await lstat(parent)).isSymbolicLink(),false);
    assert.equal(dirname(workspace.directory),parent);await rm(parent,{recursive:true,force:false});
   }
  }
 });
