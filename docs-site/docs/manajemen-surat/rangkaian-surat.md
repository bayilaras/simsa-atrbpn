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
