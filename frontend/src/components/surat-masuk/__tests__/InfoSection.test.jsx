import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InfoSection } from '../InfoSection';

describe('InfoSection', () => {
    const mockSurat = {
        perihal: 'Test Surat Penting',
        nomorSurat: '123/TEST/2024',
        tanggalSurat: '2024-02-13T00:00:00.000Z',
        tanggalDiterima: '2024-02-14T00:00:00.000Z',
        noAgenda: 'AGENDA-001',
        dari: 'Kementerian Pusat',
        kepada: 'Unit Teknis',
        jenisSurat: 'Undangan',
        sifatSurat: 'segera',
        klasifikasi: 'UMUM',
        linkDokumen: 'https://example.com/doc',
        catatan: 'Harap hadir tepat waktu',
    };

    it('renders surat information correctly', () => {
        render(<InfoSection surat={mockSurat} />);

        expect(screen.getByText('Test Surat Penting')).toBeInTheDocument();
        expect(screen.getByText('123/TEST/2024')).toBeInTheDocument();
        expect(screen.getByText('Kementerian Pusat')).toBeInTheDocument();
        expect(screen.getByText('Unit Teknis')).toBeInTheDocument();
        expect(screen.getByText('Undangan')).toBeInTheDocument();
        expect(screen.getByText('Segera')).toBeInTheDocument();
        expect(screen.getByText('AGENDA-001')).toBeInTheDocument();
    });

    it('handles missing optional fields gracefully', () => {
        const minimalSurat = {
            ...mockSurat,
            noAgenda: null,
            linkDokumen: null,
            catatan: null,
        };

        render(<InfoSection surat={minimalSurat} />);

        expect(screen.getByText('Belum ada')).toBeInTheDocument(); // No Agenda fallback
        expect(screen.queryByText('Link Dokumen')).not.toBeInTheDocument();
        expect(screen.queryByText('Catatan')).not.toBeInTheDocument();
    });

    it('renders link dokumen when present', () => {
        render(<InfoSection surat={mockSurat} />);

        const link = screen.getByText('https://example.com/doc');
        expect(link).toBeInTheDocument();
        expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/doc');
    });

    it('renders catatan when present', () => {
        render(<InfoSection surat={mockSurat} />);
        expect(screen.getByText('Harap hadir tepat waktu')).toBeInTheDocument();
    });
});
