import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportFromGDrive from './ImportFromGDrive';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/services/api', () => ({ default: api }));
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { externalIntegrations: true } }) }));
const url = 'https://docs.google.com/spreadsheets/d/source-a/edit';
const preview = (type = 'surat-keluar') => ({
    importType: type, headerRow: 3, headers: ['Perihal', 'No. Surat', 'Tanggal Surat', 'Kepada'],
    rows: [['Permohonan', '001', '2026-09-12', 'Unit tujuan']], totalRows: 1,
    mapping: [{ field: 'nomorSurat', label: 'Nomor Surat', columnIndex: 1, header: 'No. Surat' },
        { field: 'perihal', label: 'Perihal', columnIndex: 0, header: 'Perihal' }],
});
const props = { type: 'surat-keluar', unitKerjaId: 'unit-a' };
const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Impor dari Google Sheets' }));
    fireEvent.change(screen.getByLabelText('URL Google Spreadsheet'), { target: { value: url } });
};
const discover = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ambil daftar lembar' }));
    await screen.findByRole('radio', { name: 'Data A' });
};
const showPreview = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Pratinjau data' }));
    await screen.findByRole('table', { name: 'Pemetaan kolom ke data SIMSA' });
};
beforeEach(() => {
    vi.resetAllMocks();
    api.get.mockResolvedValue({ sheets: [{ gid: '0', name: 'Data A' }, { gid: '22', name: 'Data B' }], linkedGid: null });
    api.post.mockImplementation(async (endpoint, body) => endpoint.endsWith('/preview')
        ? preview(body.type) : { importedRows: 1, totalRows: 1 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['surat-masuk', 'surat-keluar'])('shows server mapping for %s and sends one import to the selected unit', async type => {
    const completed = vi.fn();
    render(<ImportFromGDrive {...props} type={type} onImportComplete={completed} />);
    open();
    await discover();
    await showPreview();
    expect(api.post).toHaveBeenCalledWith('/api/import/google-drive/preview', {
        spreadsheetUrl: url, gid: '0', maxRows: 10, type,
    });
    const mapping = screen.getByRole('table', { name: 'Pemetaan kolom ke data SIMSA' });
    expect(within(mapping).getByText('Kolom 2: No. Surat')).toBeInTheDocument();
    expect(within(mapping).getByText('Nomor Surat')).toBeInTheDocument();
    expect(screen.getByText(/baris data ke-3 \(baris kosong tidak dihitung\)/)).toBeInTheDocument();
    let finish;
    api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const button = screen.getByRole('button', { name: 'Impor 1 baris' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenLastCalledWith(`/api/import/google-drive/${type}`, {
        spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a', startRow: 0,
    }, { timeoutMs: 120_000 });
    await act(async () => { finish({ importedRows: 1, totalRows: 1 }); });
    expect(screen.getByText('Impor berhasil!')).toBeInTheDocument();
    expect(completed).toHaveBeenCalledTimes(1);
});

describe('a sheet imported in parts', () => {
    const importEndpoint = '/api/import/google-drive/surat-keluar';
    const source = { spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a' };
    const part = (fields) => ({ success: true, totalRows: 5, importedRows: 0, duplicateRows: 0, skippedRows: 0, errors: [], ...fields });
    const ready = async (completed = vi.fn()) => {
        api.post.mockImplementation(async (endpoint, body) => ({ ...preview(body.type), totalRows: 5 }));
        render(<ImportFromGDrive {...props} onImportComplete={completed} />);
        open();
        await discover();
        await showPreview();
        return completed;
    };

    it('continues until the server reports the end, showing truthful progress between parts', async () => {
        const completed = await ready();
        const parts = [];
        api.post.mockImplementation(() => new Promise(resolve => parts.push(resolve)));
        fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' }));
        expect(api.post).toHaveBeenLastCalledWith(importEndpoint, { ...source, startRow: 0 }, { timeoutMs: 120_000 });
        await act(async () => { parts[0](part({ importedRows: 2, duplicateRows: 1, startRow: 0, nextRow: 3, prefixHash: 'h1' })); });
        expect(screen.getByRole('progressbar', { name: 'Kemajuan impor' })).toHaveAttribute('aria-valuenow', '3');
        expect(screen.getByText('3 dari 5 baris diproses')).toBeInTheDocument();
        expect(screen.getByText('Tersimpan 2 · duplikat 1 · dilewati 0')).toBeInTheDocument();
        expect(api.post).toHaveBeenLastCalledWith(importEndpoint, { ...source, startRow: 3, prefixHash: 'h1' }, { timeoutMs: 120_000 });
        await act(async () => { parts[1](part({ importedRows: 2, startRow: 3, nextRow: null })); });
        expect(screen.getByText('Impor berhasil!')).toBeInTheDocument();
        expect(screen.getByText('4 dari 5 baris berhasil diimpor')).toBeInTheDocument();
        expect(screen.getByText(/1 baris duplikat dilewati/)).toBeInTheDocument();
        expect(completed).toHaveBeenCalledTimes(1);
        expect(parts).toHaveLength(2);
    });

    it('shows the outcome of every row of every part', async () => {
        await ready();
        const row = (n, status, reason) => ({ row: n, no: String(n), nomorSurat: `${n}/UND/2026`, tanggal: '05/01/2026', perihal: `Hal ${n}`, status, reason });
        api.post.mockResolvedValueOnce(part({ importedRows: 3, startRow: 0, nextRow: 3, prefixHash: 'h1',
            rows: [row(1, 'imported'), row(2, 'imported'), row(3, 'imported')] }))
            .mockResolvedValueOnce(part({ duplicateRows: 1, skippedRows: 1, startRow: 3, nextRow: null, errors: ['Row 5: Tanggal'],
                rows: [row(4, 'duplicate', 'Sudah tercatat di SIMSA pada unit ini (termasuk surat yang dihapus).'), row(5, 'invalid', 'Tanggal surat yang valid wajib diisi.')] }));
        fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' }));
        const report = await screen.findByRole('table', { name: 'Rincian hasil impor per baris' });
        expect(within(report).getAllByRole('row')).toHaveLength(3);
        fireEvent.change(screen.getByLabelText('Tampilkan'), { target: { value: 'all' } });
        expect(within(report).getAllByRole('row')).toHaveLength(6);
        expect(screen.getByRole('button', { name: 'Unduh laporan (CSV)' })).toBeInTheDocument();
    });

    it('updates recorded letters only when sinkron is chosen, in every part', async () => {
        const completed = await ready();
        const checkbox = screen.getByRole('checkbox', { name: /Sinkronkan surat yang sudah tercatat/ });
        expect(checkbox).not.toBeChecked();
        expect(checkbox).toHaveAccessibleDescription(/tautan dokumen/);
        fireEvent.click(checkbox);
        api.post.mockResolvedValueOnce(part({ duplicateRows: 2, startRow: 0, nextRow: 3, prefixHash: 'h1',
            rows: [{ row: 1, status: 'duplicate' }, { row: 2, status: 'duplicate' }, { row: 3, status: 'duplicate' }] }))
            .mockResolvedValueOnce(part({ updatedRows: 1, duplicateRows: 1, startRow: 3, nextRow: null, rows: [
                { row: 4, no: '4', nomorSurat: '40/UND-600.BP.01.01/VI/2026', tanggal: '10/06/2026', perihal: 'Undangan rapat koordinasi teknis', status: 'updated',
                    changes: [{ field: 'perihal', label: 'Perihal', before: 'Undangan rapat koordinasi', after: 'Undangan rapat koordinasi teknis' }] },
                { row: 5, status: 'locked', reason: 'Tidak diperbarui: surat sedang atau telah disetujui.' }] }));
        fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' }));
        expect(await screen.findByText('Data diperbarui')).toBeInTheDocument();
        expect(screen.getByText('1 baris diperbarui dari sumber')).toBeInTheDocument();
        expect(api.post.mock.calls.slice(-2).map(call => call[1])).toEqual([
            { ...source, startRow: 0, sinkron: true }, { ...source, startRow: 3, prefixHash: 'h1', sinkron: true }]);
        fireEvent.change(screen.getByLabelText('Tampilkan'), { target: { value: 'updated' } });
        expect(screen.getByRole('table', { name: 'Rincian hasil impor per baris' }))
            .toHaveTextContent('Perihal: Undangan rapat koordinasi → Undangan rapat koordinasi teknis');
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('keeps the error list for a server that reports no rows', async () => {
        await ready();
        api.post.mockResolvedValueOnce(part({ importedRows: 4, skippedRows: 1, errors: ['Row 5: Tanggal surat wajib diisi'], nextRow: null }));
        fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' }));
        expect(await screen.findByText('Row 5: Tanggal surat wajib diisi')).toBeInTheDocument();
        expect(screen.queryByRole('table', { name: 'Rincian hasil impor per baris' })).not.toBeInTheDocument();
    });

    it('waits out the import rate limit between parts and then continues by itself', async () => {
        await ready();
        api.post.mockResolvedValueOnce(part({ importedRows: 3, startRow: 0, nextRow: 3, prefixHash: 'h1' }))
            .mockRejectedValueOnce(Object.assign(new Error('Terlalu banyak permintaan.'), { status: 429, data: { retryAfterSeconds: 2 } }))
            .mockResolvedValueOnce(part({ importedRows: 2, startRow: 3, nextRow: null }));
        vi.useFakeTimers();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' })); });
        expect(screen.getByText(/dilanjutkan otomatis dalam 2 detik/)).toBeInTheDocument();
        expect(api.post).toHaveBeenCalledTimes(3);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(api.post).toHaveBeenCalledTimes(4);
        expect(api.post).toHaveBeenLastCalledWith(importEndpoint, { ...source, startRow: 3, prefixHash: 'h1' }, { timeoutMs: 120_000 });
        expect(screen.getByText('5 dari 5 baris berhasil diimpor')).toBeInTheDocument();
    });

    it('says what is already saved when a later part cannot be confirmed', async () => {
        const completed = await ready();
        api.post.mockResolvedValueOnce(part({ importedRows: 3, startRow: 0, nextRow: 3, prefixHash: 'h1' }))
            .mockRejectedValueOnce(Object.assign(new Error('Waktu tunggu permintaan habis. Hasil penyimpanan belum dapat dipastikan.'),
                { code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' }));
        expect(await screen.findByText('Impor belum selesai')).toBeInTheDocument();
        const notice = screen.getByText(/belum terkonfirmasi/);
        expect(notice).toHaveTextContent('Bagian mulai baris data ke-4 belum terkonfirmasi');
        expect(notice).toHaveTextContent('3 baris dari bagian sebelumnya sudah tersimpan');
        expect(notice).toHaveTextContent('Jalankan impor lagi');
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('stops after the current part when asked and says where it stopped', async () => {
        await ready();
        let finish;
        api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Impor 5 baris' }));
        fireEvent.click(screen.getByRole('button', { name: 'Hentikan setelah bagian ini' }));
        expect(screen.getByRole('button', { name: 'Menghentikan setelah bagian ini…' })).toBeDisabled();
        await act(async () => { finish(part({ importedRows: 2, duplicateRows: 1, startRow: 0, nextRow: 3, prefixHash: 'h1' })); });
        expect(api.post).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Impor belum selesai')).toBeInTheDocument();
        expect(screen.getByText(/dihentikan sebelum baris data ke-4/)).toBeInTheDocument();
        expect(screen.getByText('2 dari 5 baris berhasil diimpor')).toBeInTheDocument();
    });
});

it('discards a late source lookup and requires a fresh preview after changing sheets', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ImportFromGDrive {...props} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil daftar lembar' }));
    fireEvent.change(screen.getByLabelText('URL Google Spreadsheet'), { target: { value: `${url}?new` } });
    await act(async () => { finish({ sheets: [{ gid: '9', name: 'Stale sheet' }], linkedGid: null }); });
    expect(screen.queryByRole('radio', { name: 'Stale sheet' })).toBeNull();
    await discover();
    await showPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Data B' }));
    expect(screen.queryByRole('button', { name: 'Impor 1 baris' })).toBeNull();
    await showPreview();
    expect(api.post).toHaveBeenLastCalledWith('/api/import/google-drive/preview', expect.objectContaining({
        spreadsheetUrl: `${url}?new`, gid: '22',
    }));
});

it.each([{ unitKerjaId: 'unit-b' }, { type: 'surat-masuk' }])('invalidates an in-flight preview when its scope changes: %o', async changed => {
    let finish;
    api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ImportFromGDrive {...props} />);
    open();
    await discover();
    fireEvent.click(screen.getByRole('button', { name: 'Pratinjau data' }));
    view.rerender(<ImportFromGDrive {...props} {...changed} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Impor dari Google Sheets' }));
    await act(async () => { finish(preview()); });
    expect(screen.getByLabelText('URL Google Spreadsheet')).toHaveValue('');
    expect(screen.queryByRole('table', { name: 'Pemetaan kolom ke data SIMSA' })).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
});

it('prevents import when the server preview does not match the requested record type', async () => {
    api.post.mockResolvedValueOnce(preview('surat-masuk'));
    render(<ImportFromGDrive {...props} />);
    open();
    await discover();
    fireEvent.click(screen.getByRole('button', { name: 'Pratinjau data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pemetaan kolom belum dapat diverifikasi');
    expect(screen.queryByRole('button', { name: 'Impor 1 baris' })).toBeNull();
});

it.each([false, true])('reports an import with only existing rows accurately (row errors: %s)', async hasErrors => {
    const completed = vi.fn();
    render(<ImportFromGDrive {...props} onImportComplete={completed} />);
    open();
    await discover();
    await showPreview();
    api.post.mockResolvedValueOnce({ success: true, importedRows: 0, totalRows: 1, duplicateRows: 1,
        skippedRows: hasErrors ? 1 : 0, errors: hasErrors ? ['Baris 2: tanggal tidak valid'] : [] });
    fireEvent.click(screen.getByRole('button', { name: 'Impor 1 baris' }));
    await screen.findByText(hasErrors ? 'Impor gagal' : 'Semua data sudah ada');
    expect(completed).not.toHaveBeenCalled();
});

it.each(['sheets', 'preview', 'import'])('waits for Retry-After on %s without automatically replaying the request', async operation => {
    render(<ImportFromGDrive {...props} />);
    open();
    if (operation !== 'sheets') await discover();
    if (operation === 'import') await showPreview();
    const client = operation === 'sheets' ? api.get : api.post;
    const error = Object.assign(new Error('Terlalu banyak permintaan.'), operation === 'preview'
        ? { response: { status: 429, headers: new Headers({ 'Retry-After': '2' }) } }
        : { status: 429, data: { retryAfterSeconds: 2 } });
    client.mockRejectedValueOnce(error);
    const label = operation === 'sheets' ? 'Ambil daftar lembar' : operation === 'preview' ? 'Pratinjau data' : 'Impor 1 baris';
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
    const calls = client.mock.calls.length;
    expect(screen.getByRole('status')).toHaveTextContent('2 detik');
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(client).toHaveBeenCalledTimes(calls);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
    expect(client).toHaveBeenCalledTimes(calls);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
    expect(client).toHaveBeenCalledTimes(calls + 1);
});

it('preselects the tab the pasted link points to and shows its name', async () => {
    api.get.mockResolvedValueOnce({ sheets: [{ gid: '0', name: 'Data A' }, { gid: '22', name: 'Data B' }], linkedGid: '22' });
    render(<ImportFromGDrive {...props} />);
    open();
    await discover();
    expect(screen.getByRole('radio', { name: 'Data B' })).toBeChecked();
    await showPreview();
    expect(api.post).toHaveBeenLastCalledWith('/api/import/google-drive/preview', expect.objectContaining({ gid: '22' }));
    expect(screen.getByText('Lembar: Data B')).toBeInTheDocument();
});

it('uses the linked tab when the tab list cannot be read, without asking for a name', async () => {
    api.get.mockResolvedValueOnce({ sheets: [], linkedGid: '234636572' });
    render(<ImportFromGDrive {...props} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil daftar lembar' }));
    expect(await screen.findByRole('radio', { name: 'Lembar dari tautan (gid 234636572)' })).toBeChecked();
    expect(screen.queryByLabelText('Nama lembar kerja')).toBeNull();
    await showPreview();
    expect(api.post).toHaveBeenLastCalledWith('/api/import/google-drive/preview', expect.objectContaining({ gid: '234636572' }));
});

it('asks for the link of the tab when neither the tab list nor the link names a tab', async () => {
    api.get.mockResolvedValueOnce({ sheets: [], linkedGid: null });
    render(<ImportFromGDrive {...props} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil daftar lembar' }));
    expect(await screen.findByText(/salin tautan dari tab tersebut/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pratinjau data' })).toBeDisabled();
});

it('offers and selects the linked tab when the detected list does not contain it', async () => {
    api.get.mockResolvedValueOnce({ sheets: [{ gid: '0', name: 'Data A' }], linkedGid: '99' });
    render(<ImportFromGDrive {...props} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil daftar lembar' }));
    expect(await screen.findByRole('radio', { name: 'Lembar dari tautan (gid 99)' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Data A' })).not.toBeChecked();
});
