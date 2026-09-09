# Backup terenkripsi Spark — latihan lokal

`npm run backup:drill` menjalankan latihan pada **data sintetis di emulator**.
Ini bukan perintah backup Firebase online, bukan pemulihan password pengguna,
dan bukan persetujuan menggunakan data arsip asli atau promosi Production.
Hasil latihan tercatat di [BACKUP-VERIFICATION.md](BACKUP-VERIFICATION.md).

## Menjalankan

Prasyarat: dependensi `spark` sudah dipasang, Node 24 dan Java 21+ tersedia.
Hentikan emulator interaktif milik Anda secara normal terlebih dahulu. Launcher
menolak port yang sedang digunakan; tidak mematikan proses pengguna.

```sh
cd spark
npm test
npm run backup:drill
```

Launcher membuat lingkungan CLI tanpa login Firebase tersimpan dan hanya
menjalankan Auth/Firestore/hub pada `127.0.0.1:9098`, `8088`, dan `4408`.
Tidak menerima project, URL, port, database, key cloud, atau parameter deploy.
Konfigurasi terpisah `firebase.backup-emulator.json` mengaktifkan multi-project.
Kode adapter/fixture membatasi aksesnya ke dua namespace tetap berikut:

- Sumber: `demo-simsa-spark-backup`.
- Tujuan: `demo-simsa-spark-restore`.

Keduanya harus kosong. Namespace demo aplikasi normal `demo-simsa-spark` tidak
dipakai atau dikosongkan. Data emulator drill berakhir ketika emulator berhenti;
artifact lokal tetap disimpan. Tidak ada penghapusan otomatis maupun penimpaan.

## Yang dibuktikan

1. Fixture mencakup dua unit, 55 akun sintetis/profil, lebih dari satu halaman
   katalog/data, dan satu arsip dengan 55 versi—melampaui history 25 di UI
   maupun ukuran halaman 50 milik adapter backup.
2. Traversal membaca semua koleksi/subkoleksi yang didukung dan semua halaman.
   Koleksi asing, induk hilang, pagination berulang, history terputus, snapshot
   terbaru tidak cocok, serta pelampauan batas menghasilkan kegagalan eksplisit.
3. Dua traversal sumber harus identik. Ini mendeteksi perubahan yang terlihat,
   **bukan** transaksi snapshot lintas Firestore/Auth atau pengganti maintenance
   window. Jangan menjalankan penulis lain selama latihan.
4. Seluruh snapshot dan manifest dienkripsi dengan AES-256-GCM memakai key acak
   32 byte. Format/versi dan isi diautentikasi sebelum request restore pertama.
   Salah key, ciphertext rusak, dan artifact terpotong ditolak sebelum jaringan.
5. Proses baru membaca ciphertext dan file key terpisah. Tujuan diperiksa kosong;
   setiap akun/dokumen dibuat tanpa overwrite. Semua dokumen, field bertipe,
   versi/history, profil, custom claims, dan binding Google yang didukung
   dibandingkan ulang. Timestamp aplikasi dipertahankan hingga nanodetik;
   `createTime/updateTime` sistem Firestore akan dibuat baru dan tidak dibandingkan.
6. Percobaan restore kedua ke target yang kini terisi wajib ditolak. Seluruh
   data tujuan dibandingkan kembali untuk membuktikan tidak ada penimpaan.

## Batas identitas dan format

Backup menyimpan **metadata akun**, bukan kredensial. Password, hash/salt,
parameter hash project, token OAuth, refresh token, dan sesi tidak diekspor atau
dipulihkan. Semua akun tujuan dibuat **disabled**. Binding password sengaja
tidak dipulihkan; laporan menyatakan jumlah yang dikecualikan. Akun tidak dapat
langsung dipakai login. Penyiapan ulang password dan penerimaan pengguna adalah
prosedur terpisah yang belum disediakan tool ini.

Hanya binding `google.com` dan metadata binding password yang didukung. Tenant,
MFA, passkey, nomor telepon, foto akun, dan tipe provider lain ditolak jika
terdeteksi. User/profile harus cocok dan unit/katalog/history wajib lengkap;
actor historis yang akunnya sudah dihapus tidak dibuatkan akun pengganti.

Batas eksplisit: payload terenkripsi sekitar 16 MiB plaintext, 10.000 dokumen,
2.000 akun, dan kedalaman map 8. Tipe Firestore yang dipakai kontrak Spark adalah
string, boolean, integer, timestamp, dan map. Tipe lain ditolak, bukan dikonversi
secara lossy. Tool ini bukan exporter Firestore serbaguna.

## Artifact dan key

Lokasi direktori sementara `simsa-spark-drill-*` ditampilkan saat mulai. Root
direktori dibatasi ke pengguna saat ini: mode privat POSIX atau ACL Windows yang
dibaca ulang dan diverifikasi, sebelum material key ditulis.

- `artifacts/snapshot.simsabackup`: ciphertext.
- `recovery/key.bin`: key; **jangan dikirim ke chat, GitHub, log, atau bersama
  artifact ke penerima yang tidak berwenang**.
- `source-manifest.json`, `restore-result.json`, `result.json`: hasil latihan
  tanpa isi dokumen/password/key. Hasil akhir memuat hash ciphertext dan cakupan.

Key dan ciphertext berada di folder berbeda pada mesin yang sama. Itu **belum**
pemisahan kustodian/off-site yang independen. Kehilangan key membuat artifact
tidak dapat dibuka. Kebocoran key dapat membuka artifact terkait. Jangan
memasukkan file key dalam upload artifact CI. CI saat ini hanya menjalankan
latihan; tidak mempublikasikan key atau arsip.

Kegagalan setelah sebagian restore tidak dianggap sukses. Laporan yang sudah
dibuat dipertahankan untuk diagnosis, termasuk fase/jumlah penulisan yang telah
dicoba. Akun tetap nonaktif dan tidak ada retry yang menimpa data. Target parsial
hanya ada selama emulator berjalan: shutdown launcher membuang data emulator
di memory, **bukan** mempertahankannya di disk. Gunakan emulator baru yang kosong
untuk latihan berikutnya.
Source masih tersedia di namespace terpisah selama latihan; proses restore
tidak membacanya. Ini bukan bukti source outage/disaster-recovery fisik.

## Sebelum backup live

Masih perlu: project bersih dan kuota Google, otorisasi operator minimal,
maintenance window termasuk perubahan Auth, strategi snapshot/readTime yang
didukung layanan live, backup konfigurasi Rules/indexes/provider, strategi
pemulihan kredensial yang disetujui, penyimpanan key terpisah/off-site, retensi,
dan restore independen pada layanan live. Jangan mengarahkan tool emulator ini
ke cloud, menonaktifkan guard, atau menyebut CSV halaman UI sebagai backup.

Perubahan tool/CI ini memerlukan PR, review manusia pada head yang tepat, dan
required checks baru sebelum rilis. Approval PR 8 tidak mencakup kode baru ini.
