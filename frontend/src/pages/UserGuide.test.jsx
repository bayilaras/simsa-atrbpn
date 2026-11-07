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
        expect(surat).toHaveTextContent('Pratinjau hanya menampilkan isi sumber')
        // Formulir surat masuk menyediakan Terbatas bagi admin serta Rahasia dan Sangat Rahasia bagi Super Admin.
        expect(surat).toHaveTextContent('admin dapat memilih sifat Terbatas')
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
