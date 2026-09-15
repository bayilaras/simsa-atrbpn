import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Dosir from './Dosir';
import DosirDetail from './DosirDetail';
const mocks = vi.hoisted(() => ({ user: {}, create: vi.fn(), update: vi.fn(), getAll: vi.fn(), getById: vi.fn(), units: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.units } }));
vi.mock('@/services/dosir.service', () => ({ default: { getAll: mocks.getAll, getById: mocks.getById, getTimeline: async () => [], getStats: async () => ({}), create: mocks.create, update: mocks.update } }));
beforeEach(() => {
    mocks.user = { role: 'super_admin' };
    mocks.getAll.mockReset().mockResolvedValue([]);
    mocks.units.mockReset().mockResolvedValue([{ id: 'ditjen', name: 'Ditjen' }]);
    mocks.getById.mockReset().mockResolvedValue({ id: 'd1', kode: 'QA-001', judul: 'Dosir sintetis', status: 'open', tanggalMulai: '2026-09-14', tanggalSelesai: '2026-09-15', createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z', suratMasuk: [], suratKeluar: [] });
    mocks.create.mockReset().mockResolvedValue({ id: 'new' });
    mocks.update.mockReset().mockResolvedValue({ id: 'd1' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('disables both creation entries and explains why when all units is selected', async () => {
    render(<MemoryRouter><Dosir /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Buat Dosir Pertama' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Buat Dosir Baru' })).toBeDisabled();
    expect(screen.getByText(/Pilih unit kerja terlebih dahulu/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
});
it('shows a create error and leaves the user input available for retry', async () => {
    mocks.user = { role: 'admin_unit', unitKerjaId: 'ditjen' };
    mocks.create.mockRejectedValueOnce(new Error('Penyimpanan tidak tersedia'));
    render(<MemoryRouter><Dosir /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Buat Dosir Pertama' }));
    fireEvent.change(screen.getByLabelText('Judul Perkara *'), { target: { value: 'Dosir percobaan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Dosir', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Penyimpanan tidak tersedia');
    expect(screen.getByLabelText('Judul Perkara *')).toHaveValue('Dosir percobaan');
});
it('prevents inverted dates and accepts a correction in the edit dialog', async () => {
    render(<MemoryRouter initialEntries={['/dosir/d1']}><Routes><Route path='/dosir/:id' element={<DosirDetail />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Dosir' }));
    fireEvent.change(screen.getByLabelText('Tanggal Selesai'), { target: { value: '2026-09-13' } });
    expect(screen.getByRole('button', { name: 'Simpan Perubahan' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Tanggal selesai tidak boleh sebelum tanggal mulai');
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Tanggal Selesai'), { target: { value: '2026-09-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('d1', expect.objectContaining({ tanggalMulai: '2026-09-14', tanggalSelesai: '2026-09-14' })));
});
