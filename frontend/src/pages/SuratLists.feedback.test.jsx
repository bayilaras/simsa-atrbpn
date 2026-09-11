import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SuratMasuk from './SuratMasuk';
import SuratKeluar from './SuratKeluar';
import Arsip from './Arsip';

const mocks = vi.hoisted(() => ({
    user: { id: 'reader', role: 'super_admin', unitKerjaId: 'unit-a' },
    toast: vi.fn(),
    masuk: { getAll: vi.fn(), getStats: vi.fn() },
    keluar: { getAll: vi.fn(), getStats: vi.fn() },
    arsip: { getAll: vi.fn(), getStats: vi.fn() },
    units: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }));
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/surat-masuk.service', () => ({ default: mocks.masuk, suratMasukService: mocks.masuk }));
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar, suratKeluarService: mocks.keluar }));
vi.mock('@/services/arsip.service', () => ({ arsipService: mocks.arsip }));
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.units } }));
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }));
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }));

const empty = { success: true, data: [], pagination: { total: 0, totalPages: 1 } };
const row = {
    id: 'letter-1', nomorSurat: '001/UJI/2026', perihal: 'Surat setelah koneksi pulih',
    tanggalSurat: '2026-09-11', dari: 'Unit asal', kepada: 'Unit tujuan',
    jenisSurat: 'Surat Dinas', naskahDinas: 'Surat Dinas', status: 'belum_dibalas',
};
const withRows = { success: true, data: [row], pagination: { total: 11, totalPages: 2 } };
const letters = [
    { kind: 'masuk', Component: SuratMasuk, emptyText: 'Tidak ada surat masuk ditemukan' },
    { kind: 'keluar', Component: SuratKeluar, emptyText: 'Tidak ada surat keluar ditemukan' },
];
function listElement(Component, kind) {
    return <MemoryRouter initialEntries={[kind === 'arsip' ? '/arsip/masuk' : `/surat/${kind}`]}>
        <Routes><Route path={kind === 'arsip' ? '/arsip/:tab' : '*'} element={<Component />} /></Routes>
    </MemoryRouter>;
}
const renderList = (Component, kind) => render(listElement(Component, kind));

beforeEach(() => {
    mocks.user = { id: 'reader', role: 'super_admin', unitKerjaId: 'unit-a' };
    for (const service of [mocks.masuk, mocks.keluar, mocks.arsip]) {
        service.getAll.mockReset().mockResolvedValue(empty);
        service.getStats.mockReset().mockResolvedValue({ total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0, arsipMasuk: 0, arsipKeluar: 0 });
    }
    mocks.units.mockReset().mockResolvedValue({ data: [{ id: 'unit-a', name: 'Unit A' }] });
    mocks.toast.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe.each([...letters, { kind: 'arsip', Component: Arsip }])('$kind statistics fidelity', ({ kind, Component }) => {
    const validStats = total => ({ total, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0, arsipMasuk: 0, arsipKeluar: 0 });
    const totalValue = () => screen.getByText(kind === 'arsip' ? 'Total Arsip' : 'Total Surat').parentElement.querySelector('p:last-child');

    it('distinguishes loading and unavailable statistics from a successfully loaded zero, with retry', async () => {
        let rejectStats;
        mocks[kind].getStats.mockImplementationOnce(() => new Promise((_, reject) => { rejectStats = reject; }));
        renderList(Component, kind);
        expect(totalValue()).toHaveTextContent('—');
        expect(screen.getByRole('status')).toHaveTextContent('Memuat statistik');
        await act(async () => rejectStats(new Error('Statistics offline')));
        expect(await screen.findByRole('alert')).toHaveTextContent('Statistik belum tersedia');
        expect(totalValue()).toHaveTextContent('—');
        mocks[kind].getStats.mockResolvedValue(validStats(0));
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi statistik' }));
        await waitFor(() => expect(totalValue()).toHaveTextContent(/^0$/));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('rejects incomplete statistics instead of presenting missing counters as zero', async () => {
        mocks[kind].getStats.mockResolvedValue({ total: 4 });
        renderList(Component, kind);
        expect(await screen.findByRole('alert')).toHaveTextContent('Statistik belum tersedia');
        expect(totalValue()).toHaveTextContent('—');
    });

    it('hides old-unit counts immediately and ignores a refresh completing after the new unit', async () => {
        mocks.user = { id: 'reader', role: 'staff', unitKerjaId: 'unit-a' };
        mocks[kind].getStats.mockResolvedValue(validStats(101));
        const page = renderList(Component, kind);
        await waitFor(() => expect(totalValue()).toHaveTextContent(/^101$/));
        let resolveOld;
        let resolveNew;
        mocks[kind].getStats.mockImplementation(({ unitKerjaId }) => new Promise(resolve => {
            if (unitKerjaId === 'unit-a') resolveOld = resolve;
            else resolveNew = resolve;
        }));
        await waitFor(() => expect(screen.getByRole('button', { name: kind === 'arsip' ? 'Perbarui' : 'Refresh' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: kind === 'arsip' ? 'Perbarui' : 'Refresh' }));
        await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
        mocks.user = { ...mocks.user, unitKerjaId: 'unit-b' };
        page.rerender(listElement(Component, kind));
        expect(totalValue()).toHaveTextContent('—');
        await waitFor(() => expect(resolveNew).toBeTypeOf('function'));
        await act(async () => resolveNew(validStats(202)));
        await waitFor(() => expect(totalValue()).toHaveTextContent(/^202$/));
        await act(async () => resolveOld(validStats(303)));
        expect(totalValue()).toHaveTextContent(/^202$/);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each(letters)('persistent $kind list feedback', ({ kind, Component, emptyText }) => {
    it('keeps a failure visible instead of an empty list and recovers with retry', async () => {
        mocks[kind].getAll.mockRejectedValueOnce(new Error('Temporary outage'));
        renderList(Component, kind);
        expect(await screen.findByRole('alert')).toHaveTextContent(`Gagal memuat daftar surat ${kind}`);
        expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
        mocks[kind].getAll.mockResolvedValue(withRows);
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
        expect(await screen.findByText(row.perihal)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('treats an unsuccessful response as an error rather than a successful empty result', async () => {
        mocks[kind].getAll.mockResolvedValue({ success: false, data: [] });
        renderList(Component, kind);
        expect(await screen.findByRole('alert')).toHaveTextContent(`Gagal memuat daftar surat ${kind}`);
        expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    });

    it('hides old rows and pagination after refresh fails, then shows a successful empty result', async () => {
        mocks[kind].getAll.mockResolvedValue(withRows);
        renderList(Component, kind);
        await screen.findByText(row.perihal);
        mocks[kind].getAll.mockRejectedValueOnce(new Error('Refresh unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await screen.findByRole('alert');
        expect(screen.queryByText(row.perihal)).not.toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'pagination' })).not.toBeInTheDocument();
        expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
        mocks[kind].getAll.mockResolvedValue(empty);
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
        expect(await screen.findByText(emptyText)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not let an older failed request replace a newer successful search', async () => {
        let rejectOld;
        mocks[kind].getAll.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
            .mockResolvedValue(withRows);
        renderList(Component, kind);
        fireEvent.change(screen.getByPlaceholderText(/Cari nomor surat/), { target: { value: 'koneksi' } });
        await screen.findByText(row.perihal);
        await act(async () => rejectOld(new Error('Old request failed late')));
        expect(screen.getByText(row.perihal)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(mocks[kind].getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'koneksi', page: 1 }));
    });
});

describe('visible search and associated filter labels', () => {
    it.each([
        { kind: 'masuk', Component: SuratMasuk, search: 'Cari surat masuk', filters: ['Tahun', 'Jenis Surat', 'Status', 'Sifat Surat', 'Disposisi Ke'] },
        { kind: 'keluar', Component: SuratKeluar, search: 'Cari surat keluar', filters: ['Tahun', 'Naskah Dinas'] },
        { kind: 'arsip', Component: Arsip, search: 'Cari arsip', filters: ['Tahun Arsip'] },
    ])('labels the real $kind controls', async ({ kind, Component, search, filters }) => {
        renderList(Component, kind);
        const searchInput = screen.getByRole('textbox', { name: search });
        const searchLabel = screen.getByText(search, { selector: 'label' });
        expect(searchLabel).toBeVisible();
        expect(searchLabel.htmlFor).toBe(searchInput.id);
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Unit kerja' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
        for (const name of filters) {
            const control = screen.getByRole('combobox', { name });
            const label = screen.getByText(name, { selector: 'label' });
            expect(label).toBeVisible();
            expect(label.htmlFor).toBe(control.id);
        }
        if (kind !== 'arsip') {
            expect(screen.getByLabelText(/^Tanggal dari/)).toHaveAttribute('type', 'button');
            expect(screen.getByLabelText(/^Tanggal sampai/)).toHaveAttribute('type', 'button');
        }
    });
});
