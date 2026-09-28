import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
    getBySurat: vi.fn(), tandaiSelesai: vi.fn(), tutupDisposisi: vi.fn(), ajukanAkses: vi.fn(), batalRelasi: vi.fn(),
    koreksiSection: vi.fn(() => null),
}))
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: (props) => mocks.koreksiSection(props) }))
vi.mock('@/services/rangkaian.service', () => {
    const svc = {
        getBySurat: mocks.getBySurat, tandaiSelesai: mocks.tandaiSelesai, tutupDisposisi: mocks.tutupDisposisi,
        ajukanAkses: mocks.ajukanAkses, batalRelasi: mocks.batalRelasi,
    }
    return { default: svc, rangkaianService: svc }
})

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

// F1: onChanged HANYA boleh terpanggil lewat muatUlang (tombol "Coba lagi"),
// TIDAK pada muat awal -- itulah pola yang dulu membentuk loop tak berujung
// saat parent membongkar panel ini lewat gerbang `if (loading)`.
it('tidak memanggil onChanged pada muat awal, hanya lewat tombol Coba Lagi setelah gagal', async () => {
    const onChanged = vi.fn()
    mocks.getBySurat.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(detail)
    renderPanel({ aksesMelalui: 'pengawas', onChanged })
    const alert = await screen.findByRole('alert')
    expect(onChanged).not.toHaveBeenCalled()
    fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }))
    await screen.findByText('Alur Surat')
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(mocks.getBySurat).toHaveBeenCalledTimes(2)
})

// N1: parent (halaman detail) menaikkan muatUlangKe setelah aksi seperti
// Terima/Arsip/Distribusi sukses -- ini HARUS memicu pemuatan ulang panel
// (effect deps [jenis, suratId, muatKe, muatUlangKe]), tapi TIDAK boleh lewat
// onChanged (yang hanya untuk jalur muatUlang/"Coba lagi" milik panel sendiri,
// lihat F1), supaya tidak membentuk loop dengan fetchSurat parent.
it('muatUlangKe yang dinaikkan parent memuat ulang panel tanpa memanggil onChanged', async () => {
    const onChanged = vi.fn()
    mocks.getBySurat.mockResolvedValue(detail)
    const { rerender } = renderPanel({ aksesMelalui: 'pengawas', onChanged, muatUlangKe: 0 })
    await screen.findByText('Alur Surat')
    expect(mocks.getBySurat).toHaveBeenCalledTimes(1)
    rerender(
        <MemoryRouter>
            <AlurSuratPanel jenis="surat_masuk" suratId="s1" aksesMelalui="pengawas" onChanged={onChanged} muatUlangKe={1} />
        </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.getBySurat).toHaveBeenCalledTimes(2))
    expect(onChanged).not.toHaveBeenCalled()
})

it('menampilkan status memuat dengan role status dan aria-busy', () => {
    mocks.getBySurat.mockResolvedValue(detail)
    renderPanel({ aksesMelalui: 'pengawas' })
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Memuat alur surat')
})

describe('aksi panel (Task 25)', () => {
    it('banner pengawas tanpa kata "hanya baca" bila server menawarkan aksi', async () => {
        mocks.getBySurat.mockResolvedValue({ ...detail, aksiDiizinkan: ['gabung'] })
        renderPanel({ aksesMelalui: 'pengawas' })
        expect(await screen.findByRole('note')).toHaveTextContent('Anda melihat surat ini sebagai unit pengawas.')
        expect(screen.getByRole('note')).not.toHaveTextContent('hanya baca')
    })

    it('banner peserta tanpa "Akses baca saja" bila server menawarkan aksi', async () => {
        mocks.getBySurat.mockResolvedValue({ ...detail, aksiDiizinkan: ['tandai_selesai'] })
        renderPanel({ aksesMelalui: 'peserta' })
        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent('Dilihat melalui rangkaian RS-2026-000002 sebagai peserta rangkaian.')
        expect(note).not.toHaveTextContent('Akses baca saja')
    })

    it('aksi rangkaian memuat ulang panel dan memanggil onChanged', async () => {
        const onChanged = vi.fn()
        mocks.getBySurat.mockResolvedValue({ ...detail, aksiDiizinkan: ['tandai_selesai'] })
        mocks.tandaiSelesai.mockResolvedValue({})
        renderPanel({ aksesMelalui: 'pengawas', onChanged })
        fireEvent.click(await screen.findByRole('button', { name: 'Tandai Selesai' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: 'Ditangani lewat rapat koordinasi' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan' }))
        await waitFor(() => expect(mocks.tandaiSelesai).toHaveBeenCalledWith('r1', 'Ditangani lewat rapat koordinasi'))
        await waitFor(() => expect(mocks.getBySurat).toHaveBeenCalledTimes(2))
        expect(onChanged).toHaveBeenCalledTimes(1)
    })

    it('kolom Aksi dan Tutup Disposisi hanya muncul dengan aksi tutup_disposisi', async () => {
        const baris = [
            { ...detail.disposisi[0], dapatDitutup: true },
            { ...detail.disposisi[0], id: 'd2', targetUnit: { id: 'dir_bppt', nama: 'Dit. BPPT' }, status: 'processed', penanggungJawab: false, dapatDitutup: false },
            // F-I3: baris terbuka yang SM-nya di luar cakupan pengawas — server menyatakan tidak dapat ditutup.
            { ...detail.disposisi[0], id: 'd3', targetUnit: { id: 'dir_plp', nama: 'Dit. PLP' }, status: 'sent', penanggungJawab: false, dapatDitutup: false },
            // Tanpa bendera dari server: fail-closed, tidak ada tombol.
            { ...detail.disposisi[0], id: 'd4', targetUnit: { id: 'dir_ktpp', nama: 'Dit. KTPP' }, status: 'received', penanggungJawab: false },
        ]
        mocks.getBySurat.mockResolvedValue({ ...detail, disposisi: baris, aksiDiizinkan: ['tutup_disposisi'] })
        mocks.tutupDisposisi.mockResolvedValue({})
        renderPanel({ aksesMelalui: 'pengawas' })
        const tabel = within(await screen.findByRole('region', { name: 'Status tindak lanjut per penerima' }))
        expect(tabel.getByRole('columnheader', { name: 'Aksi' })).toBeInTheDocument()
        // Hanya baris yang dinyatakan server dapatDitutup yang menawarkan tombol.
        expect(tabel.getAllByRole('button', { name: 'Tutup Disposisi' })).toHaveLength(1)
        expect(within(tabel.getByText('Dit. PLP').closest('tr')).queryByRole('button', { name: 'Tutup Disposisi' })).toBeNull()
        fireEvent.click(tabel.getByRole('button', { name: 'Tutup Disposisi' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Unit tujuan tidak dapat memproses' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Tutup Disposisi' }))
        await waitFor(() => expect(mocks.tutupDisposisi).toHaveBeenCalledWith('d1', 'Unit tujuan tidak dapat memproses'))
        await waitFor(() => expect(mocks.getBySurat).toHaveBeenCalledTimes(2))
    })

    it('tanpa tutup_disposisi tidak ada kolom Aksi', async () => {
        mocks.getBySurat.mockResolvedValue(detail)
        renderPanel({ aksesMelalui: 'pengawas' })
        const tabel = within(await screen.findByRole('region', { name: 'Status tindak lanjut per penerima' }))
        expect(tabel.queryByRole('columnheader', { name: 'Aksi' })).toBeNull()
        expect(tabel.queryByRole('button', { name: 'Tutup Disposisi' })).toBeNull()
    })

    it('node tersamar menawarkan Ajukan Akses hanya bila dapatAjukanAkses', async () => {
        const anggota = [{ ...detail.anggota[0], dapatAjukanAkses: true }, detail.anggota[1]]
        mocks.getBySurat.mockResolvedValue({ ...detail, anggota })
        mocks.ajukanAkses.mockResolvedValue({})
        renderPanel({ aksesMelalui: 'pengawas' })
        const linimasa = within(await screen.findByRole('region', { name: 'Linimasa rangkaian' }))
        fireEvent.click(linimasa.getByRole('button', { name: 'Ajukan Akses' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Tujuan akses'), { target: { value: 'Menyusun jawaban atas surat pengaduan' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Ajukan' }))
        await waitFor(() => expect(mocks.ajukanAkses).toHaveBeenCalledWith('a1', 'Menyusun jawaban atas surat pengaduan'))
    })

    it('node tersamar tanpa dapatAjukanAkses tidak menawarkan Ajukan Akses', async () => {
        mocks.getBySurat.mockResolvedValue(detail)
        renderPanel({ aksesMelalui: 'pengawas' })
        await screen.findByText('Alur Surat')
        expect(screen.queryByRole('button', { name: 'Ajukan Akses' })).toBeNull()
    })

    it('Batalkan Relasi tampil per relasi aktif pada node asal hanya dengan aksi batal_relasi', async () => {
        mocks.getBySurat.mockResolvedValue({ ...detail, aksiDiizinkan: ['batal_relasi'] })
        mocks.batalRelasi.mockResolvedValue({})
        renderPanel({ aksesMelalui: 'pengawas' })
        const linimasa = within(await screen.findByRole('region', { name: 'Linimasa rangkaian' }))
        expect(linimasa.getAllByRole('button', { name: /Batalkan Relasi/ })).toHaveLength(2)
        fireEvent.click(linimasa.getByRole('button', { name: 'Batalkan Relasi Menjelaskan' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Relasi dibuat keliru' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Batalkan' }))
        await waitFor(() => expect(mocks.batalRelasi).toHaveBeenCalledWith('x2', 'Relasi dibuat keliru'))
    })

    it('tanpa batal_relasi tidak ada tombol Batalkan Relasi', async () => {
        mocks.getBySurat.mockResolvedValue(detail)
        renderPanel({ aksesMelalui: 'pengawas' })
        await screen.findByText('Alur Surat')
        expect(screen.queryByRole('button', { name: /Batalkan Relasi/ })).toBeNull()
    })

    it('memasang Koreksi Berkas dengan id/status rangkaian dan muatUlang panel (P5-T9-2)', async () => {
        const onChanged = vi.fn()
        mocks.getBySurat.mockResolvedValue({ ...detail, rangkaian: { ...detail.rangkaian, status: 'diberkaskan' } })
        renderPanel({ onChanged })
        await screen.findByText('Alur Surat')
        const props = mocks.koreksiSection.mock.lastCall[0]
        expect(props).toMatchObject({ rangkaianId: 'r1', status: 'diberkaskan' })
        props.onChanged()
        await waitFor(() => expect(mocks.getBySurat).toHaveBeenCalledTimes(2))
        expect(onChanged).toHaveBeenCalledTimes(1)
    })
})
