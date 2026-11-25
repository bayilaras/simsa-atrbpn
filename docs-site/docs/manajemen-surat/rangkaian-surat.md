# 🧵 Rangkaian Surat

Rangkaian Surat menyatukan surat masuk, disposisi, tindak lanjut, dan surat keluar dalam satu berkas naskah berkode `RS-YYYY-NNNNNN`.

## Melacak Rangkaian

[![Halaman Lacak Surat dengan hasil pencarian](/img/panduan/lacak-surat.png)](/img/panduan/lacak-surat.png)

*Contoh tampilan: hasil Lacak Surat dikelompokkan per rangkaian.*

1. Buka **Surat ▸ Lacak Surat**. Halaman terbuka pada tab **Lacak**.
2. Ketik nomor surat (misalnya `B-12/PTPP.1/IX/2024`) atau kata dalam perihal (minimal 3 karakter). Hasil memuat surat masuk dan surat keluar yang boleh kamu lihat beserta rangkaian tindak lanjutnya.
3. Klik kartu rangkaian untuk melihat panel **Alur Surat**.

Halaman Lacak Surat punya tiga tab:

| Tab | Isi |
|-----|-----|
| **Lacak** | Pencarian surat masuk dan surat keluar beserta rangkaiannya |
| **Berkas Rangkaian** | Daftar rangkaian surat yang dapat kamu lihat |
| **Perlu Dilengkapi** | Surat dan rangkaian dalam jangkauan kamu yang rantainya belum lengkap, misalnya surat masuk yang belum ditindaklanjuti atau disposisi yang belum selesai. Bagi admin, angka pada menu **Lacak Surat** di sidebar menunjukkan jumlahnya |

## Daftar Perlu Dilengkapi

Tab **Perlu Dilengkapi** adalah daftar kerja. Setiap baris punya tombol untuk langkah berikutnya, misalnya **Tindak Lanjut**, **Disposisi**, **Berkaskan ke Direktorat**, **Tandai Inisiatif**, atau **Tautkan**. Tombol hanya tampil bila kamu berwenang atas surat itu. Surat yang tidak boleh kamu baca tampil sebagai "Dikecualikan".

### Menandai surat masuk selesai tanpa balasan

Sebagian surat masuk tidak perlu didisposisikan atau dibalas, misalnya undangan yang sudah dihadiri, tembusan, atau surat edaran. Agar surat seperti itu keluar dari kelompok **Surat masuk belum ditindaklanjuti**:

1. Buka **Surat ▸ Lacak Surat**, lalu tab **Perlu Dilengkapi**.
2. Pada baris suratnya, klik **Tandai Selesai**.
3. Isi **Catatan penyelesaian** (minimal 10 karakter), misalnya "Undangan sudah dihadiri, tidak perlu dibalas", lalu klik **Tandai Selesai**.

Tombol **Tandai Selesai** yang sama tampil di halaman detail surat masuk, selama surat itu belum didisposisikan, belum dibalas, dan belum menjadi bagian dari rangkaian.

Yang terjadi setelah itu:

- Surat pindah ke kelompok **Siap diberkaskan**. Dari sana klik **Berkaskan ke Direktorat** bila berkasnya sudah lengkap.
- Status surat masuk menjadi **Sudah Dibalas**, karena surat dianggap sudah ditangani.
- Surat mendapat kode rangkaian `RS-YYYY-NNNNNN`. Catatanmu tersimpan dan tindakan ini tercatat di Audit Log.
- Bila ternyata surat perlu ditindaklanjuti, buka rangkaiannya dan klik **Buka Kembali**; surat tampil lagi di **Surat masuk belum ditindaklanjuti**. Mengirim disposisi atau membuat tindak lanjut juga membuka rangkaiannya kembali. Tulisan status **Sudah Dibalas** pada daftar surat tidak ikut berubah saat rangkaian dibuka kembali.

Tombol **Tandai Selesai** pada baris hanya tampil bagi admin unit pemilik surat (atau Super Admin) dan hanya untuk surat yang belum punya rangkaian. Surat yang sudah punya rangkaian, misalnya karena disposisinya ditolak, ditandai selesai dari panel **Alur Surat** rangkaian itu. Mengarsipkan surat tidak mengeluarkannya dari daftar ini; surat yang sudah diarsipkan tetap dapat ditandai selesai.

### Surat hasil impor dan data lama

Surat yang masuk lewat **Impor dari Google Sheets** atau **Impor CSV/XLSX** biasanya register lama, jadi tidak ditampilkan di Perlu Dilengkapi dan tidak dihitung pada angka di sidebar. Hal yang sama berlaku untuk surat dari aplikasi lama.

- Centang **Tampilkan data lama** untuk melihatnya. Barisnya berlabel **Data lama** dan tombol aksinya tetap berfungsi.
- Begitu surat impor didisposisikan, ditindaklanjuti, ditautkan, atau ditandai selesai, surat itu masuk ke sebuah rangkaian dan diperlakukan seperti surat lain: tampil tanpa perlu mencentang.
- Surat yang dicatat lewat tombol **Surat Baru** tidak terpengaruh.
- Surat yang diimpor sebelum akhir November 2026 baru ikut tersembunyi setelah administrator sistem menandainya sebagai hasil impor.

## Menautkan Surat ke Rangkaian

Bila sebuah surat berkaitan dengan surat lain tetapi belum berada dalam satu rangkaian, tautkan dari halaman detailnya agar alurnya dapat dilacak:

1. Buka detail surat masuk atau surat keluar, klik **Tindak Lanjut**, lalu pilih **Tautkan ke Rangkaian**.
2. Pada dialog **Tautkan ke Rangkaian**, pilih surat yang dirujuk surat ini, lalu klik **Tautkan**.

Pilihan ini hanya tampil bila kamu berwenang atas surat itu.

## Memberkaskan ke Direktorat
1. Pastikan tidak ada disposisi terbuka dan tidak ada surat keluar draf/menunggu/ditolak di rangkaian.
2. Klik **Berkaskan ke Direktorat (Unit Pengolah)**, pilih unit pengolah dan klasifikasi, lalu konfirmasi dua kali.

## Koreksi Berkas
Super admin mengajukan koreksi unit pengolah/klasifikasi dengan alasan minimal 10 karakter; super admin **lain** menyetujui atau menolak. Status diberkaskan sendiri tidak dapat dibuka kembali.

## Surat data lama
Surat dari aplikasi lama dirangkai sebagai data lama berstatus selesai. Label Kabag tetap label saja. Super admin atau admin unit pengawas dapat memakai **Tutup massal data lama** di tab Berkas Rangkaian setelah melihat pratinjau. Rangkaian yang tidak memiliki pengolah diberkaskan ke unit pencatat.
