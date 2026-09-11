import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import TambahSuratMasuk from './TambahSuratMasuk';
import TambahSuratKeluar from './TambahSuratKeluar';
import { clearOfflineStorage } from '@/lib/offline-storage';

const fixtures = vi.hoisted(() => ({
    capabilities: { fileUploads: false },
    masuk: { create: vi.fn(), update: vi.fn(), getById: vi.fn(), getNextNumber: vi.fn(), getBelumDibalas: vi.fn() },
    keluar: { create: vi.fn(), update: vi.fn(), getById: vi.fn(), getNextNumber: vi.fn() },
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'local-user', role: 'admin_unit', unitKerjaId: 'unit-a' } }),
}));
vi.mock('@/context/app-config-context', () => ({
    useAppConfig: () => ({ capabilities: fixtures.capabilities }),
}));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: fixtures.masuk }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: fixtures.keluar }));

const record = {
    id: 'existing-letter', unitKerjaId: 'unit-a', approvalStatus: 'draft',
    jenisSurat: 'Nota Dinas', naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-11',
    perihal: 'Perihal tersimpan', dari: 'Unit pengirim', kepada: 'Unit penerima',
    disposisi: ['Ditjen'], linkDokumen: 'https://example.test/existing.pdf',
};
const pages = [
    { kind: 'masuk', Component: TambahSuratMasuk, field: 'jenisSurat', label: 'Jenis surat', error: 'Jenis Surat wajib diisi' },
    { kind: 'keluar', Component: TambahSuratKeluar, field: 'naskahDinas', label: 'Jenis naskah dinas', error: 'Naskah Dinas wajib diisi' },
];
let routers = [];

async function renderForm(page, overrides = {}) {
    fixtures[page.kind].getById.mockResolvedValue({ ...record, ...overrides });
    const router = createMemoryRouter([
        { path: '/edit/:id', element: <page.Component /> },
        { path: `/surat/${page.kind}`, element: <h1>Daftar surat</h1> },
    ], { initialEntries: ['/edit/existing-letter'] });
    routers.push(router);
    const view = render(<RouterProvider router={router} />);
    await screen.findByDisplayValue(overrides.perihal || record.perihal);
    return { ...view, router, form: view.container.querySelector('form') };
}

beforeEach(() => {
    vi.resetAllMocks();
    fixtures.capabilities.fileUploads = false;
    fixtures.masuk.getBelumDibalas.mockResolvedValue({ data: [] });
    fixtures.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' });
    fixtures.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/ND/2026' });
    fixtures.masuk.update.mockResolvedValue(record);
    fixtures.keluar.update.mockResolvedValue(record);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
    cleanup();
    routers.forEach(router => router.dispose());
    routers = [];
    await clearOfflineStorage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe.each(pages)('form surat $kind', page => {
    it('sends only one save while a request is pending, even for consecutive submit events', async () => {
        fixtures[page.kind].update.mockReturnValue(new Promise(() => {}));
        const { form } = await renderForm(page);
        act(() => {
            fireEvent.submit(form);
            fireEvent.submit(form);
        });
        expect(fixtures[page.kind].update).toHaveBeenCalledTimes(1);
    });

    it('keeps the completed save locked until navigation and preserves hidden document metadata', async () => {
        const { form } = await renderForm(page);
        fireEvent.submit(form);
        await screen.findByText(/telah disimpan ke sistem/);
        expect(screen.getByRole('button', { name: /Perbarui|Tersimpan/ })).toBeDisabled();
        fireEvent.submit(form);
        expect(fixtures[page.kind].update).toHaveBeenCalledTimes(1);
        expect(fixtures[page.kind].update).toHaveBeenCalledWith(record.id,
            expect.objectContaining({ perihal: record.perihal, linkDokumen: undefined }), null);
    });

    it('focuses a server error, retains the entered data, and allows retry', async () => {
        fixtures[page.kind].update.mockRejectedValueOnce(new Error('Layanan sementara tidak tersedia'));
        const { form } = await renderForm(page);
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perubahan belum tersimpan' } });
        fireEvent.submit(form);
        const alert = await screen.findByRole('alert');
        await waitFor(() => expect(alert).toHaveFocus());
        expect(alert).toHaveTextContent('Layanan sementara tidak tersedia');
        expect(screen.getByLabelText(/^Perihal/)).toHaveValue('Perubahan belum tersimpan');
        expect(screen.getByRole('button', { name: 'Perbarui' })).toBeEnabled();
        fireEvent.submit(form);
        await screen.findByText(/telah disimpan ke sistem/);
        expect(fixtures[page.kind].update).toHaveBeenCalledTimes(2);
    });

    it('scrolls to validation feedback without animation when reduced motion is preferred', async () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        })));
        const { form } = await renderForm(page, { [page.field]: '' });
        fireEvent.submit(form);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    });

    it('associates a required custom selection error with its real trigger', async () => {
        const { form } = await renderForm(page, { [page.field]: '' });
        fireEvent.submit(form);
        const trigger = screen.getByRole('combobox', { name: page.label });
        expect(trigger).toHaveAttribute('aria-invalid', 'true');
        expect(trigger).toHaveAccessibleDescription(page.error);
        expect(screen.getByRole('alert')).toHaveFocus();
        expect(fixtures[page.kind].update).not.toHaveBeenCalled();
        fireEvent.click(trigger);
        fireEvent.click(await screen.findByRole('button', { name: 'Nota Dinas', exact: true }));
        expect(trigger).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('protects a selected attachment even when no text field was edited', async () => {
        fixtures.capabilities.fileUploads = true;
        const { container, router } = await renderForm(page);
        const file = new File(['test attachment'], 'bukti.pdf', { type: 'application/pdf' });
        fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
        await waitFor(() => expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('perubahan yang belum disimpan')));
        expect(router.state.location.pathname).toBe('/edit/existing-letter');
        expect(screen.getByText('bukti.pdf')).toBeInTheDocument();
    });
});

it('protects outgoing text edits when cancel is declined', async () => {
    const { router } = await renderForm(pages[1]);
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perubahan penting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe('/edit/existing-letter');
    expect(screen.getByLabelText(/^Perihal/)).toHaveValue('Perubahan penting');
});

it('associates the incoming disposition error with the real multiselect trigger', async () => {
    const { form } = await renderForm(pages[0], { disposisi: [] });
    fireEvent.submit(form);
    const trigger = screen.getByRole('combobox', { name: 'Penerima disposisi' });
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAccessibleDescription('Disposisi wajib diisi');
    expect(screen.getByRole('alert')).toHaveFocus();
});

it('names the outgoing reply selector for keyboard and screen reader users', async () => {
    await renderForm(pages[1]);
    expect(screen.getByRole('combobox', { name: 'Surat masuk yang dibalas' })).toBeEnabled();
});

it.each(pages)('associates the $kind document requirement with both available document controls', async page => {
    fixtures.capabilities.fileUploads = true;
    const { form } = await renderForm(page, { linkDokumen: '' });
    fireEvent.submit(form);
    const message = 'Link dokumen atau upload berkas wajib diisi (salah satu)';
    expect(screen.getByLabelText(/^Link Dokumen/)).toHaveAccessibleDescription(message);
    expect(screen.getByRole('button', { name: 'Pilih berkas untuk diunggah' })).toHaveAccessibleDescription(message);
    expect(fixtures[page.kind].update).not.toHaveBeenCalled();
});
