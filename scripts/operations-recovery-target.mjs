import { randomBytes, randomInt } from 'node:crypto';
import { readFile, appendFile, lstat, open, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { physical } from './neon-backup-runtime.mjs';
import { CLUSTER_IDENTITY_SQL, assertClusterIdentity, LOCAL_POSTGRES_ISOLATION_CONFIG, nativePostgresOptions, awaitPostgresLauncherExit } from './local-backup-drill-core.mjs';

const check=(value,code)=>{if(!value)throw Object.assign(new Error(code),{safeCode:code});};
const atStage=async(code,operation)=>{try{return await operation();}catch{throw Object.assign(new Error(code),{safeCode:code});}};

export async function initializeRecoveryCluster(workspace,target){
  check(process.platform==='linux' && process.getuid()!==0,'RESTORE_REQUIRES_NONROOT_LINUX_PG18');
  check(target.dataDir===join(workspace.directory,'restore-data'),'RECOVERY_TARGET_CHANGED');
  await atStage('RECOVERY_PASSWORD_DIRECTORY_UNSAFE',()=>workspace.verifyPrivate(workspace.directory));
  // Node child stdin is a socket on Linux. initdb fopen("/dev/stdin") fails
  // with ENXIO, and PostgreSQL18 does not special-case --pwfile=-.
  const passwordPath=join(workspace.directory,'init-password-'+randomBytes(16).toString('hex')+'.tmp');
  const bytes=Buffer.from(target.password+'\n');let handle,created=false;
  try{
    await atStage('RECOVERY_PASSWORD_FILE_PREPARE_FAILED',async()=>{
      handle=await open(passwordPath,'wx',0o600);created=true;
      const info=await handle.stat();check(info.isFile() && info.uid===process.getuid() && (info.mode&0o777)===0o600,'RECOVERY_PASSWORD_FILE_UNSAFE');
      await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;
    });
    await atStage('RECOVERY_INITDB_FAILED',()=>workspace.command('initdb',[
      '--pgdata',target.dataDir,'--username',target.admin,'--pwfile',passwordPath,
      '--encoding=UTF8','--no-locale','--auth-host=scram-sha-256','--auth-local=scram-sha-256',
    ]));
  }finally{
    bytes.fill(0);
    try{if(handle)await atStage('RECOVERY_PASSWORD_FILE_CLOSE_FAILED',()=>handle.close());}
    finally{if(created)await atStage('RECOVERY_PASSWORD_FILE_CLEANUP_FAILED',()=>unlink(passwordPath));}
  }
}
export async function createRecoveryTarget(workspace){
  check(process.platform==='linux' && process.getuid()!==0,'RESTORE_REQUIRES_NONROOT_LINUX_PG18');
  const {directory,environment,command,binary}=workspace;
  const target={dataDir:join(directory,'restore-data'),admin:'simsa_restore_admin',password:randomBytes(32).toString('hex')};
  const free=port=>new Promise((yes,no)=>{const server=createServer();server.once('error',no);server.listen({port,host:'127.0.0.1',exclusive:true},()=>server.close(yes));});
  for(let i=0;i<40;i++){const port=randomInt(40000,60000);if([55432,55435].includes(port))continue;try{await free(port);target.port=port;break;}catch(error){if(error.code!=='EADDRINUSE')throw error;}}
  check(target.port,'NO_FREE_RECOVERY_PORT');check(!(await lstat(target.dataDir).catch(()=>null)),'RECOVERY_TARGET_ALREADY_EXISTS');
  await initializeRecoveryCluster(workspace,target);
  const disk=async()=>{check(dirname(target.dataDir)===directory && ![55432,55435].includes(target.port),'RECOVERY_TARGET_CHANGED');await physical(target.dataDir,'directory');
    const text=(await atStage('RECOVERY_CLUSTER_METADATA_FAILED',()=>command('pg_controldata',[target.dataDir]))).toString();const id=/^Database system identifier:\s+([0-9]{10,30})\s*$/m.exec(text)?.[1];
    check(id&&(!target.systemIdentifier||id===target.systemIdentifier),'RECOVERY_CLUSTER_ID_CHANGED');return id;};
  target.systemIdentifier=await disk();
  const env=(database='postgres',user=target.admin,password=target.password)=>({...environment,PGHOST:'127.0.0.1',PGPORT:String(target.port),PGDATABASE:database,PGUSER:user,PGPASSWORD:password});
  const query=async(sql,database='postgres')=>(await atStage('RECOVERY_TARGET_QUERY_FAILED',()=>command('psql',['--no-psqlrc','--no-password','-qAt','-v','ON_ERROR_STOP=on'],{env:env(database),input:sql}))).toString();
  const guard=async()=>{await disk();assertClusterIdentity(JSON.parse((await query(CLUSTER_IDENTITY_SQL)).trim()),target);};
  const stop=async()=>{await disk();const pid=await readFile(join(target.dataDir,'postmaster.pid'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(pid){const rows=pid.split('\n');check(/^[1-9][0-9]*$/.test(rows[0])&&rows[1]===target.dataDir&&Number(rows[3])===target.port,'UNIDENTIFIED_RECOVERY_STOP_REFUSED');await guard();await atStage('RECOVERY_TARGET_STOP_FAILED',()=>command('pg_ctl',['--pgdata',target.dataDir,'-m','fast','-w','-t','30','stop']));}
    check(!(await lstat(join(target.dataDir,'postmaster.pid')).catch(()=>null)),'RECOVERY_PID_REMAINS');
    await new Promise((yes,no)=>{const socket=createConnection({host:'127.0.0.1',port:target.port});socket.once('connect',()=>{socket.destroy();no(new Error('RECOVERY_PORT_REMAINS'));});socket.once('error',error=>error.code==='ECONNREFUSED'?yes():no(error));socket.setTimeout(3000,()=>{socket.destroy();no(new Error('RECOVERY_STOP_TIMEOUT'));});});};
  await atStage('RECOVERY_TARGET_CONFIGURE_FAILED',()=>appendFile(join(target.dataDir,'postgresql.conf'),LOCAL_POSTGRES_ISOLATION_CONFIG+"\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\nlog_error_verbosity = 'terse'\nlog_connections = off\nlog_disconnections = off\n"));
  const log=await atStage('RECOVERY_LAUNCHER_LOG_FAILED',()=>open(join(directory,'launcher.log'),'wx',0o600));
  try{await free(target.port);const child=spawn(binary('pg_ctl'),['--pgdata',target.dataDir,'--log',join(directory,'postgres.log'),'-o',nativePostgresOptions(target.port),'-w','-t','30','start'],{cwd:directory,env:environment,shell:false,stdio:['ignore',log.fd,log.fd]});await atStage('RECOVERY_TARGET_START_FAILED',()=>awaitPostgresLauncherExit(child));await guard();}
  catch(error){await stop();throw error;}finally{await log.close();}
  return {target,env,query,guard,stop};
}
