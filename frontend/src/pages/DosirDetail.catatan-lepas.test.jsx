import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DosirDetail from './DosirDetail';

const mocks = vi.hoisted(() => ({ canWrite: vi.fn(), toast: vi.fn(), getById: vi.fn(), getTimeline: vi.fn(), removeSurat: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: mocks.canWrite }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/dosir.service', () => ({
    default: { getById: mocks.getById, getTimeline: mocks.getTimeline, removeSurat: mocks.removeSurat, addSurat: vi.fn(), update: vi.fn() },
}));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getAll: vi.fn() } }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { getAll: vi.fn() } }));

const dosir = {
    id: 'd1', kode: 'QA-001', judul: 'Dosir sintetis', status: 'open', unitKerjaId: 'unit-a',
    createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
    suratMasuk: [{
        id: 'sm-1', nomorSurat: 'SM-001/2026', perihal: 'Undangan rapat koordinasi', dari: 'Kanwil Sintetis',
        createdAt: '2026-09-10T00:00:00.000Z', notes: 'Bahan rapat koordinasi\nbawa salinan',
    }],
    suratKeluar: [{
        id: 'sk-1', nomorSurat: 'SK-001/2026', perihal: 'Jawaban undangan', kepada: 'Kanwil Sintetis',
        createdAt: '2026-09-12T00:00:00.000Z', notes: 'Jawaban atas undangan rapat',
    }, {
        id: 'sk-2', nomorSurat: 'SK-002/2026', perihal: 'Tanpa catatan', kepada: 'Kantah Sintetis',
        createdAt: '2026-09-13T00:00:00.000Z', notes: null,
    }],
};

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/dosir/d1']}>
            <Routes><Route path="/dosir/:id" element={<DosirDetail />} /></Routes>
        </MemoryRouter>,
    );
}
const bukaTab = async (nama) => fireEvent.mouseDown(await screen.findByRole('tab', { name: nama }), { button: 0, ctrlKey: false });
const paragrafCatatan = (isi) => screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === `Catatan: ${isi}`);

beforeEach(() => {
    mocks.toast.mockReset();
    mocks.canWrite.mockReset().mockReturnValue(true);
    mocks.getById.mockReset().mockResolvedValue(dosir);
    mocks.getTimeline.mockReset().mockResolvedValue([]);
    mocks.removeSurat.mockReset().mockResolvedValue({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('daftar surat di dosir', () => {
    it('menampilkan catatan yang diisi saat surat ditambahkan', async () => {
        renderPage();
        await bukaTab(/Surat Masuk/);
        expect(paragrafCatatan('Bahan rapat koordinasi\nbawa salinan')).toBeInTheDocument();

        await bukaTab(/Surat Keluar/);
        expect(paragrafCatatan('Jawaban atas undangan rapat')).toBeInTheDocument();
        expect(screen.getAllByText('Catatan:')).toHaveLength(1);
    });

    it('memberi tahu bila surat berhasil dilepas lalu memuat ulang dosir', async () => {
        renderPage();
        await bukaTab(/Surat Masuk/);
        fireEvent.click(screen.getByRole('button', { name: 'Lepas dari dosir' }));

        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Surat dilepas dari dosir',
            description: 'Surat masuk SM-001/2026 tidak lagi tercatat di dosir ini.',
        }));
        expect(mocks.removeSurat).toHaveBeenCalledWith('d1', 'masuk', 'sm-1');
        await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2));
    });

    it('menampilkan pesan server bila surat gagal dilepas', async () => {
        const pesan = 'Surat tidak ditemukan pada dosir ini.';
        mocks.removeSurat.mockRejectedValue(Object.assign(new Error(pesan), {
            status: 404, data: { success: false, error: pesan },
        }));
        renderPage();
        await bukaTab(/Surat Keluar/);
        fireEvent.click(screen.getAllByRole('button', { name: 'Lepas dari dosir' })[0]);

        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Surat gagal dilepas dari dosir', description: pesan, variant: 'destructive',
        }));
        expect(mocks.removeSurat).toHaveBeenCalledWith('d1', 'keluar', 'sk-1');
        expect(mocks.getById).toHaveBeenCalledTimes(1);
    });

    it('tanpa hak tulis di unit dosir: tidak ada tombol Edit Dosir maupun Lepas dari dosir', async () => {
        mocks.canWrite.mockReturnValue(false);
        renderPage();
        await bukaTab(/Surat Masuk/);
        expect(paragrafCatatan('Bahan rapat koordinasi\nbawa salinan')).toBeInTheDocument();
        expect(mocks.canWrite).toHaveBeenCalledWith('unit-a');
        expect(screen.queryByRole('button', { name: 'Lepas dari dosir' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit Dosir' })).not.toBeInTheDocument();
    });

    it('dengan hak tulis: tombol Edit Dosir tersedia', async () => {
        renderPage();
        expect(await screen.findByRole('button', { name: 'Edit Dosir' })).toBeInTheDocument();
    });

    it('tidak melepas apa pun bila konfirmasi dibatalkan', async () => {
        window.confirm.mockReturnValue(false);
        renderPage();
        await bukaTab(/Surat Masuk/);
        fireEvent.click(screen.getByRole('button', { name: 'Lepas dari dosir' }));
        expect(mocks.removeSurat).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
    });
});
