import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { KartuTunjukSilang } from './KartuTunjukSilang';

const mocks = vi.hoisted(() => ({ user: { id: 'u1', role: 'admin_unit' }, getByEntity: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/services/tunjuk-silang.service', () => ({ tunjukSilangService: { getByEntity: mocks.getByEntity } }));
// Kartu tidak mencari dokumen; layanan daftar tidak boleh ikut termuat lewat dokumen.js.
vi.mock('@/services/arsip.service', () => ({ arsipService: {} }));
vi.mock('@/services/dosir.service', () => ({ default: {} }));
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: {} }));
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: {} }));

const SURAT_ID = '550e8400-e29b-41d4-a716-446655440001';
const ARSIP_ID = '550e8400-e29b-41d4-a716-446655440002';
const DOSIR_ID = '550e8400-e29b-41d4-a716-446655440003';

const hubungan = [
    {
        id: 'ref-1', direction: 'outgoing', jenisRelasi: 'lampiran', keterangan: 'Berkas pendukung',
        relatedType: 'arsip', relatedId: ARSIP_ID,
        relatedLabel: { accessible: true, nomor: 'B-07', judul: 'Berkas pengadaan', jenis: 'masuk' },
    },
    {
        id: 'ref-2', direction: 'incoming', jenisRelasi: 'referensi', keterangan: null,
        relatedType: 'dosir', relatedId: DOSIR_ID,
        relatedLabel: { accessible: true, nomor: 'DJ-001', judul: 'Sengketa lahan', jenis: 'Sengketa' },
    },
    {
        id: 'ref-3', direction: 'incoming', jenisRelasi: 'berkaitan', keterangan: null,
        relatedType: 'surat_keluar', relatedId: '550e8400-e29b-41d4-a716-446655440004',
        relatedLabel: { accessible: false, nomor: null, judul: null, jenis: null },
    },
];

function renderKartu() {
    return render(<MemoryRouter><KartuTunjukSilang tipe="surat_masuk" id={SURAT_ID} /></MemoryRouter>);
}

beforeEach(() => {
    mocks.user = { id: 'u1', role: 'admin_unit' };
    mocks.getByEntity.mockReset().mockResolvedValue({ data: hubungan, subject: null, pagination: null });
});
afterEach(cleanup);

it('lists active cross references with readable labels and links to each record', async () => {
    renderKartu();

    expect(await screen.findByRole('link', { name: /Berkas pengadaan/ })).toHaveAttribute('href', `/arsip/detail/${ARSIP_ID}`);
    expect(mocks.getByEntity).toHaveBeenCalledWith('surat_masuk', SURAT_ID);
    expect(screen.getByText('Arsip • No: B-07 • Arsip surat masuk')).toBeInTheDocument();
    expect(screen.getByText('Berkas pendukung')).toBeInTheDocument();
    expect(screen.getByText('Menunjuk ke')).toBeInTheDocument();
    expect(screen.getByText('Lampiran')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sengketa lahan/ })).toHaveAttribute('href', `/dosir/${DOSIR_ID}`);
    expect(screen.getByRole('link', { name: 'Buka halaman Tunjuk Silang' }))
        .toHaveAttribute('href', `/tunjuk-silang?jenis=surat_masuk&id=${SURAT_ID}`);
    // Tidak ada pengenal mentah yang tampil sebagai teks.
    expect(screen.queryByText(ARSIP_ID)).toBeNull();
});

it('shows a neutral placeholder without a link for a record outside the viewer reach', async () => {
    renderKartu();

    const placeholder = await screen.findByText('Dokumen lain (tidak dalam jangkauan Anda)');
    expect(placeholder.closest('a')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
});

it('gives a read-only viewer no link to the dosir or the management page', async () => {
    mocks.user = { id: 'u2', role: 'auditor' };
    renderKartu();

    expect(await screen.findByText('Sengketa lahan')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sengketa lahan/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Buka halaman Tunjuk Silang' })).toBeNull();
    expect(screen.getByRole('link', { name: /Berkas pengadaan/ })).toBeInTheDocument();
});

it('does not claim the record has no cross reference when none is visible to the viewer', async () => {
    mocks.getByEntity.mockResolvedValue({ data: [], subject: null, pagination: null });
    renderKartu();

    expect(await screen.findByText('Tidak ada tunjuk silang yang dapat Anda lihat untuk dokumen ini.')).toBeInTheDocument();
});

it('renders nothing when the viewer may not trace this record', async () => {
    mocks.getByEntity.mockRejectedValue(Object.assign(new Error('tidak ditemukan'), { status: 404 }));
    const { container } = renderKartu();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it('keeps the page usable when the list cannot be loaded', async () => {
    mocks.getByEntity.mockRejectedValue(Object.assign(new Error('NetworkError'), { status: 0 }));
    renderKartu();

    expect(await screen.findByText('Tunjuk silang belum dapat dimuat. Muat ulang halaman untuk mencoba lagi.')).toBeInTheDocument();
    expect(screen.queryByText('NetworkError')).toBeNull();
});
