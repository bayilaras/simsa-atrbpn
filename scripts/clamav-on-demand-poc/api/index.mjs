import { runProbe } from '../probe.mjs';
async function selectedProbe(){
 if(process.env.SIMSA_CLAMAV_NATIVE_POC_ENABLED==='1')return (await import('../native-probe.mjs')).runNativeProbe();
 return runProbe();
}
function inspectRequestShape(req){
 const body=req.body;
 const prototype=body!==null&&typeof body==='object'?Object.getPrototypeOf(body):undefined;
 const plainObject=prototype===Object.prototype||prototype===null;
 const buffer=Buffer.isBuffer(body);
 const bodyKind=body===null?'null':buffer?'buffer':Array.isArray(body)?'array':prototype===null?'null_prototype_object':plainObject?'plain_object':typeof body;
 const bodyFields=body!==null&&typeof body==='object'&&!buffer?Reflect.ownKeys(body).length:0;
 const bodyBytes=buffer?body.length:typeof body==='string'?Buffer.byteLength(body):0;
 const emptyBody=body==null||body===''||(buffer&&body.length===0)||(plainObject&&bodyFields===0);
 const queryFields=Object.keys(req.query??{}).length;
 const contentLengthIsZero=req.headers['content-length']===undefined||String(req.headers['content-length'])==='0';
 const hasTransferEncoding=Boolean(req.headers['transfer-encoding']);
 return {empty:emptyBody&&queryFields===0&&contentLengthIsZero&&!hasTransferEncoding,
  diagnostic:{bodyKind,bodyFields,bodyBytes,queryFields,contentLengthIsZero,hasTransferEncoding}};
}
export function createPocHandler(probe=selectedProbe,writeLog=record=>console.log(JSON.stringify(record))){
return async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','text/plain; charset=utf-8');
 if(process.env.VERCEL_ENV!=='preview'||process.env.SIMSA_CLAMAV_POC_ENABLED!=='1'){res.statusCode=404;return res.end('POC disabled');}
 // Vercel Authentication deployment protection must be verified by the operator
 // before invoking. The endpoint accepts no file, URL, identifier, or user data.
 if(req.method==='GET'){
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const html='<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uji ClamAV sintetis</title><style>body{font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem;line-height:1.6}button{font:inherit;padding:.8rem 1.2rem}</style><h1>Uji ClamAV sintetis</h1><p>Hanya PDF buatan 1 KiB, PDF buatan 10 MiB, dan pola uji EICAR yang tidak berbahaya. Tidak menerima dokumen, URL, akun, atau data pengguna.</p><p>Operator harus memverifikasi Vercel Authentication aktif sebelum menjalankan. Batas seluruh uji 240 detik; hasil belum berarti integrasi produksi siap.</p><form method="post" action="/"><button type="submit">Jalankan tiga uji sintetis</button></form></html>';
  return res.end(process.env.SIMSA_CLAMAV_NATIVE_POC_ENABLED==='1'?html.replace('Batas seluruh uji 240 detik','Mode adaptor native: refresh definisi dan pembatalan juga diuji. Batas seluruh uji 275 detik'):html);
 }
 if(req.method!=='POST'){res.statusCode=405;res.setHeader('Allow','GET, POST');return res.end('Use the fixed-fixture form.');}
 const shape=inspectRequestShape(req);
 if(!shape.empty){writeLog({event:'clamav_poc_request_rejected',shape:shape.diagnostic});res.statusCode=400;return res.end('POC accepts no request data');}
 try{const report=await probe();writeLog({event:'clamav_poc_result',report});res.statusCode=report.passed?200:503;return res.end(JSON.stringify(report,null,2));}
 catch{writeLog({event:'clamav_poc_unavailable',poc:true,passed:false});res.statusCode=503;return res.end(JSON.stringify({poc:true,passed:false,error:'POC unavailable; inspect the controlled build report and runtime limits'}));}
}
}
export default createPocHandler();
