import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DosirDetail from './DosirDetail';

const mocks = vi.hoisted(() => ({
    canWrite: vi.fn(), toast: vi.fn(),
    getById: vi.fn(), getTimeline: vi.fn(), addSurat: vi.fn(),
    masukGetAll: vi.fn(), keluarGetAll: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: mocks.canWrite }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/dosir.service', () => ({
    default: { getById: mocks.getById, getTimeline: mocks.getTimeline, addSurat: mocks.addSurat, removeSurat: vi.fn(), update: vi.fn() },
}));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getAll: mocks.masukGetAll } }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { getAll: mocks.keluarGetAll } }));

const suratMasuk = {
    id: 'sm-1', nomorSurat: 'SM-001/2026', perihal: 'Undangan rapat koordinasi', dari: 'Kanwil Sintetis',
    tanggalSurat: '2026-09-10', createdAt: '2026-09-10T00:00:00.000Z', unitKerjaId: 'unit-a',
};
const suratLain = {
    id: 'sm-2', nomorSurat: 'SM-002/2026', perihal: 'Laporan bulanan', dari: 'Kantah Sintetis',
    tanggalSurat: '2026-09-11', createdAt: '2026-09-11T00:00:00.000Z', unitKerjaId: 'unit-a',
};
const suratKeluar = {
    id: 'sk-1', nomorSurat: 'SK-001/2026', perihal: 'Jawaban undangan', kepada: 'Kanwil Sintetis',
    tanggalSurat: '2026-09-12', createdAt: '2026-09-12T00:00:00.000Z', unitKerjaId: 'unit-a',
};
const dosirKosong = {
    id: 'd1', kode: 'QA-001', judul: 'Dosir sintetis', status: 'open', unitKerjaId: 'unit-a',
    createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z', suratMasuk: [], suratKeluar: [],
};
const daftar = (data) => ({ success: true, data, pagination: { page: 1, limit: 10, total: data.length, totalPages: 1 } });

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/dosir/d1']}>
            <Routes><Route path="/dosir/:id" element={<DosirDetail />} /></Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    mocks.canWrite.mockReset().mockReturnValue(true);
    mocks.toast.mockReset();
    mocks.getById.mockReset().mockResolvedValue(dosirKosong);
    mocks.getTimeline.mockReset().mockResolvedValue([]);
    mocks.addSurat.mockReset().mockResolvedValue({ dosirId: 'd1' });
    mocks.masukGetAll.mockReset().mockImplementation(async ({ search }) => daftar(
        search ? [suratMasuk, suratLain].filter((s) => s.perihal.toLowerCase().includes(search.toLowerCase())) : [suratMasuk, suratLain],
    ));
    mocks.keluarGetAll.mockReset().mockResolvedValue(daftar([suratKeluar]));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openFromEmptyState() {
    renderPage();
    const emptyState = (await screen.findByText('Belum Ada Kronologi')).parentElement;
    fireEvent.click(within(emptyState).getByRole('button', { name: 'Tambah Surat' }));
    return screen.findByRole('dialog', { name: 'Tambah Surat ke Dosir' });
}

it('opens from the empty state, searches the dosir unit and adds the chosen surat with a note', async () => {
    const dialog = await openFromEmptyState();
    await waitFor(() => expect(mocks.masukGetAll).toHaveBeenCalledWith({ unitKerjaId: 'unit-a', search: undefined, page: 1, limit: 10 }));

    fireEvent.change(within(dialog).getByLabelText('Cari surat masuk'), { target: { value: 'undangan' } });
    await waitFor(() => expect(mocks.masukGetAll).toHaveBeenLastCalledWith({ unitKerjaId: 'unit-a', search: 'undangan', page: 1, limit: 10 }));
    const hasil = await within(dialog).findByRole('button', { name: /Undangan rapat koordinasi/ });
    expect(within(dialog).queryByText('Laporan bulanan')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Tambahkan ke Dosir' })).toBeDisabled();

    fireEvent.click(hasil);
    expect(hasil).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(within(dialog).getByLabelText('Catatan (opsional)'), { target: { value: 'Bahan rapat' } });

    mocks.getById.mockResolvedValue({ ...dosirKosong, suratMasuk: [suratMasuk] });
    mocks.getTimeline.mockResolvedValue([{ ...suratMasuk, type: 'masuk', tanggal: suratMasuk.tanggalSurat }]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tambahkan ke Dosir' }));

    await waitFor(() => expect(mocks.addSurat).toHaveBeenCalledWith('d1', 'masuk', 'sm-1', 'Bahan rapat'));
    expect(await screen.findByRole('heading', { level: 4, name: 'Undangan rapat koordinasi' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Belum Ada Kronologi')).toBeNull();
    expect(mocks.getById).toHaveBeenCalledTimes(2);
    expect(mocks.getTimeline).toHaveBeenCalledTimes(2);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Surat ditambahkan ke dosir' }));
});

it('shows the server message and keeps the dialog open when adding fails', async () => {
    const pesan = 'Dosir atau surat tidak ditemukan, atau surat bukan milik unit kerja dosir ini.';
    mocks.addSurat.mockRejectedValue(Object.assign(new Error(pesan), {
        status: 404, response: { status: 404, data: { success: false, error: pesan } },
    }));
    const dialog = await openFromEmptyState();
    fireEvent.click(await within(dialog).findByRole('button', { name: /Undangan rapat koordinasi/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tambahkan ke Dosir' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(pesan);
    expect(mocks.addSurat).toHaveBeenCalledWith('d1', 'masuk', 'sm-1', '');
    expect(screen.getByRole('dialog', { name: 'Tambah Surat ke Dosir' })).toBeInTheDocument();
    expect(mocks.getById).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
});

it('reloads the dosir after a conflict so the surat is marked as already linked', async () => {
    mocks.addSurat.mockRejectedValue(Object.assign(new Error('Surat ini sudah ada di dosir.'), {
        status: 409, response: { status: 409, data: { success: false, error: 'Surat ini sudah ada di dosir.' } },
    }));
    const dialog = await openFromEmptyState();
    fireEvent.click(await within(dialog).findByRole('button', { name: /Undangan rapat koordinasi/ }));
    mocks.getById.mockResolvedValue({ ...dosirKosong, suratMasuk: [suratMasuk] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tambahkan ke Dosir' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Surat ini sudah ada di dosir.');
    await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2));
    const sudahAda = await within(dialog).findByRole('button', { name: /Undangan rapat koordinasi.*Sudah di dosir/ });
    expect(sudahAda).toBeDisabled();
    expect(sudahAda).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByRole('button', { name: 'Tambahkan ke Dosir' })).toBeDisabled();
    expect(mocks.toast).not.toHaveBeenCalled();
});

it('marks surat already in the dosir and adds a surat keluar from the populated tabs', async () => {
    mocks.getById.mockResolvedValue({ ...dosirKosong, suratMasuk: [suratMasuk] });
    mocks.getTimeline.mockResolvedValue([{ ...suratMasuk, type: 'masuk', tanggal: suratMasuk.tanggalSurat }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah Surat' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Surat ke Dosir' });

    const sudahAda = await within(dialog).findByRole('button', { name: /Undangan rapat koordinasi/ });
    expect(sudahAda).toBeDisabled();
    expect(sudahAda).toHaveTextContent('Sudah di dosir');
    expect(within(dialog).getByRole('button', { name: /Laporan bulanan/ })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Surat Keluar' }));
    await waitFor(() => expect(mocks.keluarGetAll).toHaveBeenCalledWith({ unitKerjaId: 'unit-a', search: undefined, page: 1, limit: 10 }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Jawaban undangan/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tambahkan ke Dosir' }));
    await waitFor(() => expect(mocks.addSurat).toHaveBeenCalledWith('d1', 'keluar', 'sk-1', ''));
});

it('does not offer Tambah Surat to users who cannot write in the dosir unit', async () => {
    mocks.canWrite.mockReturnValue(false);
    renderPage();
    await screen.findByText('Belum Ada Kronologi');
    expect(mocks.canWrite).toHaveBeenCalledWith('unit-a');
    expect(screen.queryByRole('button', { name: 'Tambah Surat' })).toBeNull();
});
