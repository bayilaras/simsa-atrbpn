import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import UserGuide from './UserGuide'

// Halaman ini hanya meringkas; langkah lengkap ada di situs panduan
// (docs-site/). Topik surat hanya untuk admin, dan filter peran mengikuti
// peran pengguna, jadi pengguna uji adalah Admin Unit Kerja.
const state = vi.hoisted(() => ({ capabilities: {} }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', name: 'Siti', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: state.capabilities }) }))

const SITUS = 'https://simsa-atrbpn.vercel.app'
const show = () => render(<MemoryRouter><UserGuide /></MemoryRouter>)
const topik = id => document.getElementById(id)
const tautanSitus = (root = document) => [...root.querySelectorAll(`a[href^="${SITUS}"]`)]

beforeEach(() => { state.capabilities = {} })
afterEach(cleanup)

describe('ringkasan surat dan impor', () => {
    it('menyebut batas kelas keamanan surat masuk dan menautkan aturan impor', () => {
        show()
        const surat = topik('surat-masuk-keluar')
        expect(surat).toHaveTextContent('Sifat surat masuk sekaligus menjadi klasifikasi keamanannya.')
        expect(surat).toHaveTextContent('Rahasia dan Sangat Rahasia hanya dapat ditetapkan atau diimpor oleh Super Admin.')
        expect(surat).toHaveTextContent('hanya dapat dibuka atau diubah dengan persetujuan akses berjangka, juga oleh pencatatnya')
        expect(within(surat).getByRole('link', { name: /Aturan impor CSV\/XLSX/ }))
            .toHaveAttribute('href', `${SITUS}/panduan-pengguna#impor-daftar-csv-atau-xlsx`)
        expect(document.body).not.toHaveTextContent('Admin Ditjen')
    })

    it('menemukan topik surat dengan kata kunci “rahasia”', () => {
        show()
        fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'rahasia' } })
        expect(topik('surat-masuk-keluar')).toBeInTheDocument()
        expect(topik('masuk-dan-navigasi')).toBeNull()
    })

    it('masalah umum menjelaskan baris impor surat masuk yang ditolak karena sifatnya', () => {
        show()
        const masalah = screen.getByText('Baris impor surat masuk ditolak karena sifat atau klasifikasi keamanan').closest('details')
        expect(masalah).toHaveTextContent('Klasifikasi keamanan melebihi kewenangan pengguna')
        expect(masalah).toHaveTextContent('Admin Unit Kerja, Admin Dirjen, atau Admin Sesditjen')
        expect(masalah).toHaveTextContent('Jangan menurunkan sifat pada sumber agar baris lolos')
        expect(masalah).toHaveTextContent('Sifat surat tidak dikenal')
        expect(masalah).toHaveTextContent('termasuk Super Admin')
        expect(within(masalah).getByRole('link', { name: /Aturan impor CSV\/XLSX/ }))
            .toHaveAttribute('href', `${SITUS}/panduan-pengguna#impor-daftar-csv-atau-xlsx`)
    })
})

describe('topik alur harian dan bantuan', () => {
    it('meringkas cara mengganti kata sandi di Pengaturan › Profil', () => {
        show()
        const topikSandi = topik('ganti-kata-sandi')
        expect(topikSandi).toHaveTextContent('Buka menu akun di kanan atas, pilih Pengaturan, lalu isi kartu Ubah Kata Sandi pada tab Profil.')
        expect(topikSandi).toHaveTextContent('Kata sandi baru minimal 12 karakter')
        expect(screen.getByRole('link', { name: /Buka Pengaturan/ })).toHaveAttribute('href', '/settings')
        expect(within(topikSandi).getByRole('link', { name: /Ubah kata sandi/ }))
            .toHaveAttribute('href', `${SITUS}/administrasi/settings#ubah-kata-sandi`)
        fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'kata sandi' } })
        expect(topik('ganti-kata-sandi')).toBeInTheDocument()
    })

    it('meringkas persetujuan surat keluar sebelum diarsipkan', () => {
        show()
        const persetujuan = topik('persetujuan-surat-keluar')
        expect(persetujuan).toHaveTextContent('Tombol Arsipkan baru muncul setelah surat berstatus Disetujui.')
        expect(persetujuan).toHaveTextContent('Pembuat menekan Ajukan Persetujuan dan memilih penyetuju')
        expect(persetujuan).toHaveTextContent('penolakan wajib disertai catatan')
        expect(persetujuan).toHaveTextContent('diajukan atau disetujui sekaligus dari daftar Surat Keluar')
    })

    it('meringkas menu Tindak Lanjut dan Lacak Surat', () => {
        show()
        expect(topik('tindak-lanjut-surat')).toHaveTextContent('Tombol Tindak Lanjut ada di detail surat masuk dan surat keluar')
        expect(topik('tindak-lanjut-surat')).toHaveTextContent('Saya Balas dan Buat Nota Dinas membuka formulir Tambah Surat Keluar')
        expect(topik('lacak-surat')).toHaveTextContent('Buka Surat › Lacak Surat di sidebar')
        expect(topik('lacak-surat')).toHaveTextContent('Tab Perlu Dilengkapi')
    })

    it('meringkas surat terhapus untuk Super Admin', () => {
        show()
        expect(topik('surat-terhapus')).toBeNull()
        fireEvent.change(screen.getByLabelText('Tampilkan untuk peran'), { target: { value: 'super_admin' } })
        expect(topik('surat-terhapus')).toHaveTextContent('pilih tab Surat Terhapus di atas daftar')
        expect(topik('surat-terhapus')).toHaveTextContent('Hanya Super Admin yang dapat melihat dan memulihkannya')
    })

    it('menautkan situs panduan lengkap dan menyebut tempat bertanya', () => {
        show()
        const tautan = screen.getAllByRole('link', { name: /^Panduan lengkap|^simsa-atrbpn\.vercel\.app/ })
        expect(tautan).toHaveLength(2)
        for (const item of tautan) expect(item).toHaveAttribute('href', SITUS)
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
        expect(screen.getByRole('link', { name: /Pemecahan masalah/ }))
            .toHaveAttribute('href', `${SITUS}/panduan-pengguna#17-pemecahan-masalah`)
    })
})

describe('tautan ke situs panduan', () => {
    const tampilkanSemuaPeran = () => {
        show()
        fireEvent.change(screen.getByLabelText('Tampilkan untuk peran'), { target: { value: 'semua' } })
    }

    it('setiap topik ringkas, bertautan ke situs panduan, dan tautannya membuka tab baru', () => {
        tampilkanSemuaPeran()
        const kartu = [...document.querySelectorAll('#isi-panduan [id]')].filter(el => el.id !== 'alur-fitur')
        expect(kartu).toHaveLength(15)
        for (const item of kartu) {
            expect(tautanSitus(item).length, item.id).toBeGreaterThanOrEqual(1)
            expect(item.querySelectorAll('li > span').length, item.id).toBeLessThanOrEqual(3)
        }
        for (const item of tautanSitus()) {
            expect(item).toHaveAttribute('target', '_blank')
            expect(item).toHaveAttribute('rel', 'noopener noreferrer')
        }
    })

    // Slug judul seperti yang dibuat Docusaurus (github-slugger) untuk judul tanpa emoji.
    const slug = judul => judul.trim().toLowerCase()
        .replace(/[`*_]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s/g, '-')
    const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs-site/docs')

    it.skipIf(!existsSync(DOCS))('setiap tautan menunjuk halaman dan judul yang ada di docs-site/docs', () => {
        const alamat = new Set()
        for (const capabilities of [{}, { advancedArchiveWorkflows: false }]) {
            state.capabilities = capabilities
            tampilkanSemuaPeran()
            for (const item of tautanSitus()) alamat.add(item.getAttribute('href').slice(SITUS.length))
            cleanup()
        }
        expect(alamat.size).toBeGreaterThan(20)
        for (const item of alamat) {
            if (!item) continue
            const [halaman, jangkar] = item.split('#')
            const berkas = path.join(DOCS, `${halaman}.md`)
            expect(existsSync(berkas), `${item}: berkas ${halaman}.md`).toBe(true)
            if (!jangkar) continue
            const judul = readFileSync(berkas, 'utf8').split(/\r?\n/)
                .filter(baris => /^#{2,4} /.test(baris))
                .map(baris => slug(baris.replace(/^#+ /, '')))
            expect(judul, `${item}: judul #${jangkar}`).toContain(jangkar)
        }
    })
})
