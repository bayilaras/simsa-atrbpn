import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SavedArchiveFilters from './SavedArchiveFilters';

const filters = { tab: 'masuk', search: 'sertifikat', tahun: '2026', unitKerjaId: 'unit-a', pageSize: 25 };
const key = (userId) => `simsa:archive-filters:v1:${userId}`;
let values;
let storage;

function renderFilters(props = {}) {
    return render(<SavedArchiveFilters userId="user-a" filters={filters} onApply={vi.fn()} {...props} />);
}

function openSaved() {
    fireEvent.click(screen.getByRole('button', { name: /^Filter tersimpan/ }));
    return screen.getByRole('dialog', { name: 'Filter arsip tersimpan' });
}

function saveAs(name) {
    fireEvent.click(screen.getByRole('button', { name: 'Simpan filter' }));
    fireEvent.change(screen.getByLabelText('Nama filter'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan', exact: true }));
}

beforeEach(() => {
    values = new Map();
    storage = {
        getItem: vi.fn((itemKey) => values.get(itemKey) ?? null),
        setItem: vi.fn((itemKey, value) => values.set(itemKey, value)),
    };
    vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SavedArchiveFilters', () => {
    it('explains the empty state and requires a nonblank name', () => {
        renderFilters();
        expect(within(openSaved()).getByText(/Belum ada filter tersimpan/)).toBeVisible();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        saveAs('   ');
        expect(screen.getByRole('alert')).toHaveTextContent('Isi nama filter');
        expect(screen.getByLabelText('Nama filter')).toHaveAttribute('aria-invalid', 'true');
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(screen.getByText(/Tersimpan di browser ini/)).toBeVisible();
    });

    it('persists only named filter fields and restores, applies, and deletes them', () => {
        const onApply = vi.fn();
        const view = renderFilters({ filters: { ...filters, archives: [{ id: 'private-record' }], page: 8 }, onApply });
        saveAs('  Sertifikat 2026  ');
        expect(screen.getByRole('status')).toHaveTextContent('tersimpan');
        expect(JSON.parse(values.get(key('user-a')))).toEqual([{ name: 'Sertifikat 2026', filters }]);
        view.unmount();
        renderFilters({ onApply });
        openSaved();
        fireEvent.click(screen.getByRole('button', { name: 'Terapkan filter Sertifikat 2026' }));
        expect(onApply).toHaveBeenCalledExactlyOnceWith(filters);
        openSaved();
        fireEvent.click(screen.getByRole('button', { name: 'Hapus filter Sertifikat 2026' }));
        expect(JSON.parse(values.get(key('user-a')))).toEqual([]);
        expect(screen.getByText(/Belum ada filter tersimpan/)).toBeVisible();
    });

    it('replaces a matching name without regard to case', () => {
        values.set(key('user-a'), JSON.stringify([{ name: 'Sertifikat', filters }]));
        renderFilters({ filters: { ...filters, tab: 'keluar', search: 'akta', pageSize: 10 } });
        saveAs('SERTIFIKAT');
        expect(JSON.parse(values.get(key('user-a')))).toEqual([
            { name: 'SERTIFIKAT', filters: { ...filters, tab: 'keluar', search: 'akta', pageSize: 10 } },
        ]);
    });

    it('resets list and draft synchronously when the authenticated user changes', () => {
        values.set(key('user-a'), JSON.stringify([{ name: 'Pribadi A', filters }]));
        values.set(key('user-b'), JSON.stringify([{ name: 'Pribadi B', filters: { ...filters, tab: 'keluar' } }]));
        const onApply = vi.fn();
        const view = renderFilters({ onApply });
        expect(within(openSaved()).getByText('Pribadi A')).toBeVisible();
        view.rerender(<SavedArchiveFilters userId="user-b" filters={filters} onApply={onApply} />);
        expect(screen.queryByText('Pribadi A')).not.toBeInTheDocument();
        expect(within(openSaved()).getByText('Pribadi B')).toBeVisible();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan filter' }));
        fireEvent.change(screen.getByLabelText('Nama filter'), { target: { value: 'Draft B' } });
        view.rerender(<SavedArchiveFilters userId="user-a" filters={filters} onApply={onApply} />);
        fireEvent.click(screen.getByRole('button', { name: 'Simpan filter' }));
        expect(screen.getByLabelText('Nama filter')).toHaveValue('');
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('does not read or write a shared anonymous storage bucket', () => {
        renderFilters({ userId: undefined });
        expect(screen.getByRole('button', { name: 'Simpan filter' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Filter tersimpan' })).toBeDisabled();
        expect(storage.getItem).not.toHaveBeenCalled();
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('reports corrupted JSON and can replace it with a valid save', () => {
        values.set(key('user-a'), '{broken');
        renderFilters();
        expect(screen.getByRole('alert')).toHaveTextContent('Data filter tersimpan rusak');
        saveAs('Pemulihan');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(JSON.parse(values.get(key('user-a')))).toEqual([{ name: 'Pemulihan', filters }]);
    });

    it('does not claim success or overwrite data when reading browser storage is blocked', () => {
        storage.getItem.mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
        renderFilters();
        expect(screen.getByRole('alert')).toHaveTextContent('tidak dapat diakses');
        saveAs('Tidak tersimpan');
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Nama filter')).toHaveValue('Tidak tersimpan');
    });

    it('retains the save draft and reports quota failures without claiming success', () => {
        storage.setItem.mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
        renderFilters();
        saveAs('Ruang penuh');
        expect(screen.getByRole('alert')).toHaveTextContent('gagal disimpan');
        expect(screen.getByLabelText('Nama filter')).toHaveValue('Ruang penuh');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(values.has(key('user-a'))).toBe(false);
    });

    it('keeps a saved filter visible when deletion cannot be persisted', () => {
        values.set(key('user-a'), JSON.stringify([{ name: 'Tetap ada', filters }]));
        storage.setItem.mockImplementation(() => { throw new Error('Storage blocked'); });
        renderFilters();
        openSaved();
        fireEvent.click(screen.getByRole('button', { name: 'Hapus filter Tetap ada' }));
        expect(screen.getByRole('button', { name: 'Terapkan filter Tetap ada' })).toBeVisible();
        expect(screen.getByRole('alert')).toHaveTextContent('gagal disimpan');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it.each([
        ['tab', 'invalid'], ['search', 'a'.repeat(256)], ['tahun', '1999'], ['tahun', '2101'],
        ['tahun', 2026], ['pageSize', 100], ['pageSize', '25'], ['unitKerjaId', 'u'.repeat(101)],
    ])('rejects invalid stored and current %s values (%s)', (field, value) => {
        const invalidFilters = { ...filters, [field]: value };
        values.set(key('user-a'), JSON.stringify([{ name: 'Rusak', filters: invalidFilters }, { name: 'Valid', filters }]));
        renderFilters({ filters: invalidFilters });
        expect(screen.getByRole('alert')).toHaveTextContent('tidak valid');
        const dialog = openSaved();
        expect(within(dialog).queryByText('Rusak')).not.toBeInTheDocument();
        expect(within(dialog).getByText('Valid')).toBeVisible();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        saveAs('Invalid');
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Filter saat ini tidak valid');
    });

    it('enforces the twenty filter limit while allowing a named replacement', () => {
        values.set(key('user-a'), JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ name: `Filter ${index}`, filters }))));
        renderFilters({ filters: { ...filters, tahun: 'all', search: '', unitKerjaId: 'all', pageSize: 50 } });
        saveAs('Filter baru');
        expect(screen.getByRole('alert')).toHaveTextContent('Maksimal 20 filter');
        expect(storage.setItem).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Nama filter'), { target: { value: 'FILTER 0' } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan', exact: true }));
        const stored = JSON.parse(values.get(key('user-a')));
        expect(stored).toHaveLength(20);
        expect(stored[0].filters).toEqual({ ...filters, tahun: 'all', search: '', unitKerjaId: 'all', pageSize: 50 });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('merges a new save with filters added by another tab', () => {
        renderFilters();
        values.set(key('user-a'), JSON.stringify([{ name: 'Dari tab lain', filters }]));
        saveAs('Tab ini');
        expect(JSON.parse(values.get(key('user-a'))).map((entry) => entry.name)).toEqual(['Dari tab lain', 'Tab ini']);
    });
});
