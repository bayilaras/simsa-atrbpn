import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationsMonitoring from './OperationsMonitoring';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/services/api', () => ({ default: { get } }));
afterEach(() => { cleanup(); get.mockReset(); });
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
