import { describe, expect, it } from 'vitest';
import { MULTILINE_FIELDS, sanitizeInput, sanitizeMultipartInput, sanitizeSatuBaris } from '../middlewares/sanitize.middleware';

function jalankan(body: unknown) {
    const req: any = { body };
    sanitizeInput(req, {} as any, () => undefined);
    return req.body;
}

function jalankanMultipart(body: unknown) {
    const req: any = { body };
    sanitizeMultipartInput(req, {} as any, () => undefined);
    return req.body;
}

describe('sanitizeMultipartInput', () => {
    it('objek bersarang dalam teks JSON disaring seperti badan JSON dan tetap berupa teks JSON', () => {
        const hasil = jalankanMultipart({
            disposisi: JSON.stringify({ instruksi: 'Baris <b>satu</b>\nbaris dua', labelTambahan: ['<i>Segera</i>'] }),
            perihal: '{Rahasia} <i>Undangan</i>\nrapat',
        });
        expect(JSON.parse(hasil.disposisi)).toEqual({ instruksi: 'Baris satu\nbaris dua', labelTambahan: ['Segera'] });
        expect(hasil.perihal).toBe('{Rahasia} Undangan\nrapat');
    });

    it('teks berawalan { yang bukan JSON disaring sebagai teks biasa', () => {
        expect(jalankanMultipart({ referensi: '{bukan json <b>x</b>' }).referensi).toBe('{bukan json x');
    });

    it('badan JSON yang sudah tersaring tidak berubah (idempoten)', () => {
        const badan = jalankan({ perihal: 'a <b>b</b>\nc', disposisi: { instruksi: 'x\ny', targets: [{ unitKerjaId: 'u' }] } });
        expect(jalankanMultipart(structuredClone(badan))).toEqual(badan);
    });
});

describe('sanitizeInput', () => {
    it('mempertahankan baris baru pada instruksi tetapi tetap membuang tag', () => {
        expect(jalankan({ instruksi: '1. Siapkan data\r\n2.  Koordinasikan <b>dengan</b> PTEP\n\n\n\n3. Laporkan' }).instruksi)
            .toBe('1. Siapkan data\n2. Koordinasikan dengan PTEP\n\n3. Laporkan');
    });

    it('mencakup persis bidang multi-baris §5 ditambah perihal (textarea)', () => {
        expect([...MULTILINE_FIELDS].sort()).toEqual(['alasan', 'catatan', 'catatanPenyelesaian', 'instruction', 'instruksi', 'keterangan', 'perihal']);
    });

    it('perihal mempertahankan baris baru dari isian multi-baris', () => {
        expect(jalankan({ perihal: 'Undangan\r\nRapat  Koordinasi <b>Tahap</b>\n\n\n\nII' }).perihal)
            .toBe('Undangan\nRapat Koordinasi Tahap\n\nII');
    });

    it('bidang lain tetap diratakan menjadi satu baris', () => {
        expect(jalankan({ dari: 'Biro\n  Umum' }).dari).toBe('Biro Umum');
    });

    it('bidang bersarang (disposisi.instruksi) ikut dipertahankan', () => {
        expect(jalankan({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: ' dir_bppt ' }] } }))
            .toEqual({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: 'dir_bppt' }] } });
    });
});

describe('penyaring hanya membuang markup HTML', () => {
    const teksBiasa = [
        'a < b > c',
        'x<y',
        'Budi <budi@contoh.go.id>',
        '->',
        '<- kembali',
        '<= 5',
        'Luas < 5 ha dan > 2 ha',
        'Rp <5 juta',
        '<http://contoh.go.id/surat>',
        '<!DOCTYPE html>',
        // Kata yang bukan nama elemen HTML/SVG/MathML adalah teks biasa.
        'Undangan <Rapat Koordinasi>',
        '<nama>',
        '<Lampiran 1>',
        '<<RAHASIA>>',
        // Elemen kustom ditulis huruf kecil; kata berhuruf kapital tetap teks.
        'Aplikasi <e-Office>',
    ];

    it.each(teksBiasa)('teks %j disimpan persis', (teks) => {
        expect(sanitizeSatuBaris(teks)).toBe(teks);
        expect(jalankan({ dari: teks, keterangan: teks, catatan: [teks] })).toEqual({ dari: teks, keterangan: teks, catatan: [teks] });
    });

    it('teks bertanda < dan > pada bidang multi-baris tetap utuh beserta baris barunya', () => {
        expect(jalankan({ keterangan: 'Luas < 5 ha\ndan > 2 ha' }).keterangan).toBe('Luas < 5 ha\ndan > 2 ha');
    });

    it.each([
        ['<img src=x onerror=alert(1)>', ''],
        ['<script>alert(1)</script>', ''],
        ['<b>tebal</b>', 'tebal'],
        ['Surat <i>penting</i> ini', 'Surat penting ini'],
        ['<SCRIPT type="text/javascript">alert(1)</SCRIPT >sisa', 'sisa'],
        ['<style>p { color: red }</style>teks', 'teks'],
        ['a<!-- catatan -->b', 'ab'],
        ['baris<br/>berikut</div>', 'barisberikut'],
        ['<img alt=">" src=x onerror=alert(1)>tetap', 'tetap'],
        ['<script>tanpa penutup', 'tanpa penutup'],
        ['<svg onload=alert(1)>', ''],
        ['<x-foo onclick=a>', ''],
        ['<IFRAME src=x>', ''],
        ['<math><mi>x</mi></math>', 'x'],
        // Tag yang baru terbentuk setelah tag lain dibuang ikut dibuang.
        ['<scr<b>ipt>alert(1)</script>', 'alert(1)'],
        ['<scr<b>ipt>alert(1)</scr</b>ipt>', ''],
        ['<<b>img src=x onerror=alert(1)>', ''],
    ])('markup %j dibuang menjadi %j', (masukan, hasil) => {
        expect(sanitizeSatuBaris(masukan)).toBe(hasil);
        expect(jalankan({ keterangan: masukan }).keterangan).toBe(hasil);
    });

    it('waktu kerja tetap linear untuk masukan dengan tanda < sangat banyak', () => {
        const bentuk = [
            '<'.repeat(200_000),
            '<a b="'.repeat(40_000),
            '<script>'.repeat(25_000),
            '<style>'.repeat(15_000) + '</script>' + '<script>'.repeat(15_000),
            '<!--'.repeat(50_000),
            '<'.repeat(50_000) + '<b>' + 'b>'.repeat(50_000),
        ];
        for (const masukan of bentuk) {
            const mulai = performance.now();
            const hasil = sanitizeSatuBaris(masukan);
            expect(performance.now() - mulai).toBeLessThan(1_500);
            expect(hasil).not.toMatch(/<[a-z][a-z0-9-]*[\s/>][^<]*>/i);
        }
    });
});
