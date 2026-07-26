import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-home-user-simsa-atrbpn/46fd616b-7e75-5f2a-babe-94871ecd122a/scratchpad';
const S={user:{id:'u1',name:'Wildan Ayuna',email:'w@atrbpn.go.id',role:'super_admin',unitKerjaId:'ditjen',image:null,emailVerified:true},session:{id:'s1',userId:'u1',expiresAt:new Date(Date.now()+864e5).toISOString()}};
const row=[{id:'1',noUrut:1,nomorSurat:'B-201/PL.02/2026',tanggalSurat:'2026-07-04',tanggalDiterima:'2026-07-04',perihal:'Balasan Permohonan Data Bidang Tanah Kecamatan Cibinong',kepada:'Kantor Pertanahan Kab. Bogor',dari:'Kantor Pertanahan Kab. Bogor',naskahDinas:'Surat Dinas',status:'terkirim',isArchived:false,tahun:2026,
 nomorBerkas:'AR-001/2026',kodeKlasifikasi:'PL.02',uraianBerkas:'Berkas Pengadaan Tanah Jalan Tol',jenisArsip:'masuk',retensiAktif:'2 tahun',retensiInaktif:'3 tahun',
 name:'Wildan Ayuna',email:'w@atrbpn.go.id',role:'staff',unitKerjaId:'ditjen',isActive:true,
 namaPeminjam:'Budi',unitKerja:'Ditjen',tanggalPinjam:'2026-07-01',tanggalJatuhTempo:'2026-07-15',jenisPinjaman:'arsip',
 jenisLayanan:'legalisasi',keperluan:'Administrasi',jumlahRangkap:2,createdAt:'2026-07-20T10:00:00Z',
 sourceType:'surat_masuk',targetType:'arsip',jenisRelasi:'lampiran',formatFile:'PDF',statusVerifikasi:'verified',mediaAsal:'kertas',
 userName:'Wildan',userEmail:'w@atrbpn.go.id',action:'create',entityType:'surat_masuk',
 targetUnitId:'sesditjen',sourceUnitId:'ditjen',instruction:'Mohon ditindaklanjuti',sentAt:'2026-07-10'}];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const pages=[['/','dash'],['/surat/masuk','sm'],['/surat/keluar','sk'],['/arsip/masuk','arsip'],['/laporan','lap'],
 ['/settings','set'],['/audit-log','audit'],['/users','users'],['/distribusi','dist'],['/archive-lending','lend'],
 ['/arsip-vital','vital'],['/arsip-terjaga','terjaga'],['/arsip-elektronik','elek'],['/tunjuk-silang','ts'],
 ['/layanan-arsip','layanan'],['/retention','ret'],['/autentikasi','auth'],['/penyusutan','peny'],['/dosir','dosir'],['/storage-locations','loc']];
let fails=0,checks=0;
for (const [url,tag] of pages) for (const w of [360,768,1440]) {
  const c=await b.newContext({viewport:{width:w,height:900}}); const p=await c.newPage();
  await p.route('**/api/**',r=>{const u=r.request().url();
    if(u.includes('get-session')||u.includes('/session')) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(S)});
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:row,pagination:{page:1,limit:10,total:1,totalPages:1},total:1,arsipMasuk:1,arsipKeluar:0})});});
  await p.goto('http://127.0.0.1:4190'+url,{waitUntil:'domcontentloaded'}).catch(()=>{});
  await p.waitForTimeout(2100); checks++;
  const ov=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  if(ov>0){fails++; console.log(`  x ${tag}@${w}: ${ov}px`);}
  if(w===360&&['lend','users','vital'].includes(tag)) await p.screenshot({path:`${OUT}/r-${tag}.png`,fullPage:true});
  await c.close();
}
console.log(fails===0?`SEMUA LOLOS (${checks} kombinasi)`:`${fails}/${checks} gagal`);
await b.close();
