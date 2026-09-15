import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileScanStatus } from './FileScanStatus';
import AuthContext from '@/context/AuthContext';

const state = vi.hoisted(() => ({ post: vi.fn(), uploads: true }));
vi.mock('@/services/api', () => ({ default: { post: state.post } }));
vi.mock('@/context/AuthContext', async () => ({ default: (await import('react')).createContext(null) }));
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: state.uploads } }) }));
beforeEach(() => { vi.clearAllMocks(); state.uploads = true; });
afterEach(cleanup);

function show({ canWrite = true, status = 'not_scanned', refresh = vi.fn(), entityType = 'arsip' } = {}) {
    return render(<AuthContext.Provider value={{ canWrite: () => canWrite }}>
        <FileScanStatus entityType={entityType} entityId="archive-id" status={status} onRefresh={refresh} />
    </AuthContext.Provider>);
}

describe('document scan recovery', () => {
    it.each(['not_scanned', 'scanning:1:123', 'retry:2:456'])('scheduling succeeds for %s without declaring the quarantined document clean', async (status) => {
        state.post.mockResolvedValue({ success: true, status: 'pending' });
        show({ status });
        fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan pemeriksaan' }));
        await screen.findByText(/Pemeriksaan dijadwalkan/);
        expect(state.post).toHaveBeenCalledExactlyOnceWith('/api/upload/arsip/archive-id/scan', {});
        expect(screen.getByText(/menunggu pemeriksaan/)).toBeInTheDocument();
        expect(screen.queryByText(/telah lolos/)).not.toBeInTheDocument();
    });
    it('keeps a failed dispatch quarantined and permits a later explicit retry', async () => {
        state.post.mockRejectedValue(new Error('Berkas tetap menunggu pemeriksaan.'));
        show();
        fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan pemeriksaan' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Berkas tetap menunggu pemeriksaan.');
        expect(screen.getByRole('button', { name: 'Lanjutkan pemeriksaan' })).toBeEnabled();
        expect(state.post).toHaveBeenCalledTimes(1);
    });
    it('refreshes via the authenticated parent without scheduling new scans', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        show({ refresh });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa status' }));
        await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
        expect(state.post).not.toHaveBeenCalled();
    });
    it.each(['infected', 'scan_error', 'clean'])('does not offer queue recovery for %s', (status) => {
        show({ status });
        expect(screen.queryByRole('button', { name: 'Lanjutkan pemeriksaan' })).not.toBeInTheDocument();
        expect(state.post).not.toHaveBeenCalled();
    });
    it('shows status to viewers without offering a write action', () => {
        show({ canWrite: false });
        expect(screen.getByRole('button', { name: 'Periksa status' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Lanjutkan pemeriksaan' })).not.toBeInTheDocument();
    });
    it('honors disabled upload capability', () => {
        state.uploads = false;
        show();
        expect(screen.queryByRole('button', { name: 'Lanjutkan pemeriksaan' })).not.toBeInTheDocument();
    });
    it.each([null, 'unavailable', 'unknown'])('does not claim an unknown %s state is queued or offer a recovery write', (status) => {
        show({ status });
        expect(screen.getByText(/Status pemeriksaan dokumen belum dapat dipastikan/)).toBeInTheDocument();
        expect(screen.queryByText(/tersimpan dan menunggu/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Lanjutkan pemeriksaan' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Periksa status' })).toBeEnabled();
    });
    it.each([['surat_masuk', 'masuk'], ['surat_keluar', 'keluar']])('uses the authorized %s recovery endpoint', async (entityType, path) => {
        state.post.mockResolvedValue({ success: true, status: 'pending' });
        show({ entityType });
        fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan pemeriksaan' }));
        await screen.findByText(/Pemeriksaan dijadwalkan/);
        expect(state.post).toHaveBeenCalledExactlyOnceWith(`/api/upload/${path}/archive-id/scan`, {});
        expect(screen.queryByText(/telah lolos/)).not.toBeInTheDocument();
    });
});
