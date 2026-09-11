import { runProbe } from '../probe.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','text/plain; charset=utf-8');
 if(process.env.VERCEL_ENV!=='preview'||process.env.SIMSA_CLAMAV_POC_ENABLED!=='1'){res.statusCode=404;return res.end('POC disabled');}
 // Vercel Authentication deployment protection must be verified by the operator
 // before invoking. The endpoint accepts no file, URL, identifier, or user data.
 if(req.method==='GET'){
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  return res.end('<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uji ClamAV sintetis</title><style>body{font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem;line-height:1.6}button{font:inherit;padding:.8rem 1.2rem}</style><h1>Uji ClamAV sintetis</h1><p>Hanya PDF buatan 1 KiB, PDF buatan 10 MiB, dan pola uji EICAR yang tidak berbahaya. Tidak menerima dokumen, URL, akun, atau data pengguna.</p><p>Operator harus memverifikasi Vercel Authentication aktif sebelum menjalankan. Batas seluruh uji 240 detik; hasil belum berarti integrasi produksi siap.</p><form method="post" action="/"><button type="submit">Jalankan tiga uji sintetis</button></form></html>');
 }
 if(req.method!=='POST'){res.statusCode=405;res.setHeader('Allow','GET, POST');return res.end('Use the fixed-fixture form.');}
 const emptyBody=req.body==null||req.body===''||(Object.getPrototypeOf(req.body)===Object.prototype&&Object.keys(req.body).length===0);
 if(Object.keys(req.query??{}).length||Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding']||!emptyBody){res.statusCode=400;return res.end('POC accepts no request data');}
 try{const report=await runProbe();res.statusCode=report.passed?200:503;return res.end(JSON.stringify(report,null,2));}
 catch{res.statusCode=503;return res.end(JSON.stringify({poc:true,passed:false,error:'POC unavailable; inspect the controlled build report and runtime limits'}));}
}
