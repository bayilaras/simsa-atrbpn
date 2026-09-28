import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AjukanAksesButton, AlurSuratActions, BatalRelasiButton, TautkanDialog, TutupDisposisiButton } from '../AlurSuratActions'

const mocks = vi.hoisted(() => ({
    svc: {
        tandaiSelesai: vi.fn(), bukaKembali: vi.fn(), opsiBerkas: vi.fn(), berkaskan: vi.fn(), ubahUnitPengolah: vi.fn(),
        pratinjauGabung: vi.fn(), gabung: vi.fn(), tutupDisposisi: vi.fn(), ajukanAkses: vi.fn(), batalRelasi: vi.fn(),
        tautkanKeSurat: vi.fn(), lacak: vi.fn(),
    },
    toast: vi.fn(),
}))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: mocks.svc, default: mocks.svc }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/KlasifikasiPicker', () => ({
    KlasifikasiPicker: ({ onChange }) => <button type="button" onClick={() => onChange('PT.02', { id: 9, kode: 'PT.02', jenis: 'Pengadaan tanah' }, null)}>Pilih klasifikasi lain</button>,
}))
vi.mock('@/components/surat-keluar/ReferensiSection', () => ({
    ReferensiSection: ({ referensi, onPilih, label }) => (referensi
        ? <p>{label}: {referensi.nomorSurat}</p>
        : <button type="button" onClick={() => onPilih({ jenis: 'surat_keluar', suratId: 'sk-9', nomorSurat: 'ND-9/2026', perihal: 'Rujukan', jenisRelasi: 'tindak_lanjut', terkunci: false })}>Pilih surat tujuan</button>),
}))

const peserta = [
    { unitKerjaId: 'sesditjen', nama: 'Sekretariat Ditjen', sumber: 'pencatat' },
    { unitKerjaId: 'dir_bppt', nama: 'Dit. BPPT', sumber: 'pengolah' },
]
const detail = (aksi) => ({ rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'selesai' }, aksiDiizinkan: aksi, disposisi: [], relasi: [], peserta })

beforeEach(() => {
    vi.clearAllMocks()
    for (const fn of Object.values(mocks.svc)) fn.mockResolvedValue({})
    mocks.svc.opsiBerkas.mockResolvedValue({
        status: 'selesai', unitPengolahId: 'dir_bppt', klasifikasiInduk: { id: 7, kode: 'PT.01', jenis: 'Penetapan hak' },
        unitDalamJangkauan: [{ id: 'dir_bppt', name: 'Dit. BPPT' }, { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal' }, { id: 'dir_ptep', name: 'Dit. PTEP' }],
    })
})
afterEach(cleanup)

describe('AlurSuratActions', () => {
    it('hanya menampilkan aksi yang diizinkan server', () => {
        render(<AlurSuratActions detail={detail(['tandai_selesai'])} onChanged={vi.fn()} />)
        expect(screen.getByRole('button', { name: 'Tandai Selesai' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Berkaskan/ })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Gabungkan Rangkaian' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Buka Kembali' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Ubah Unit Pengolah' })).toBeNull()
    })

    it('tidak merender apa pun tanpa aksi', () => {
        const { container } = render(<AlurSuratActions detail={detail([])} onChanged={vi.fn()} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('Tandai Selesai wajib catatan ≥10 karakter', async () => {
        const onChanged = vi.fn()
        render(<AlurSuratActions detail={detail(['tandai_selesai'])} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Tandai Selesai' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: 'singkat' } })
        expect(dialog.getByRole('button', { name: 'Simpan' })).toBeDisabled()
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: 'Ditangani lewat rapat koordinasi' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan' }))
        await waitFor(() => expect(mocks.svc.tandaiSelesai).toHaveBeenCalledWith('rs-1', 'Ditangani lewat rapat koordinasi'))
        expect(onChanged).toHaveBeenCalled()
    })

    it('Buka Kembali meminta alasan dan menampilkan galat server tanpa menutup dialog', async () => {
        const galat = new Error('Request failed')
        galat.status = 409
        galat.data = { error: 'Rangkaian selesai otomatis; tambahkan disposisi atau tindak lanjut baru untuk membukanya kembali' }
        mocks.svc.bukaKembali.mockRejectedValueOnce(galat)
        const onChanged = vi.fn()
        render(<AlurSuratActions detail={detail(['buka_kembali'])} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Buka Kembali' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Ada tindak lanjut susulan' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan' }))
        expect(await dialog.findByRole('alert')).toHaveTextContent('Rangkaian selesai otomatis')
        expect(mocks.svc.bukaKembali).toHaveBeenCalledWith('rs-1', 'Ada tindak lanjut susulan')
        expect(onChanged).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('Berkaskan memakai konfirmasi dua langkah yang menampilkan ulang unit dan klasifikasi', async () => {
        const onChanged = vi.fn()
        render(<AlurSuratActions detail={detail(['berkaskan'])} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Berkaskan ke Direktorat (Unit Pengolah)' }))
        const dialog = within(await screen.findByRole('dialog'))
        expect(await dialog.findByRole('radio', { name: 'Dit. BPPT' })).toBeChecked()
        // Klasifikasi induk dari payload T14-5 ditampilkan sebagai "kode – jenis", bukan "#7".
        expect(dialog.getByText('PT.01 – Penetapan hak')).toBeInTheDocument()
        expect(dialog.queryByText(/#7/)).toBeNull()
        fireEvent.click(dialog.getByRole('button', { name: 'Pilih klasifikasi lain' }))
        fireEvent.click(dialog.getByRole('button', { name: 'Lanjut' }))
        expect(dialog.getByText('Dit. BPPT')).toBeInTheDocument()
        expect(dialog.getByText('PT.02 – Pengadaan tanah')).toBeInTheDocument()
        expect(mocks.svc.berkaskan).not.toHaveBeenCalled()
        fireEvent.click(dialog.getByRole('button', { name: 'Ya, berkaskan' }))
        await waitFor(() => expect(mocks.svc.berkaskan).toHaveBeenCalledWith('rs-1', { unitPengolahId: 'dir_bppt', klasifikasiItemId: 9 }))
        await waitFor(() => expect(onChanged).toHaveBeenCalled())
    })

    it('Berkaskan tanpa klasifikasi induk menahan tombol Lanjut sampai klasifikasi dipilih', async () => {
        mocks.svc.opsiBerkas.mockResolvedValueOnce({ status: 'aktif', unitPengolahId: null, klasifikasiInduk: null, unitDalamJangkauan: [{ id: 'dir_bppt', name: 'Dit. BPPT' }] })
        render(<AlurSuratActions detail={detail(['berkaskan'])} onChanged={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Berkaskan ke Direktorat (Unit Pengolah)' }))
        const dialog = within(await screen.findByRole('dialog'))
        const radio = await dialog.findByRole('radio', { name: 'Dit. BPPT' })
        expect(radio).not.toBeChecked()
        expect(dialog.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
        fireEvent.click(radio)
        expect(dialog.getByRole('button', { name: 'Lanjut' })).toBeDisabled()
        fireEvent.click(dialog.getByRole('button', { name: 'Pilih klasifikasi lain' }))
        expect(dialog.getByRole('button', { name: 'Lanjut' })).toBeEnabled()
    })

    it('Ubah Unit Pengolah hanya tampil dengan aksinya dan mengirim unit terpilih', async () => {
        const { unmount } = render(<AlurSuratActions detail={detail(['berkaskan'])} onChanged={vi.fn()} />)
        expect(screen.queryByRole('button', { name: 'Ubah Unit Pengolah' })).toBeNull()
        unmount()

        const onChanged = vi.fn()
        render(<AlurSuratActions detail={detail(['ubah_unit_pengolah'])} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Ubah Unit Pengolah' }))
        const dialog = within(await screen.findByRole('dialog'))
        expect(await dialog.findByRole('radio', { name: 'Dit. BPPT' })).toBeChecked()
        expect(dialog.getByText('Unit pengolah menentukan retensi berkas.')).toBeInTheDocument()
        // Unit yang sudah menjadi pengolah tidak dapat "diubah" ke dirinya sendiri.
        expect(dialog.getByRole('button', { name: 'Simpan' })).toBeDisabled()
        fireEvent.click(dialog.getByRole('radio', { name: 'Dit. PTEP' }))
        // Pratinjau selisih akses: Dit. PTEP belum menjadi peserta rangkaian.
        expect(dialog.getByText(/Dit\. PTEP akan mendapat akses baca/)).toBeInTheDocument()
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan' }))
        await waitFor(() => expect(mocks.svc.ubahUnitPengolah).toHaveBeenCalledWith('rs-1', 'dir_ptep'))
        await waitFor(() => expect(onChanged).toHaveBeenCalled())
    })

    it('Gabungkan mencari sumber lewat Lacak, menampilkan unit akses baru dengan nama, lalu menggabungkan', async () => {
        mocks.svc.lacak.mockResolvedValue({
            kelompok: [
                { kunci: 'rs-1', rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'selesai', judul: 'Target sendiri' }, pratinjau: [] },
                { kunci: 'rs-3', rangkaian: { id: 'rs-3', kode: 'RS-2026-000003', status: 'diberkaskan', judul: 'Sudah diberkaskan' }, pratinjau: [] },
                { kunci: 'rs-2', rangkaian: { id: 'rs-2', kode: 'RS-2026-000002', status: 'aktif', judul: 'Permohonan data' }, pratinjau: [] },
            ],
        })
        mocks.svc.pratinjauGabung.mockResolvedValue({ unitBaruDiTarget: ['dir_x'], unitBaruDiSumber: ['sesditjen'] })
        const onChanged = vi.fn()
        render(<AlurSuratActions detail={detail(['gabung'])} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: 'Gabungkan Rangkaian' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Cari rangkaian sumber'), { target: { value: 'Permohonan' } })
        const pilihan = await dialog.findByRole('button', { name: /RS-2026-000002/ })
        expect(dialog.queryByRole('button', { name: /RS-2026-000001/ })).toBeNull()
        expect(dialog.queryByRole('button', { name: /RS-2026-000003/ })).toBeNull()
        fireEvent.click(pilihan)
        await waitFor(() => expect(mocks.svc.pratinjauGabung).toHaveBeenCalledWith('rs-1', 'rs-2'))
        expect(await dialog.findByText(/dir_x, Sekretariat Ditjen/)).toBeInTheDocument()
        expect(dialog.getByRole('button', { name: 'Gabungkan' })).toBeDisabled()
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Keduanya membahas permohonan yang sama' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Gabungkan' }))
        await waitFor(() => expect(mocks.svc.gabung).toHaveBeenCalledWith('rs-1', { sumberId: 'rs-2', alasan: 'Keduanya membahas permohonan yang sama' }))
        await waitFor(() => expect(onChanged).toHaveBeenCalled())
    })
})

describe('tombol aksi baris', () => {
    it('Tutup Disposisi dan Ajukan Akses memakai alasan/tujuan dengan batas minimal', async () => {
        render(<>
            <TutupDisposisiButton distribusi={{ id: 'd-1' }} onChanged={vi.fn()} />
            <AjukanAksesButton anggotaId="a-1" onChanged={vi.fn()} />
        </>)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup Disposisi' }))
        let dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Target tidak dapat memproses' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Tutup Disposisi' }))
        await waitFor(() => expect(mocks.svc.tutupDisposisi).toHaveBeenCalledWith('d-1', 'Target tidak dapat memproses'))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        fireEvent.click(screen.getByRole('button', { name: 'Ajukan Akses' }))
        dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Tujuan akses'), { target: { value: 'pendek' } })
        expect(dialog.getByRole('button', { name: 'Ajukan' })).toBeDisabled()
        fireEvent.change(dialog.getByLabelText('Tujuan akses'), { target: { value: 'Menyusun jawaban atas surat pengaduan' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Ajukan' }))
        await waitFor(() => expect(mocks.svc.ajukanAkses).toHaveBeenCalledWith('a-1', 'Menyusun jawaban atas surat pengaduan'))
    })

    it('isian alasan dikosongkan kembali saat dialog dibuka ulang', async () => {
        render(<TutupDisposisiButton distribusi={{ id: 'd-1' }} onChanged={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup Disposisi' }))
        let dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Alasan yang belum dikirim' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        fireEvent.click(screen.getByRole('button', { name: 'Tutup Disposisi' }))
        dialog = within(await screen.findByRole('dialog'))
        expect(dialog.getByLabelText('Alasan')).toHaveValue('')
    })

    it('Batalkan Relasi mengirim alasan untuk relasi yang dipilih', async () => {
        const onChanged = vi.fn()
        render(<BatalRelasiButton relasi={{ id: 'x1', jenisRelasi: 'tindak_lanjut' }} onChanged={onChanged} />)
        fireEvent.click(screen.getByRole('button', { name: /Batalkan Relasi/ }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByLabelText('Alasan'), { target: { value: 'Relasi dibuat keliru' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Batalkan' }))
        await waitFor(() => expect(mocks.svc.batalRelasi).toHaveBeenCalledWith('x1', 'Relasi dibuat keliru'))
        expect(onChanged).toHaveBeenCalled()
    })
})

describe('TautkanDialog', () => {
    it('menautkan surat ini ke surat tujuan yang dipilih', async () => {
        const onBerhasil = vi.fn()
        const onOpenChange = vi.fn()
        render(<TautkanDialog open onOpenChange={onOpenChange} jenis="surat_masuk" surat={{ id: 'sm-1' }} onBerhasil={onBerhasil} />)
        const dialog = within(screen.getByRole('dialog'))
        expect(dialog.getByRole('button', { name: 'Tautkan' })).toBeDisabled()
        fireEvent.click(dialog.getByRole('button', { name: 'Pilih surat tujuan' }))
        fireEvent.click(dialog.getByRole('button', { name: 'Tautkan' }))
        await waitFor(() => expect(mocks.svc.tautkanKeSurat).toHaveBeenCalledWith({
            jenis: 'surat_masuk', suratId: 'sm-1', keJenis: 'surat_keluar', keSuratId: 'sk-9', jenisRelasi: 'tindak_lanjut',
        }))
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(onBerhasil).toHaveBeenCalled()
    })
})
