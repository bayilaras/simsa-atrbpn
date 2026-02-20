# 🚀 Panduan Deploy Dokumentasi ke GitBook

Panduan detail langkah demi langkah untuk mempublikasikan dokumentasi SIMSA ke **GitBook** agar bisa diakses online seperti [shinigami-1.gitbook.io/docs](https://shinigami-1.gitbook.io/docs).

---

## 📋 Prasyarat

- ✅ Akun **GitHub** (sudah ada — repo `simsa-atrbpn`)
- ✅ Folder `docs/` sudah berisi file dokumentasi (sudah dibuat)
- ✅ Browser modern (Chrome/Firefox/Edge)

---

## Langkah 1: Push Folder `docs/` ke GitHub

Pastikan folder `docs/` sudah ter-push ke repository GitHub kamu.

### 1.1 Buka Terminal/PowerShell

Buka terminal di folder project `simsa-atrbpn`.

### 1.2 Jalankan Perintah Git

```powershell
# Pindah ke folder project (jika belum)
cd C:\Users\BPNSA\OneDrive\Desktop\Documents\Downloads\simsa-atrbpn

# Tambahkan folder docs ke staging
git add docs/

# Commit
git commit -m "docs: tambah panduan penggunaan SIMSA (GitBook format)"

# Push ke GitHub
git push origin main
```

> 💡 Kalau branch kamu bukan `main`, ganti `main` dengan nama branch kamu (misalnya `master`).

### 1.3 Verifikasi

Buka repository kamu di GitHub dan pastikan folder `docs/` sudah muncul.

---

## Langkah 2: Buat Akun GitBook

### 2.1 Buka Website GitBook

1. Buka browser dan akses: **https://www.gitbook.com/**
2. Klik tombol **"Get Started"** atau **"Sign Up"** di pojok kanan atas.

### 2.2 Daftar Akun

Ada beberapa cara daftar:

| Metode | Cara |
|--------|------|
| **GitHub** (Direkomendasikan ✅) | Klik "Continue with GitHub" — langsung terhubung |
| **Google** | Klik "Continue with Google" |
| **Email** | Masukkan email dan buat password |

> 💡 **Direkomendasikan:** Daftar pakai **GitHub** agar proses sinkronisasi lebih mudah.

### 2.3 Setup Awal

1. Setelah login, GitBook akan meminta kamu:
   - Pilih **jenis penggunaan** → Pilih "For my team" atau "For personal use"
   - Beri **nama organization** → Misalnya: `SIMSA Docs` atau `ATR-BPN`
2. Klik **Continue** / **Create**.

---

## Langkah 3: Buat Space (Ruang Dokumentasi) Baru

### 3.1 Buat Space

1. Setelah masuk dashboard GitBook, klik **"Create Space"** atau **"+"**.
2. Pilih **"Import from Git"** atau buat kosong dulu.
3. Beri nama space: **"Panduan SIMSA"** atau **"SIMSA Documentation"**.

---

## Langkah 4: Hubungkan dengan GitHub (Git Sync)

Ini adalah langkah paling penting! Git Sync membuat GitBook **otomatis membaca** file dari repository GitHub kamu.

### 4.1 Buka Pengaturan Git Sync

1. Di dalam Space yang baru dibuat, klik ikon **⚙️ Settings** (pojok kanan atas atau sidebar).
2. Cari menu **"Git Sync"** atau **"GitHub Integration"**.
3. Klik **"Configure"** atau **"Connect"**.

### 4.2 Authorize GitHub

1. GitBook akan meminta izin akses ke akun GitHub kamu.
2. Klik **"Authorize GitBook"**.
3. Pilih **repository** yang ingin dihubungkan:
   - Repository: **`bayilaras/simsa-atrbpn`** (atau nama repo kamu)
4. Klik **"Allow"** atau **"Install & Authorize"**.

### 4.3 Konfigurasi Git Sync

Setelah repository terhubung, atur konfigurasi berikut:

```
┌─────────────────────────────────────────────────┐
│  Git Sync Configuration                         │
├─────────────────────────────────────────────────┤
│                                                 │
│  Repository:  bayilaras/simsa-atrbpn           │
│  Branch:      main                              │
│  Root Path:   /docs          ← ⚠️ PENTING!     │
│                                                 │
│  Sync Direction:                                │
│    ○ GitBook to GitHub                          │
│    ○ GitHub to GitBook      ← Pilih ini         │
│    ○ Bidirectional                              │
│                                                 │
│             [ Save ]                            │
└─────────────────────────────────────────────────┘
```

**Pengaturan penting:**

| Setting | Nilai | Keterangan |
|---------|-------|------------|
| **Repository** | `bayilaras/simsa-atrbpn` | Repo GitHub kamu |
| **Branch** | `main` | Branch utama |
| **Root Path** | `/docs` | ⚠️ **WAJIB diisi!** Agar GitBook hanya membaca folder `docs/` |
| **Sync Direction** | `GitHub to GitBook` | Agar perubahan di GitHub otomatis muncul di GitBook |

### 4.4 Klik Save / Sync

1. Klik **"Save"** atau **"Start Sync"**.
2. GitBook akan mulai **mengimpor** semua file dari `docs/`.
3. Tunggu beberapa saat (biasanya 1-2 menit).

---

## Langkah 5: Verifikasi Hasil

### 5.1 Cek Navigasi

Setelah sync selesai, GitBook akan otomatis membaca `SUMMARY.md` dan membuat navigasi sidebar seperti ini:

```
┌─────────────────────────────────────┐
│  👋 Selamat Datang                  │
│                                     │
│  AKSES SIMSA                       │
│    ⚠️ Wajib BACA!                  │
│    🔑 Login Email & Password       │
│    📧 Daftar Menggunakan Email     │
│    🌐 Login Dengan Google          │
│                                     │
│  TUTORIAL DASAR                    │
│    🖥️ Browser yang Kompatibel      │
│    📋 Mengenal Dashboard           │
│    🧭 Navigasi Sidebar            │
│    👤 Role & Hak Akses            │
│                                     │
│  MANAJEMEN SURAT                   │
│    📨 Surat Masuk                  │
│    📤 Surat Keluar                 │
│    🔄 Distribusi Surat             │
│                                     │
│  ... (dan seterusnya)              │
└─────────────────────────────────────┘
```

### 5.2 Cek Setiap Halaman

1. Klik setiap menu di sidebar.
2. Pastikan konten muncul dengan benar.
3. Pastikan tabel, emoji, dan ASCII art tampil rapi.

---

## Langkah 6: Publish (Terbitkan)

### 6.1 Buat Space Public

1. Buka **⚙️ Settings** > **Visibility**.
2. Ubah dari **"Private"** menjadi **"Public"** (atau **"Unlisted"** jika hanya ingin diakses via link).
3. Klik **"Save"**.

### 6.2 Custom Domain (Opsional)

Secara default, URL dokumentasi kamu akan seperti:

```
https://[username].gitbook.io/[space-name]
```

Contoh:
```
https://bayilaras.gitbook.io/panduan-simsa
```

Kalau mau custom domain (misalnya `docs.simsa.go.id`):
1. Buka **⚙️ Settings** > **Custom Domain**.
2. Masukkan domain custom kamu.
3. Ikuti instruksi DNS yang diberikan GitBook.

---

## Langkah 7: Update Dokumentasi di Kemudian Hari

Kalau kamu ingin **mengubah atau menambah** halaman dokumentasi:

### Cara 1: Edit di VS Code (Direkomendasikan)

1. Edit file `.md` di folder `docs/` menggunakan VS Code.
2. Commit & push ke GitHub:

```powershell
git add docs/
git commit -m "docs: update panduan [nama halaman]"
git push origin main
```

3. GitBook akan **otomatis sync** dan menampilkan perubahan.

### Cara 2: Edit Langsung di GitBook

1. Login ke GitBook.
2. Buka space dokumentasi kamu.
3. Edit langsung di editor GitBook (WYSIWYG).
4. Perubahan akan otomatis sync ke GitHub (jika bidirectional).

---

## ❓ FAQ / Troubleshooting

### Q: Sidebar tidak muncul setelah sync?
> Pastikan file `SUMMARY.md` ada di root folder `docs/` dan formatnya sesuai. GitBook membaca `SUMMARY.md` untuk membuat navigasi.

### Q: Halaman kosong atau error?
> Periksa apakah path link di `SUMMARY.md` sesuai dengan lokasi file `.md` yang sebenarnya. Path bersifat **case-sensitive**.

### Q: Emoji tidak muncul?
> GitBook mendukung Unicode emoji secara native. Pastikan browser kamu sudah up-to-date.

### Q: Bisa edit di GitBook tanpa GitHub?
> Bisa! Kamu bisa membuat space tanpa Git Sync dan langsung edit di GitBook. Tapi disarankan pakai Git Sync agar ada backup di GitHub.

### Q: GitBook gratis atau berbayar?
> GitBook memiliki **plan gratis** (Personal/Community) yang sudah cukup untuk dokumentasi ini. Fitur yang termasuk:
> - ✅ Unlimited public spaces
> - ✅ Git Sync
> - ✅ Custom domain
> - ✅ Search
> - ❌ Advanced analytics (berbayar)
> - ❌ Multiple collaborators (berbayar, max 1 di free plan)

### Q: Apakah bisa pakai alternatif selain GitBook?
> Bisa! Alternatif lain yang mendukung format serupa:
> | Platform | Keterangan |
> |----------|------------|
> | **VitePress** | Static site generator (self-hosted) |
> | **Docusaurus** | By Meta, lebih fleksibel |
> | **MkDocs** | Python-based, simple |
> | **Read the Docs** | Gratis untuk open source |

---

## 📋 Checklist Deploy

Gunakan checklist ini untuk memastikan semua langkah sudah dilakukan:

- [ ] Folder `docs/` sudah di-push ke GitHub
- [ ] Akun GitBook sudah dibuat
- [ ] Space baru sudah dibuat di GitBook
- [ ] Git Sync sudah dikonfigurasi dengan root path `/docs`
- [ ] Sync berhasil dan semua halaman muncul
- [ ] Space sudah di-publish (public/unlisted)
- [ ] URL dokumentasi sudah bisa diakses

---

*Selamat! Dokumentasi SIMSA kamu sekarang bisa diakses online!* 🎉
