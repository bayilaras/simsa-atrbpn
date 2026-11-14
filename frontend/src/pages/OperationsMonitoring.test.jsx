import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationsMonitoring from './OperationsMonitoring';
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/services/api', () => ({ default: { get, post } }));
afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });
describe('operational monitoring', () => {
    const snapshot = { status: 'attention', timestamp: '2026-09-15T00:00:00Z', ciUrl: 'https://github.com/bayilaras/simsa-atrbpn/actions', checks: [
        { id: 'backup', label: 'Backup database dan dokumen', status: 'unknown', message: 'Belum ada bukti terverifikasi.' },
        { id: 'scanner', label: 'Pemindai keamanan dokumen', status: 'failed', message: 'Verifikasi kedaluwarsa.' },
    ] };
    it('clearly distinguishes unverified backup and failed scanner, with CI link', async () => {
        get.mockResolvedValue({ data: snapshot });
        render(<OperationsMonitoring />);
        expect(await screen.findByText('Belum ada bukti terverifikasi.')).toBeInTheDocument();
        expect(get).toHaveBeenCalledWith('/api/operations/status', {}, expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(screen.getByText('Belum terverifikasi')).toBeInTheDocument();
        expect(screen.getByText('Gagal')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Buka status CI/ })).toHaveAttribute('href', snapshot.ciUrl);
    });
    it('shares each loaded status with the header indicator', async () => {
        const heard = [];
        const listen = event => heard.push(event.detail.status);
        window.addEventListener('simsa:status-operasional', listen);
        try {
            get.mockResolvedValue({ data: snapshot });
            render(<OperationsMonitoring />);
            await screen.findByText('Belum ada bukti terverifikasi.');
            expect(heard).toEqual(['attention']);
        } finally { window.removeEventListener('simsa:status-operasional', listen); }
    });
    it('removes old healthy status when refresh fails and offers retry', async () => {
        get.mockResolvedValueOnce({ data: { ...snapshot, status: 'healthy', checks: [{ id: 'database', label: 'Database', status: 'healthy', message: 'Terhubung' }] } })
            .mockRejectedValueOnce(new Error('private credential error'))
            .mockResolvedValueOnce({ data: snapshot });
        render(<OperationsMonitoring />);
        await screen.findByText('Terhubung');
        fireEvent.click(screen.getByRole('button', { name: /Perbarui/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat status');
        expect(screen.queryByText('Terhubung')).not.toBeInTheDocument();
        expect(screen.queryByText(/private credential/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Perbarui/ }));
        await screen.findByText('Belum ada bukti terverifikasi.');
        await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    });
});

describe('running the scanner from monitoring', () => {
    const scanner = status => ({ status: status === 'healthy' ? 'healthy' : 'attention', timestamp: '2026-09-15T00:00:00Z', checks: [
        { id: 'scanner', label: 'Pemindai keamanan dokumen', status, message: 'Keadaan pemindai.' },
    ] });
    it('starts the scanner and says when the waiting files are scanned', async () => {
        get.mockResolvedValue({ data: scanner('healthy') });
        post.mockResolvedValue({ success: true, data: { wakeScheduled: true } });
        render(<OperationsMonitoring />);
        fireEvent.click(await screen.findByRole('button', { name: 'Jalankan pemindai' }));
        expect(await screen.findByText('Pemindai dijalankan. Berkas yang menunggu dipindai dalam beberapa menit; status di halaman ini diperbarui setiap menit.')).toBeInTheDocument();
        expect(post).toHaveBeenCalledWith('/api/operations/scanner-run', {});
        expect(screen.getByText(/Pemindai berjalan sendiri setelah berkas diunggah\./)).toBeInTheDocument();
    });
    it('shows the server explanation when the scanner cannot be run, and never a raw error', async () => {
        get.mockResolvedValue({ data: scanner('failed') });
        post.mockRejectedValueOnce(Object.assign(new Error('Pemindai tidak dapat dijalankan dari layanan ini. Periksa pengaturan pemindai pada layanan backend.'), { status: 503 }))
            .mockRejectedValueOnce(new Error('ECONNRESET private detail'));
        render(<OperationsMonitoring />);
        fireEvent.click(await screen.findByRole('button', { name: 'Jalankan pemindai' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Pemindai tidak dapat dijalankan dari layanan ini. Periksa pengaturan pemindai pada layanan backend.');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Jalankan pemindai' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Jalankan pemindai' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Pemindai belum dapat dijalankan. Coba lagi beberapa saat lagi.'));
        expect(screen.queryByText(/ECONNRESET/)).not.toBeInTheDocument();
    });
    it('offers no scanner run where the scanner is not enabled', async () => {
        get.mockResolvedValue({ data: scanner('disabled') });
        render(<OperationsMonitoring />);
        expect(await screen.findByText('Keadaan pemindai.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Jalankan pemindai' })).not.toBeInTheDocument();
    });
});

describe('requeueing failed scans from monitoring', () => {
    const queue = counts => ({ status: counts.errors || counts.infected ? 'attention' : 'healthy', timestamp: '2026-09-15T00:00:00Z', checks: [
        { id: 'scan_queue', label: 'Antrean pemindaian', status: counts.errors || counts.infected ? 'attention' : 'healthy', message: 'Keadaan antrean.', counts: { waiting: 0, overdue: 0, ...counts } },
    ] });
    const files = [
        { id: 'a1', fileName: 'undangan.pdf', entityType: 'surat_masuk', uploadedAt: '2026-09-14T02:00:00.000Z', contentMismatch: false },
        { id: 'b2', fileName: 'nota.pdf', entityType: 'arsip', uploadedAt: '2026-09-14T03:00:00.000Z', contentMismatch: true },
    ];
    const serve = state => get.mockImplementation(async endpoint => endpoint === '/api/operations/scan-failures'
        ? { data: { total: state.files.length, files: state.files } }
        : { data: queue({ errors: state.files.length, infected: state.infected }) });

    it('explains failed scans, lists them and requeues all of them', async () => {
        const state = { files, infected: 1 };
        serve(state);
        post.mockImplementation(async () => { state.files = []; return { data: { requeued: 2, remaining: 0, wakeScheduled: true } }; });
        render(<OperationsMonitoring />);
        expect(await screen.findByText('undangan.pdf')).toBeInTheDocument();
        expect(screen.getByText('Terdeteksi berbahaya')).toBeInTheDocument();
        expect(screen.getByText(/Berkas yang terdeteksi berbahaya tidak dapat diantre ulang\./)).toBeInTheDocument();
        expect(screen.getByText(/Surat masuk · diunggah/)).toBeInTheDocument();
        expect(screen.getByText(/Isi berkas tidak cocok dengan catatan saat diunggah/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Antre ulang semua yang gagal dipindai' }));
        expect(await screen.findByText('2 berkas diantrekan untuk dipindai ulang. Berkas dapat dibuka setelah dinyatakan aman.')).toBeInTheDocument();
        expect(post).toHaveBeenCalledWith('/api/operations/scan-failures/requeue', {});
        await waitFor(() => expect(screen.queryByRole('group', { name: 'Berkas gagal dipindai' })).not.toBeInTheDocument());
        expect(screen.getByText('2 berkas diantrekan untuk dipindai ulang. Berkas dapat dibuka setelah dinyatakan aman.')).toBeInTheDocument();
    });
    it('requeues a single file and says how many are left', async () => {
        const state = { files, infected: 0 };
        serve(state);
        post.mockImplementation(async () => { state.files = [files[1]]; return { data: { requeued: 1, remaining: 1 } }; });
        render(<OperationsMonitoring />);
        fireEvent.click(await screen.findByRole('button', { name: 'Antre ulang undangan.pdf' }));
        expect(await screen.findByText(/^1 berkas diantrekan untuk dipindai ulang\. Masih ada 1 berkas yang gagal dipindai; tekan lagi untuk melanjutkan\./)).toBeInTheDocument();
        expect(post).toHaveBeenCalledWith('/api/operations/scan-failures/a1/requeue', {});
        await waitFor(() => expect(screen.queryByText('undangan.pdf')).not.toBeInTheDocument());
        expect(screen.getByText('nota.pdf')).toBeInTheDocument();
    });
    it('shows a plain message when requeueing fails and never the raw error', async () => {
        serve({ files, infected: 0 });
        post.mockRejectedValue(Object.assign(new Error('ECONNRESET private detail'), { status: 503 }));
        render(<OperationsMonitoring />);
        fireEvent.click(await screen.findByRole('button', { name: 'Antre ulang semua yang gagal dipindai' }));
        expect(await screen.findByText('Berkas belum dapat diantre ulang. Coba lagi beberapa saat lagi.')).toBeInTheDocument();
        expect(screen.queryByText(/ECONNRESET/)).not.toBeInTheDocument();
    });
    it('offers no requeue action when only infected files remain', async () => {
        serve({ files: [], infected: 1 });
        render(<OperationsMonitoring />);
        expect(await screen.findByText('Terdeteksi berbahaya')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Antre ulang/ })).not.toBeInTheDocument();
        expect(get).not.toHaveBeenCalledWith('/api/operations/scan-failures');
    });
});
