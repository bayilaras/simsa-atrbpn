import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
    api.get.mockResolvedValue({ sheets: [{ name: 'Data A' }, { name: 'Data B' }] });
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
        spreadsheetUrl: url, sheetName: 'Data A', maxRows: 10, type,
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
        spreadsheetUrl: url, sheetName: 'Data A', unitKerjaId: 'unit-a',
    });
    await act(async () => { finish({ importedRows: 1, totalRows: 1 }); });
    expect(screen.getByText('Impor berhasil!')).toBeInTheDocument();
    expect(completed).toHaveBeenCalledTimes(1);
});

it('discards a late source lookup and requires a fresh preview after changing sheets', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ImportFromGDrive {...props} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil daftar lembar' }));
    fireEvent.change(screen.getByLabelText('URL Google Spreadsheet'), { target: { value: `${url}?new` } });
    await act(async () => { finish({ sheets: [{ name: 'Stale sheet' }] }); });
    expect(screen.queryByRole('radio', { name: 'Stale sheet' })).toBeNull();
    await discover();
    await showPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Data B' }));
    expect(screen.queryByRole('button', { name: 'Impor 1 baris' })).toBeNull();
    await showPreview();
    expect(api.post).toHaveBeenLastCalledWith('/api/import/google-drive/preview', expect.objectContaining({
        spreadsheetUrl: `${url}?new`, sheetName: 'Data B',
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
