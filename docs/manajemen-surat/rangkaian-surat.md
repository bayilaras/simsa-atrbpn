# 🧵 Rangkaian Surat

Rangkaian Surat menyatukan surat masuk, disposisi, tindak lanjut, dan surat keluar dalam satu berkas naskah berkode `RS-YYYY-NNNNNN`.

## Melacak Rangkaian
1. Buka **Surat ▸ Lacak Surat**.
2. Ketik nomor atau perihal (minimal 3 karakter).
3. Klik kartu rangkaian untuk melihat panel **Alur Surat**.

## Daftar Perlu Dilengkapi
Tab **Perlu Dilengkapi** di Lacak Surat memuat surat dan rangkaian yang rantainya belum lengkap.

- **Tandai Selesai** pada baris surat masuk menutup surat yang tidak perlu didisposisikan atau dibalas (undangan, tembusan, edaran). Isi catatan minimal 10 karakter. Surat pindah ke **Siap diberkaskan**, statusnya menjadi **Sudah Dibalas**, dan dapat dibuka kembali dari rangkaiannya. Tombol ini hanya untuk admin unit pemilik surat dan surat yang belum punya rangkaian.
- Surat hasil impor (Google Sheets, CSV, XLSX) dan surat data lama tidak ditampilkan kecuali **Tampilkan data lama** dicentang.

Langkah lengkap ada di situs panduan, halaman Rangkaian Surat.

## Memberkaskan ke Direktorat
1. Pastikan tidak ada disposisi terbuka dan tidak ada surat keluar draf/menunggu/ditolak di rangkaian.
2. Klik **Berkaskan ke Direktorat (Unit Pengolah)**, pilih unit pengolah dan klasifikasi, lalu konfirmasi dua kali.

## Koreksi Berkas
Super admin mengajukan koreksi unit pengolah/klasifikasi dengan alasan minimal 10 karakter; super admin **lain** menyetujui atau menolak. Status diberkaskan sendiri tidak dapat dibuka kembali.

## Surat data lama
Surat dari aplikasi lama dirangkai sebagai data lama berstatus selesai. Label Kabag tetap label saja. Super admin atau admin unit pengawas dapat memakai **Tutup massal data lama** di tab Berkas Rangkaian setelah melihat pratinjau. Rangkaian yang tidak memiliki pengolah diberkaskan ke unit pencatat.
