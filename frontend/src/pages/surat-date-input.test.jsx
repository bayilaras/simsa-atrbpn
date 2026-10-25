import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import TambahSuratMasuk from './TambahSuratMasuk';
import TambahSuratKeluar from './TambahSuratKeluar';
import { clearOfflineStorage } from '../lib/offline-storage';

const services = vi.hoisted(() => ({
    masuk: { create: vi.fn(), getById: vi.fn(), getNextNumber: vi.fn(), getBelumDibalas: vi.fn() },
    keluar: { create: vi.fn(), getNextNumber: vi.fn() },
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'local-user', role: 'admin_unit', unitKerjaId: 'unit-a' } }),
}));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: services.masuk }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: services.keluar }));

// Only simplify unrelated popup selectors. The real form, native date Input,
// onChange handlers, numbering effect, draft hook and router blocker stay intact.
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options }) => (
        <select id={id} aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option;
                return <option key={item.value} value={item.value}>{item.label}</option>;
            })}
        </select>
    ),
}));
vi.mock('@/components/ui/multi-select', () => ({
    MultiSelect: ({ id, ariaLabel, selected, onChange, options }) => (
        <select id={id} aria-label={ariaLabel} multiple value={selected}
            onChange={event => onChange(Array.from(event.target.selectedOptions, item => item.value))}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    ),
}));

describe('surat date field state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        services.masuk.create.mockResolvedValue({ id: 'new-masuk' });
        services.keluar.create.mockResolvedValue({ id: 'new-keluar' });
        services.masuk.getBelumDibalas.mockResolvedValue({ data: [] });
        services.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' });
        services.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/ND/2026' });
    });

    afterEach(async () => {
        cleanup();
        await clearOfflineStorage();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not restore an edited incoming letter as a new letter draft', async () => {
        services.masuk.getById.mockResolvedValue({
            id: 'existing-letter', unitKerjaId: 'unit-a', perihal: 'Surat yang sudah tercatat',
        });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const editRouter = createMemoryRouter([
            { path: '/edit/:id', element: <TambahSuratMasuk /> },
        ], { initialEntries: ['/edit/existing-letter'] });
        const editedPage = render(<RouterProvider router={editRouter} />);
        await screen.findByDisplayValue('Surat yang sudah tercatat');
        vi.useFakeTimers();
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perubahan surat lama' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
        editedPage.unmount();
        editRouter.dispose();
        vi.useRealTimers();

        const createRouter = createMemoryRouter([{ path: '/', element: <TambahSuratMasuk /> }]);
        render(<RouterProvider router={createRouter} />);
        expect(screen.getByLabelText(/^Perihal/)).toHaveValue('');
        expect(confirm).not.toHaveBeenCalled();
        createRouter.dispose();
    });

    it.each([
        ['masuk', 'change'], ['masuk', 'input'],
        ['keluar', 'change'], ['keluar', 'input'],
    ])('keeps the %s date through %s, blur, rerender, and submit', async (kind, eventType) => {
        const Component = kind === 'masuk' ? TambahSuratMasuk : TambahSuratKeluar;
        const router = createMemoryRouter([{ path: '/', element: <Component /> }]);
        const { container } = render(<RouterProvider router={router} />);
        const service = services[kind];
        fireEvent.change(screen.getByRole('combobox', {
            name: kind === 'masuk' ? 'Jenis surat' : 'Jenis naskah dinas',
        }), { target: { value: 'Nota Dinas' } });

        const date = screen.getByLabelText(/Tanggal Surat/);
        expect(date.type).toBe('date');
        fireEvent[eventType](date, { target: { value: '2026-09-03' } });
        fireEvent.blur(date);
        fireEvent.click(screen.getByText('Identitas Surat'));

        await waitFor(() => expect(service.getNextNumber).toHaveBeenCalledWith(expect.objectContaining({
            tanggalSurat: '2026-09-03', tahun: 2026, unitKerjaId: 'unit-a',
        })));
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Arsip pengujian tanggal' } });
        fireEvent.change(screen.getByLabelText(/^Link Dokumen/), { target: { value: 'https://example.test/dokumen.pdf' } });
        if (kind === 'masuk') {
            fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pengirim lokal' } });
            fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Penerima lokal' } });
            const disposisi = screen.getByRole('listbox', { name: 'Penerima disposisi' });
            disposisi.options[0].selected = true;
            fireEvent.change(disposisi);
        }

        expect(screen.getByLabelText(/Tanggal Surat/)).toBe(date);
        expect(date.value).toBe('2026-09-03');
        expect(date.validity.valid).toBe(true);
        expect(container.querySelector('form').checkValidity()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
        await waitFor(() => expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
            tanggalSurat: '2026-09-03', tahun: 2026, perihal: 'Arsip pengujian tanggal', unitKerjaId: 'unit-a',
        }), null));
        expect(date.value).toBe('2026-09-03');
        router.dispose();
    });
});
