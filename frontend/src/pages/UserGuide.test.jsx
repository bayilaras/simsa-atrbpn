import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import UserGuide from './UserGuide'

// Sifat surat masuk sekaligus kelas keamanannya. Panduan menjelaskan batas
// kelas impor per peran, sifat yang tidak dikenal, dan pratinjau yang tidak
// memeriksa baris. Topik surat hanya untuk admin, dan filter peran mengikuti
// peran pengguna, jadi pengguna uji adalah Admin Unit Kerja.
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', name: 'Siti', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: {} }) }))

const show = () => render(<MemoryRouter><UserGuide /></MemoryRouter>)
const topik = id => document.getElementById(id)

afterEach(cleanup)

describe('panduan impor surat masuk', () => {
    it('menjelaskan batas kelas impor, sifat yang dibaca Biasa, dan sifat yang tidak dikenal', () => {
        show()
        const surat = topik('surat-masuk-keluar')
        expect(surat).toHaveTextContent(/hanya dapat diimpor oleh Super Admin/)
        expect(surat).toHaveTextContent('Klasifikasi keamanan melebihi kewenangan pengguna')
        expect(surat).toHaveTextContent('Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen')
        expect(surat).toHaveTextContent('Sifat surat tidak dikenal')
        expect(surat).toHaveTextContent('Amat Segera/Kilat, Penting, dan Undangan dibaca Biasa, begitu pula sel kosong atau “-”')
        expect(surat).toHaveTextContent('Pratinjau mencantumkan baris yang akan ditolak beserta alasannya sebelum Impor')
        // Formulir surat masuk menyediakan Terbatas bagi admin serta Rahasia dan Sangat Rahasia bagi Super Admin.
        expect(surat).toHaveTextContent('admin dapat memilih sifat Terbatas')
        expect(surat).toHaveTextContent('hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya')
        expect(surat).toHaveTextContent('menyediakan pilihan Rahasia dan Sangat Rahasia bagi Super Admin')
        expect(surat).toHaveTextContent('sifat surat masuk tidak ikut diubah, dan surat yang sedang atau telah disetujui')
        expect(topik('mulai-inventaris-internal'))
            .toHaveTextContent('Bila Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen mengimpornya, baris itu ditolak')
        expect(document.body).not.toHaveTextContent('Admin Ditjen')
    })

    it('menemukan topik impor surat masuk dengan kata kunci “rahasia”', () => {
        show()
        fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'rahasia' } })
        expect(topik('surat-masuk-keluar')).toBeInTheDocument()
        expect(topik('mulai-inventaris-internal')).toBeInTheDocument()
        expect(topik('masuk-dan-navigasi')).toBeNull()
    })

    it('masalah umum menjelaskan baris impor surat masuk yang ditolak karena sifatnya', () => {
        show()
        const masalah = screen.getByText('Baris impor surat masuk ditolak karena sifat atau klasifikasi keamanan').closest('details')
        expect(masalah).toHaveTextContent('Klasifikasi keamanan melebihi kewenangan pengguna')
        expect(masalah).toHaveTextContent('Jangan menurunkan sifat pada sumber agar baris lolos')
        expect(masalah).toHaveTextContent('menyediakan pilihan Rahasia dan Sangat Rahasia bagi Super Admin')
        expect(masalah).toHaveTextContent('tetap melaporkan baris itu Ditolak')
        expect(masalah).toHaveTextContent('tanpa persetujuan akses rekod')
        expect(masalah).toHaveTextContent('Sifat surat tidak dikenal')
        expect(masalah).toHaveTextContent('termasuk Super Admin')
    })
})

describe('topik alur harian dan bantuan', () => {
    it('menjelaskan cara mengganti kata sandi di Pengaturan › Profil', () => {
        show()
        const topikSandi = topik('ganti-kata-sandi')
        expect(topikSandi).toHaveTextContent('Buka menu akun di kanan atas, lalu pilih Pengaturan. Halaman Pengaturan terbuka pada tab Profil.')
        expect(topikSandi).toHaveTextContent('lalu tekan Simpan Kata Sandi')
        expect(topikSandi).toHaveTextContent('Kata sandi baru minimal 12 karakter')
        expect(screen.getByRole('link', { name: /Buka Pengaturan/ })).toHaveAttribute('href', '/settings')
        fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'kata sandi' } })
        expect(topik('ganti-kata-sandi')).toBeInTheDocument()
    })

    it('menjelaskan persetujuan surat keluar sebelum diarsipkan, termasuk pengajuan dan persetujuan sekaligus', () => {
        show()
        const persetujuan = topik('persetujuan-surat-keluar')
        expect(persetujuan).toHaveTextContent('Tombol Arsipkan baru muncul setelah surat berstatus Disetujui.')
        expect(persetujuan).toHaveTextContent('menekan Ajukan Persetujuan, lalu memilih penyetuju')
        expect(persetujuan).toHaveTextContent('Penolakan wajib disertai catatan')
        expect(persetujuan).toHaveTextContent('centang surat di daftar Surat Keluar, lalu pilih Ajukan Persetujuan atau Setujui')
    })

    it('menjelaskan menu Tindak Lanjut dan Lacak Surat', () => {
        show()
        expect(topik('tindak-lanjut-surat')).toHaveTextContent('tekan tombol Tindak Lanjut')
        expect(topik('tindak-lanjut-surat')).toHaveTextContent('Saya Balas dan Buat Nota Dinas membuka formulir Tambah Surat Keluar')
        expect(topik('lacak-surat')).toHaveTextContent('Buka Surat › Lacak Surat di sidebar.')
        expect(topik('lacak-surat')).toHaveTextContent('Tab Perlu Dilengkapi')
    })

    it('menjelaskan surat terhapus untuk Super Admin', () => {
        show()
        expect(topik('surat-terhapus')).toBeNull()
        fireEvent.change(screen.getByLabelText('Tampilkan untuk peran'), { target: { value: 'super_admin' } })
        expect(topik('surat-terhapus')).toHaveTextContent('pilih tab Surat Terhapus di atas daftar')
        expect(topik('surat-terhapus')).toHaveTextContent('Hanya Super Admin yang dapat melihat dan memulihkannya')
    })

    it('menautkan situs panduan lengkap dan menyebut tempat bertanya', () => {
        show()
        const tautan = screen.getAllByRole('link', { name: /Panduan lengkap|simsa-atrbpn\.vercel\.app/ })
        expect(tautan).toHaveLength(2)
        for (const item of tautan) {
            expect(item).toHaveAttribute('href', 'https://simsa-atrbpn.vercel.app')
            expect(item).toHaveAttribute('target', '_blank')
            expect(item).toHaveAttribute('rel', 'noopener noreferrer')
        }
        expect(screen.getByText('Hubungi Super Admin unit Anda bila masih ada kendala.')).toBeInTheDocument()
    })

    it('masalah umum menjelaskan pemulihan isian setelah sesi berakhir, versi baru, dan unggahan lambat', () => {
        show()
        expect(screen.getByText('Sesi berakhir saat bekerja').closest('details'))
            .toHaveTextContent('isian yang belum disimpan ditawarkan untuk dipulihkan')
        expect(screen.getByText('Muncul pemberitahuan versi baru SIMSA').closest('details'))
            .toHaveTextContent('tekan Muat ulang pada pemberitahuan')
        expect(screen.getByText('Unggah berkas PDF lama atau gagal').closest('details'))
            .toHaveTextContent('kecilkan ukuran PDF')
    })
})
