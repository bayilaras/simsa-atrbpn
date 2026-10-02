import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ getBySurat: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))

import { AlurSuratPanel } from '../AlurSuratPanel'

const detail = {
    rangkaian: {
        id: 'r1', kode: 'RS-2026-000002', status: 'aktif', asal: 'surat_masuk',
        judul: 'Rangkaian RS-2026-000002 (Dikecualikan)', tahun: 2026,
        unitPencatat: { id: 'sesditjen', nama: 'Sekretariat Ditjen' }, unitPengolah: { id: 'dir_bppt', nama: 'Dit. BPPT' },
        klasifikasiItemId: null, lanjutanDariId: null, selesaiAt: null, selesaiManual: false,
        diberkaskanAt: null, createdAt: '2026-09-01T00:00:00.000Z',
    },
    dialihkanDari: null,
    aksesMelalui: 'pengawas',
    peserta: [
        { unitKerjaId: 'sesditjen', nama: 'Sekretariat Ditjen', sumber: 'pencatat' },
        { unitKerjaId: 'dir_ptep', nama: 'Dit. PTEP', sumber: 'disposisi' },
    ],
    anggota: [
        { anggotaId: 'a1', jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false },
        {
            anggotaId: 'a2', jenis: 'surat_keluar', suratId: 's2', peran: 'anggota', unitKerjaId: 'dir_ptep', unitNama: 'Dit. PTEP',
            nomorSurat: 'ND-1/PTEP/2026', perihal: 'Tanggapan PTEP', tanggalSurat: '2026-09-07', dari: null, kepada: 'Sesditjen',
            naskahDinas: 'Nota Dinas', approvalStatus: 'draft', ditambahkanAt: '2026-09-07T01:00:00.000Z', masked: false, aksesMelalui: 'pengawas',
        },
    ],
    // Dua relasi keluar dari node yang sama (a2) -- F7b: keduanya harus tetap
    // tampil, bukan hanya yang terakhir diproses.
    relasi: [
        { id: 'x1', dariAnggotaId: 'a2', keAnggotaId: 'a1', jenisRelasi: 'tindak_lanjut', keterangan: null, createdAt: '2026-09-07T01:00:00.000Z' },
        { id: 'x2', dariAnggotaId: 'a2', keAnggotaId: 'a1', jenisRelasi: 'menjelaskan', keterangan: null, createdAt: '2026-09-07T02:00:00.000Z' },
    ],
    disposisi: [{
        id: 'd1', suratMasukAnggotaId: 'a1', targetUnit: { id: 'dir_ptep', nama: 'Dit. PTEP' }, status: 'sent',
        sentAt: '2026-09-02T00:00:00.000Z', receivedAt: null, processedAt: null, batasWaktu: '2026-10-01',
        penanggungJawab: true, ditutupPengawas: false, instruction: null, catatanPenyelesaian: null,
        rejectionReason: null, penyelesaianAnggotaId: null, masked: true,
    }],
    rangkaianTerkait: [{ id: 'r9', kode: 'RS-2026-000009', status: 'aktif', hubungan: 'dilanjutkan_oleh' }],
    aksiDiizinkan: [],
    truncated: true,
}

const renderPanel = (props) => render(
    <MemoryRouter>
        <AlurSuratPanel jenis="surat_masuk" suratId="s1" {...props} />
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('menampilkan kode, status, alur unit, peserta, dan banner baca untuk pengawas (tanpa klaim jalur rangkaian)', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    expect(await screen.findByText('Alur Surat')).toBeInTheDocument()
    expect(mocks.getBySurat).toHaveBeenCalledWith('surat_masuk', 's1')
    // F7c: jalur pengawas bisa berasal dari jangkauan record-level atas satu
    // anggota saja, bukan selalu jangkauan rangkaian -- banner tidak lagi
    // mengklaim "melalui rangkaian".
    expect(screen.getByRole('note')).toHaveTextContent('Anda melihat surat ini sebagai unit pengawas (hanya baca).')
    expect(screen.getByRole('note')).not.toHaveTextContent('melalui rangkaian')
    expect(screen.getByText('Aktif')).toBeInTheDocument()
    expect(screen.getByText('Sekretariat Ditjen → Dit. BPPT')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Peserta rangkaian' })).getByText('Dit. PTEP')).toBeInTheDocument()
})

it('menampilkan banner peserta dengan kode rangkaian (kata-kata lain tidak berubah)', async () => {
    mocks.getBySurat.mockResolvedValue({ ...detail, aksesMelalui: 'peserta' })
    renderPanel({ aksesMelalui: 'peserta' })
    expect(await screen.findByText('Alur Surat')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Dilihat melalui rangkaian RS-2026-000002 sebagai peserta rangkaian. Akses baca saja.')
})

it('menampilkan status tindak lanjut per penerima dengan instruksi tersamar', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    const tabel = within(await screen.findByRole('region', { name: 'Status tindak lanjut per penerima' }))
    expect(tabel.getByText('Dit. PTEP')).toBeInTheDocument()
    expect(tabel.getByText('Penanggung jawab')).toBeInTheDocument()
    expect(tabel.getByText('Terkirim')).toBeInTheDocument()
    expect(tabel.getByText('2026-10-01')).toBeInTheDocument()
    expect(tabel.getAllByText('Dikecualikan')).toHaveLength(2)
})

it('menampilkan linimasa dengan node tersamar, label relasi, rangkaian terkait, dan pemotongan', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    const { container } = renderPanel({ aksesMelalui: 'pengawas' })
    const linimasa = within(await screen.findByRole('region', { name: 'Linimasa rangkaian' }))
    expect(linimasa.getByText('Tanggapan PTEP')).toBeInTheDocument()
    // F7b: node a2 punya dua relasi keluar (tindak_lanjut dan menjelaskan);
    // keduanya harus dirender, bukan hanya yang terakhir.
    expect(linimasa.getByText('Tindak lanjut')).toBeInTheDocument()
    expect(linimasa.getByText('Menjelaskan')).toBeInTheDocument()
    expect(linimasa.getByText('Dikecualikan')).toBeInTheDocument()
    expect(container.querySelector('[data-masked="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('lebih dari 300')
    expect(screen.getByText(/RS-2026-000009/)).toBeInTheDocument()
})

it('tidak menampilkan aksi tulis di P2', async () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    await screen.findByText('Alur Surat')
    expect(screen.queryByRole('button', { name: /berkaskan|gabungkan|tutup disposisi|ajukan akses|tandai selesai/i })).toBeNull()
})

it('tidak menampilkan banner untuk pemilik', async () => {
    mocks.getBySurat.mockResolvedValue({ ...detail, aksesMelalui: 'owner' })
    renderPanel({ aksesMelalui: 'owner' })
    await screen.findByText('Alur Surat')
    expect(screen.queryByRole('note')).toBeNull()
})

it('merender fallback untuk surat tunggal', async () => {
    mocks.getBySurat.mockResolvedValue(null)
    renderPanel({ fallback: <a href="/surat/masuk/x">Lihat Surat Masuk</a> })
    expect(await screen.findByText('Lihat Surat Masuk')).toBeInTheDocument()
    expect(screen.queryByText('Alur Surat')).toBeNull()
})

it('menampilkan pesan bila gagal dimuat', async () => {
    mocks.getBySurat.mockRejectedValue(new Error('boom'))
    renderPanel({})
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Alur surat tidak dapat dimuat.')
})

it('menampilkan pesan netral (bukan error) bila surat tidak tersedia (404)', async () => {
    const notFoundError = new Error('Not Found')
    notFoundError.status = 404
    mocks.getBySurat.mockRejectedValue(notFoundError)
    renderPanel({})
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Alur surat tidak tersedia untuk Anda.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Alur surat tidak dapat dimuat.')).toBeNull()
})

it('menampilkan status memuat dengan role status dan aria-busy', () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Memuat alur surat')
})
