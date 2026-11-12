import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TunjukSilang from './TunjukSilang';

const mocks = vi.hoisted(() => ({
    user: { id: 'u1', role: 'admin_unit', unitKerjaId: 'unit-a' },
    toast: vi.fn(),
    getAll: vi.fn(), getStats: vi.fn(), getByEntity: vi.fn(), create: vi.fn(), cancel: vi.fn(),
    arsipSearch: vi.fn(), masukGetAll: vi.fn(), keluarGetAll: vi.fn(), dosirGetAll: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => true }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/tunjuk-silang.service', () => ({
    tunjukSilangService: {
        getAll: mocks.getAll, getStats: mocks.getStats, getByEntity: mocks.getByEntity,
        create: mocks.create, cancel: mocks.cancel,
    },
}));
vi.mock('@/services/arsip.service', () => ({ arsipService: { search: mocks.arsipSearch } }));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getAll: mocks.masukGetAll } }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { getAll: mocks.keluarGetAll } }));
vi.mock('@/services/dosir.service', () => ({ default: { getAll: mocks.dosirGetAll } }));

const ARSIP_ID = '550e8400-e29b-41d4-a716-446655440001';
const ARSIP_TERKUNCI_ID = '550e8400-e29b-41d4-a716-446655440005';
const SURAT_ID = '550e8400-e29b-41d4-a716-446655440002';
const REF_ID = '550e8400-e29b-41d4-a716-446655440003';

const arsip = {
    id: ARSIP_ID, nomorBerkas: 'B-07', uraianBerkas: 'Berkas pengadaan', jenisArsip: 'masuk',
    unitKerjaId: 'unit-a', disposalStatus: 'active', legalHold: false,
};
const arsipTerkunci = {
    id: ARSIP_TERKUNCI_ID, nomorBerkas: 'B-08', uraianBerkas: 'Berkas ditahan', jenisArsip: 'masuk',
    unitKerjaId: 'unit-a', disposalStatus: 'active', legalHold: true,
};
const suratMasuk = {
    id: SURAT_ID, nomorSurat: '12/UND/2026', perihal: 'Undangan rapat', jenisSurat: 'Undangan',
    unitKerjaId: 'unit-a', isArchived: false,
};
const daftar = (data) => ({ success: true, data, pagination: { page: 1, limit: 10, total: data.length, totalPages: 1 } });
const hubungan = {
    id: REF_ID, direction: 'outgoing', jenisRelasi: 'referensi', keterangan: 'Dasar undangan', createdBy: 'u1',
    relatedType: 'surat_masuk', relatedId: SURAT_ID,
    relatedLabel: { accessible: true, nomor: '12/UND/2026', judul: 'Undangan rapat', jenis: 'Undangan' },
};

function renderPage(alamat = '/tunjuk-silang') {
    return render(<MemoryRouter initialEntries={[alamat]}><TunjukSilang /></MemoryRouter>);
}

beforeEach(() => {
    mocks.user = { id: 'u1', role: 'admin_unit', unitKerjaId: 'unit-a' };
    mocks.toast.mockReset();
    mocks.getAll.mockReset().mockResolvedValue({ data: [], totalPages: 1 });
    mocks.getStats.mockReset().mockResolvedValue({ total: 0, byRelasi: [] });
    mocks.getByEntity.mockReset().mockResolvedValue({
        data: [hubungan],
        subject: { accessible: true, nomor: 'B-07', judul: 'Berkas pengadaan', jenis: 'masuk' },
        pagination: { page: 1, limit: 100, total: 1 },
    });
    mocks.create.mockReset().mockResolvedValue({ id: REF_ID });
    mocks.cancel.mockReset().mockResolvedValue(undefined);
    mocks.arsipSearch.mockReset().mockResolvedValue(daftar([arsip, arsipTerkunci]));
    mocks.masukGetAll.mockReset().mockResolvedValue(daftar([suratMasuk]));
    mocks.keluarGetAll.mockReset().mockResolvedValue(daftar([]));
    mocks.dosirGetAll.mockReset().mockResolvedValue([]);
    vi.spyOn(window, 'prompt').mockImplementation(() => null);
    vi.spyOn(window, 'confirm').mockImplementation(() => false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('traces a document picked by search and links each related record to its detail page', async () => {
    renderPage();
    expect(screen.queryByText(/UUID/i)).toBeNull();

    const cari = screen.getByLabelText('Dokumen yang ditelusuri: cari arsip');
    fireEvent.change(cari, { target: { value: 'pengadaan' } });
    await waitFor(() => expect(mocks.arsipSearch).toHaveBeenLastCalledWith({ q: 'pengadaan', limit: 10, unitKerjaId: undefined }));
    fireEvent.click(await screen.findByRole('button', { name: /Berkas pengadaan/ }));

    await waitFor(() => expect(mocks.getByEntity).toHaveBeenCalledWith('arsip', ARSIP_ID));
    expect(await screen.findByRole('link', { name: /Undangan rapat/ })).toHaveAttribute('href', `/surat/masuk/${SURAT_ID}`);
    expect(screen.getByText('Surat Masuk • No: 12/UND/2026 • Undangan')).toBeInTheDocument();
    expect(screen.getByText('1 tunjuk silang ditemukan')).toBeInTheDocument();
    expect(screen.queryByText(SURAT_ID)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ganti' })).toBeInTheDocument();
});

it('opens directly on the document named in the address and shows its label', async () => {
    renderPage(`/tunjuk-silang?jenis=arsip&id=${ARSIP_ID}`);

    await waitFor(() => expect(mocks.getByEntity).toHaveBeenCalledWith('arsip', ARSIP_ID));
    expect(await screen.findByText('Berkas pengadaan')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Undangan rapat/ })).toBeInTheDocument();
});

it('ignores a malformed address instead of querying with it', async () => {
    renderPage('/tunjuk-silang?jenis=arsip&id=bukan-pengenal');

    await screen.findByLabelText('Dokumen yang ditelusuri: cari arsip');
    await waitFor(() => expect(mocks.arsipSearch).toHaveBeenCalled());
    expect(mocks.getByEntity).not.toHaveBeenCalled();
});

it('creates a cross reference from two documents picked by search within the source unit', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Tunjuk Silang' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Tunjuk Silang' });
    const simpan = within(dialog).getByRole('button', { name: 'Simpan Tunjuk Silang' });
    expect(simpan).toBeDisabled();
    expect(within(dialog).getByText('Pilih dokumen sumber terlebih dahulu.')).toBeInTheDocument();

    const terkunci = await within(dialog).findByRole('button', { name: /Berkas ditahan/ });
    expect(terkunci).toBeDisabled();
    expect(within(terkunci).getByText('Tidak dapat ditautkan')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berkas pengadaan/ }));

    await waitFor(() => expect(mocks.masukGetAll).toHaveBeenLastCalledWith({ unitKerjaId: 'unit-a', search: undefined, page: 1, limit: 10 }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Undangan rapat/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lampiran' }));
    fireEvent.change(within(dialog).getByLabelText('Keterangan (opsional)'), { target: { value: ' Dasar undangan ' } });
    expect(simpan).toBeEnabled();
    fireEvent.click(simpan);

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
        sourceType: 'arsip', sourceId: ARSIP_ID,
        targetType: 'surat_masuk', targetId: SURAT_ID,
        jenisRelasi: 'lampiran', keterangan: 'Dasar undangan',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Tunjuk silang berhasil ditambahkan' });
});

it('cannot pick the source document again as the target', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Tunjuk Silang' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Tunjuk Silang' });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Berkas pengadaan/ }));

    const tujuan = within(dialog).getByRole('group', { name: 'Dokumen tujuan' });
    fireEvent.click(within(tujuan).getByRole('button', { name: 'Arsip' }));
    const sumberLagi = await within(dialog).findByRole('button', { name: /Berkas pengadaan.*Dokumen sumber/ });
    expect(sumberLagi).toBeDisabled();
});

it('keeps the dialog open and shows the server message when saving fails', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('Tunjuk silang aktif tersebut sudah tercatat'), { status: 409 }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Tunjuk Silang' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Tunjuk Silang' });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Berkas pengadaan/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Undangan rapat/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan Tunjuk Silang' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tunjuk silang aktif tersebut sudah tercatat');
    expect(screen.getByRole('dialog', { name: 'Tambah Tunjuk Silang' })).toBeInTheDocument();
});

it('cancels through a dialog that requires a reason of at least ten characters', async () => {
    renderPage(`/tunjuk-silang?jenis=arsip&id=${ARSIP_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Batalkan tunjuk silang' }));

    const dialog = await screen.findByRole('dialog', { name: 'Batalkan Tunjuk Silang' });
    expect(window.prompt).not.toHaveBeenCalled();
    const kirim = within(dialog).getByRole('button', { name: 'Batalkan Tunjuk Silang' });
    const alasan = within(dialog).getByLabelText('Alasan pembatalan');
    fireEvent.change(alasan, { target: { value: 'singkat' } });
    expect(kirim).toBeDisabled();
    expect(within(dialog).getByText('Minimal 10 karakter.')).toBeInTheDocument();

    fireEvent.change(alasan, { target: { value: '  Hubungan salah input  ' } });
    fireEvent.click(kirim);

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(REF_ID, 'Hubungan salah input'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tunjuk silang dibatalkan' }));
    expect(window.prompt).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
});

it('offers cancellation only on cross references the user created', async () => {
    mocks.getByEntity.mockResolvedValue({
        data: [{ ...hubungan, createdBy: 'orang-lain' }], subject: null, pagination: null,
    });
    renderPage(`/tunjuk-silang?jenis=arsip&id=${ARSIP_ID}`);

    expect(await screen.findByRole('link', { name: /Undangan rapat/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Batalkan tunjuk silang' })).toBeNull();
});

it('shows registry rows with labels and a neutral placeholder for unreadable records', async () => {
    mocks.user = { id: 'u9', role: 'super_admin' };
    mocks.getAll.mockResolvedValue({
        data: [{
            id: REF_ID, jenisRelasi: 'referensi', keterangan: null, createdAt: '2026-10-01T00:00:00.000Z',
            sourceType: 'arsip', sourceId: ARSIP_ID,
            sourceLabel: { accessible: true, nomor: 'B-07', judul: 'Berkas pengadaan', jenis: 'masuk' },
            targetType: 'surat_keluar', targetId: SURAT_ID,
            targetLabel: { accessible: false, nomor: null, judul: null, jenis: null },
        }],
        totalPages: 1,
    });
    renderPage();
    // Radix Tabs berpindah pada mouseDown.
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Daftar Tunjuk Silang' }));

    expect(await screen.findByRole('link', { name: /Berkas pengadaan/ })).toHaveAttribute('href', `/arsip/detail/${ARSIP_ID}`);
    const placeholder = screen.getByText('Dokumen lain (tidak dalam jangkauan Anda)');
    expect(placeholder.closest('a')).toBeNull();
    expect(screen.queryByText(SURAT_ID)).toBeNull();
    expect(screen.queryByText(ARSIP_ID)).toBeNull();
});
