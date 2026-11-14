import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DosirDetail from './DosirDetail';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/dosir.service', () => ({
    default: {
        getById: vi.fn().mockResolvedValue({
            id: 'd1', kode: 'QA-001', judul: 'Dosir sintetis', status: 'open', unitKerjaId: 'unit-a',
            deskripsi: 'Berkas pengadaan tanah\nTahap kedua', createdAt: '2026-09-14T00:00:00.000Z',
            updatedAt: '2026-09-14T00:00:00.000Z', suratMasuk: [], suratKeluar: [],
        }),
        getTimeline: vi.fn().mockResolvedValue([]),
        addSurat: vi.fn(), removeSurat: vi.fn(), update: vi.fn(),
    },
}));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getAll: vi.fn() } }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { getAll: vi.fn() } }));
afterEach(cleanup);

it('deskripsi dosir multi-baris tampil dengan baris barunya', async () => {
    render(
        <MemoryRouter initialEntries={['/dosir/d1']}>
            <Routes><Route path="/dosir/:id" element={<DosirDetail />} /></Routes>
        </MemoryRouter>,
    );
    expect(await screen.findByText(/Tahap kedua/)).toHaveClass('whitespace-pre-line');
});
