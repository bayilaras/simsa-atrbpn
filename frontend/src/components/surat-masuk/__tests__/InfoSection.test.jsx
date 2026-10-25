import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InfoSection } from '../InfoSection';

describe('InfoSection', () => {
    const mockSurat = {
        perihal: 'Test Surat Penting',
        nomorSurat: '123/TEST/2024',
        tanggalSurat: '2024-02-13T00:00:00.000Z',
        noUrut: 17,
        tahun: 2024,
        dari: 'Kementerian Pusat',
        kepada: 'Unit Teknis',
        jenisSurat: 'Undangan',
        sifatSurat: 'segera',
        klasifikasi: 'UMUM',
        linkDokumen: 'https://example.com/doc',
        disposisi: ['Dit. BPPT', 'Kabag Umum'],
        keterangan: 'Harap hadir tepat waktu',
    };

    it('menampilkan kolom surat_masuk yang nyata', () => {
        render(<InfoSection surat={mockSurat} />);

        expect(screen.getByText('Test Surat Penting')).toBeInTheDocument();
        expect(screen.getByText('123/TEST/2024')).toBeInTheDocument();
        expect(screen.getByText('Kementerian Pusat')).toBeInTheDocument();
        expect(screen.getByText('Unit Teknis')).toBeInTheDocument();
        expect(screen.getByText('Undangan')).toBeInTheDocument();
        expect(screen.getByText('Segera')).toBeInTheDocument();
        const agenda = screen.getByText('No. Agenda').parentElement;
        expect(within(agenda).getByText('17')).toBeInTheDocument();
    });

    it('tidak merender field fantom yang tidak pernah dikirim API', () => {
        render(<InfoSection surat={{
            ...mockSurat,
            tanggalDiterima: '2024-02-14T00:00:00.000Z',
            noAgenda: 'AGENDA-001',
            catatan: 'Catatan fantom',
        }} />);

        expect(screen.queryByText('Tanggal Diterima')).not.toBeInTheDocument();
        expect(screen.queryByText('AGENDA-001')).not.toBeInTheDocument();
        expect(screen.queryByText('Catatan')).not.toBeInTheDocument();
        expect(screen.queryByText('Catatan fantom')).not.toBeInTheDocument();
    });

    it('menampilkan label disposisi sebagai daftar dan membuang label kosong data lama', () => {
        render(<InfoSection surat={{ ...mockSurat, disposisi: ['Dit. BPPT', '  ', '', 'Kabag Umum ', null] }} />);

        const list = screen.getByRole('list', { name: 'Disposisi' });
        expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Dit. BPPT', 'Kabag Umum']);
    });

    it.each([[null], [[]], [['', '   ']], ['BPPT']])('menampilkan keadaan kosong bila disposisi %j', (disposisi) => {
        render(<InfoSection surat={{ ...mockSurat, disposisi }} />);

        expect(screen.getByText('Belum ada disposisi')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Disposisi' })).not.toBeInTheDocument();
    });

    it('menampilkan keterangan multi-baris bila ada', () => {
        render(<InfoSection surat={{ ...mockSurat, keterangan: 'Baris satu\nBaris dua' }} />);

        expect(screen.getByText('Keterangan')).toBeInTheDocument();
        expect(screen.getByText(/Baris satu/)).toHaveClass('whitespace-pre-line');
    });

    it.each([[null], [''], ['   ']])('menyembunyikan keterangan bila %j', (keterangan) => {
        render(<InfoSection surat={{ ...mockSurat, keterangan }} />);

        expect(screen.queryByText('Keterangan')).not.toBeInTheDocument();
    });

    it('menampilkan "-" untuk No. Agenda bila noUrut tidak ada', () => {
        render(<InfoSection surat={{ ...mockSurat, noUrut: null }} />);

        const agenda = screen.getByText('No. Agenda').parentElement;
        expect(within(agenda).getByText('-')).toBeInTheDocument();
    });

    it.each([
        ['Sangat Segera', 'Sangat Segera'],
        ['sangat-segera', 'Sangat Segera'],
        ['RAHASIA', 'Rahasia'],
        ['Sangat Rahasia', 'Sangat Rahasia'],
        ['Terbatas', 'Terbatas'],
        [null, 'Biasa'],
        ['', 'Biasa'],
        ['constructor', 'constructor'],
    ])('memberi label sifat %j sebagai %s', (sifatSurat, label) => {
        render(<InfoSection surat={{ ...mockSurat, jenisSurat: 'Nota Dinas', sifatSurat }} />);

        const sifat = screen.getByText('Sifat Surat').parentElement;
        expect(within(sifat).getByText(label)).toBeInTheDocument();
    });

    it('merender link dokumen bila ada', () => {
        render(<InfoSection surat={mockSurat} />);

        const link = screen.getByText('https://example.com/doc');
        expect(link).toBeInTheDocument();
        expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/doc');
    });
});
