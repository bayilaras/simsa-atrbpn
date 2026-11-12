# 📤 Surat Keluar

Panduan lengkap cara mengelola surat keluar di SIMSA.

---

## Melihat Daftar Surat Keluar

### Langkah 1: Buka Menu Surat Keluar

1. Di sidebar, klik menu **Surat** (ada ikon ▼).
2. Sub-menu akan terbuka, klik **Surat Keluar**. Angka di samping menu ini menunjukkan jumlah surat yang menunggu keputusan kamu sebagai penyetuju.

### Langkah 2: Lihat Daftar Surat

Tabel daftar surat keluar mirip dengan surat masuk, dengan perbedaan:
- Kolom **"Perihal & Tujuan"** menampilkan penerima surat (Kepada), bukan pengirim
- Kolom **Status** menampilkan status persetujuan: **Draft**, **Menunggu Persetujuan**, **Disetujui**, atau **Perlu Perbaikan** (surat yang ditolak penyetuju). Surat yang sudah diarsipkan bertanda **Arsip**
- Tanda tambahan: **File**, **Balasan**, **Inisiatif** atau **Tindak Lanjut**, dan klasifikasi keamanan surat
- Menu tiga titik (⋯) berisi **Detail & File**, **Edit Surat** dan **Hapus Surat** (hanya untuk Draft atau Perlu Perbaikan), serta **Arsipkan** (hanya setelah Disetujui)
- Klik **Filter**; di panelnya ada penyaring **Persetujuan**: **Semua surat**, **Menunggu keputusan saya**, atau **Buatan saya, belum diajukan**

---

## Menambah Surat Keluar Baru

### Langkah 1: Klik Tombol Tambah

Di pojok kanan atas, pilih salah satu:

- **Buat Surat Inisiatif** untuk surat tanpa surat masuk induk. Panah di sampingnya membuka pilihan jenis naskah (Nota Dinas, Surat Edaran, Surat Undangan, Keputusan, Surat Tugas, **Lainnya…**).
- **Tindak Lanjut Surat Masuk…** (di menu panah yang sama) untuk membalas atau menindaklanjuti surat yang sudah tercatat.

Kolom ekspor **Asal Naskah** mencatat pilihan ini.

### Langkah 2: Isi Form Surat Keluar

| Kolom | Keterangan | Wajib |
|-------|-----------|:-----:|
| **Nomor Referensi** / **Asal Naskah** | Surat masuk atau surat keluar yang ditindaklanjuti. Pada surat inisiatif bagian ini menerangkan bahwa surat memulai rangkaian baru | ❌ |
| **Naskah Dinas** | Jenis naskah yang akan dikirim | ✅ |
| **Nomor Surat** | Nomor manual; kosongkan untuk nomor otomatis dari template unit | ❌ |
| **Tanggal Surat** | Tanggal surat dibuat | ✅ |
| **Perihal** | Subjek / topik surat | ✅ |
| **Sifat Surat** | Biasa / Penting / Segera / Sangat Segera (tingkat urgensi, bukan kerahasiaan) | ❌ |
| **Kepada** | Tujuan pengiriman surat | ✅ |
| **Klasifikasi** | Pilih pasangan klasifikasi arsip dan JRA dari aturan aktif | ❌ |
| **Klasifikasi Keamanan** | Biasa / Terbuka, Terbatas, Rahasia, atau Sangat Rahasia. Admin Unit Kerja hanya dapat memilih Biasa / Terbuka atau Terbatas; Rahasia dan Sangat Rahasia hanya dapat ditetapkan oleh Super Admin. Rekod Terbatas atau lebih tinggi memerlukan persetujuan akses sebelum dapat ditayangkan atau dikelola | ✅ |
| **Link Dokumen** | Alamat lengkap dokumen kerja, misalnya `https://contoh.go.id/berkas` | ❌ |
| **Upload Berkas** | Hasil pindai surat dalam bentuk PDF, paling besar 10 MiB | ❌ |

Di bagian lampiran tertulis *Catatan: Link dokumen dan berkas tidak wajib diisi.* Selama keduanya kosong, tampil petunjuk *Surat dapat disimpan tanpa lampiran; hasil pindai dapat ditambahkan lewat menu Edit Surat selama surat masih draf atau ditolak (sebelum diajukan untuk persetujuan).* Link dokumen yang bukan alamat lengkap ditolak dengan pesan *Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id/berkas*.

### Langkah 3: Simpan

1. Periksa kembali data.
2. Klik tombol **"Simpan"**.
3. Surat keluar baru akan muncul di daftar dengan status **Draft**.

> **Lengkapi lampiran sebelum mengajukan**
>
> Setelah surat diajukan untuk persetujuan, surat terkunci dan hasil pindai tidak dapat lagi ditambahkan. Unggah berkas atau isi link dokumen selagi surat masih **Draft** atau **Perlu Perbaikan**.

---

## Persetujuan Internal Surat Keluar

Surat keluar **baru dapat diarsipkan setelah disetujui admin lain**. Urutannya:

1. Buka detail surat berstatus **Draft** atau **Ditolak / Perlu Perbaikan**.
2. Pada kartu **Alur Persetujuan**, klik **Ajukan Persetujuan** dan pilih **Penyetuju**, yaitu administrator aktif lain yang tersedia pada unit surat.
3. Tambahkan catatan bila diperlukan, lalu klik **Simpan**.
4. Penyetuju yang ditunjuk membuka surat itu dan memilih **Setujui** atau **Tolak**. **Alasan penolakan** wajib diisi saat menolak.
5. Jika ditolak, pembuat memperbaiki surat lalu mengajukannya ulang. Jika disetujui, tombol **Arsipkan** tersedia.

Pembuat tidak boleh menjadi penyetuju suratnya sendiri, juga bila surat itu diajukan orang lain atas namanya. Surat **Menunggu Persetujuan** dan **Disetujui** terkunci dari edit/hapus, dan surat hanya dapat diarsipkan setelah disetujui. Riwayat pengajuan, keputusan, catatan, dan pelaku dapat dilihat pada kartu **Alur Persetujuan**.

Bila belum ada administrator aktif lain pada unit surat, tampil keterangan *Belum ada administrator aktif lain yang dapat menjadi penyetuju pada unit ini.* Minta Super Admin menyiapkan akun penyetuju.

### Menemukan Surat yang Menunggu Keputusan Kamu

- **Dashboard** (admin) menampilkan baris *N surat keluar menunggu keputusan Anda* dengan tombol **Tinjau surat yang menunggu**.
- Halaman Surat Keluar menampilkan kartu kuning *N surat menunggu keputusan Anda* berisi tombol menuju surat tersebut dan tombol **Tampilkan semua di daftar**.
- Bila kartu itu menyebut ada surat yang tidak tampil di daftar (biasanya karena tingkat keamanan suratnya), buka surat tersebut lewat tombol di kartu.

### Mengajukan atau Menyetujui Beberapa Surat Sekaligus

1. Di daftar Surat Keluar, centang kotak pilih pada baris surat, atau **Pilih semua di halaman ini**.
2. Pada bilah **Tindakan untuk surat terpilih**, klik **Ajukan Persetujuan (N)** untuk surat Draft atau Perlu Perbaikan buatan kamu (satu penyetuju untuk semuanya), atau **Setujui (N)** untuk surat yang menunggu keputusan kamu.
3. Baca hasilnya: jumlah yang berhasil dan alasan penolakan untuk tiap surat yang gagal.

Satu kali tindakan paling banyak 100 surat. **Batalkan pilihan** mengosongkan centang.

### Jika Pembuat Surat Sudah Tidak Aktif

Bila pembuat surat sudah nonaktif atau tidak lagi bertugas di unit surat, Super Admin atau admin unit surat melihat tombol **Ajukan Persetujuan** beserta keterangan atas nama siapa surat diajukan. Riwayat mencatat *Diajukan atas nama pembuat surat (nama)*. Untuk surat berkelas Terbatas, Rahasia, atau Sangat Rahasia, pengaju pengganti harus memegang persetujuan akses untuk mengelola surat itu; selain itu berlaku pesan *Hanya pembuat surat yang dapat mengajukan persetujuan.*

> **Batas fitur**
>
> Alur ini adalah persetujuan proses internal. SIMSA tidak membuat tanda tangan elektronik dan tidak menggunakan BSrE/PSrE.

---

## Membuat Surat Keluar sebagai Balasan

> **Balasan langsung dari surat masuk**
>
> Selain membuat surat keluar baru, kamu bisa langsung **membalas surat masuk** dari halaman detailnya. Data form akan otomatis terisi!

### Cara Cepat (dari Detail Surat Masuk):

1. Buka **Detail Surat Masuk** yang ingin dibalas.
2. Klik **Tindak Lanjut**, lalu pilih **Saya Balas**.
3. Form Tambah Surat Keluar terbuka dengan **Perihal**, **Kepada**, dan **Nomor Referensi** otomatis terisi.
4. Lengkapi kolom lainnya dan klik **"Simpan"**.

Untuk panduan lengkap, lihat bagian [Membalas Surat Masuk](surat-masuk.md#membalas-surat-masuk).

---

## Melihat Detail Surat Keluar

1. Pada baris surat, klik menu tiga titik (⋯), lalu pilih **Detail & File**.
2. Lihat informasi lengkap surat, berkas, panel **Alur Surat**, dan kartu **Tunjuk Silang**.
3. Lihat status serta riwayat persetujuan pada kartu **Status** dan **Alur Persetujuan**.
4. Gunakan aksi yang tersedia sesuai role dan status: **Edit Surat** untuk Draft atau Perlu Perbaikan, **Setujui/Tolak** untuk penyetuju yang ditunjuk, dan **Arsipkan** setelah Disetujui.

Surat berkelas Terbatas atau lebih tinggi yang belum boleh kamu buka menampilkan halaman **Perlu persetujuan akses** dengan tombol **Minta Akses**. Caranya sama seperti pada [Surat Masuk](surat-masuk.md#jika-tampil-perlu-persetujuan-akses).

---

## Mengedit dan Menghapus

Edit dan hapus hanya tersedia bagi admin berwenang ketika surat masih **Draft** atau **Perlu Perbaikan** dan belum diarsipkan. Saat surat **Menunggu Persetujuan** atau **Disetujui**, perubahan ditolak untuk menjaga konsistensi keputusan. Jangan menghapus surat hanya untuk memperbaiki metadata; gunakan edit pada status yang diizinkan agar jejak proses tetap dapat ditelusuri.

Klasifikasi keamanan Rahasia atau Sangat Rahasia yang sudah tersimpan boleh dipertahankan saat mengedit. Bila diganti lalu disimpan, kelas itu hanya dapat dipilih kembali oleh Super Admin.

---

[⬅️ Sebelumnya: Surat Masuk](surat-masuk.md) | [Selanjutnya: Distribusi Surat ➡️](distribusi.md)
