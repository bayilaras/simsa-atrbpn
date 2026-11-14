import { describe, expect, it } from 'vitest';
import { MULTILINE_FIELDS, sanitizeInput, sanitizeMultipartInput, sanitizeSatuBaris } from '../middlewares/sanitize.middleware';
import { NAMA_ELEMEN_MARKUP } from '../constants/nama-elemen-markup';
import { parseJsonObjectString } from '../utils/json-objek-teks';
import { createSuratMasukSchema } from '../validators/schemas';

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

    // '<' yang ditulis sebagai escape JSON (\u003c) baru terlihat setelah JSON diurai.
    const escapeLt = (json: string) => json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    it.each([['BOM', '\ufeff'], ['NBSP', '\u00a0'], ['spasi dan baris baru', ' \n']])(
        'teks JSON berawalan %s diurai sama dengan validator, termasuk escape \\u003c', (_label, awalan) => {
            const hasil = jalankanMultipart({
                disposisi: awalan + escapeLt(JSON.stringify({ targets: [{ unitKerjaId: 'U1' }], instruksi: '<img src=x onerror=alert(1)>Segera\nhari ini' })),
                tindakLanjut: awalan + escapeLt(JSON.stringify({ catatan: '<script>alert(1)</script>Lanjut', jenisRelasi: 'balasan' })),
            });
            const disposisi = parseJsonObjectString(hasil.disposisi) as any;
            const tindakLanjut = parseJsonObjectString(hasil.tindakLanjut) as any;
            expect(disposisi).toEqual({ targets: [{ unitKerjaId: 'U1' }], instruksi: 'Segera\nhari ini' });
            expect(tindakLanjut).toEqual({ catatan: 'Lanjut', jenisRelasi: 'balasan' });
        });

    it('isian surat masuk multipart yang lolos penyaring dan validator tidak membawa tag', () => {
        const req: any = { body: {
            nomorSurat: 'X/1', tanggalSurat: '2026-11-14', dari: 'A', unitKerjaId: 'U0',
            perihal: 'uji <img\u000bsrc=x onerror=alert(1)>',
            disposisi: '\u00a0' + escapeLt(JSON.stringify({ targets: [{ unitKerjaId: 'U1' }], instruksi: '<img src=x onerror=alert(1)>' })),
        } };
        sanitizeMultipartInput(req, {} as any, () => undefined);
        const hasil = createSuratMasukSchema.safeParse(req.body);
        expect(hasil.success).toBe(true);
        expect(hasil.data).toMatchObject({ perihal: 'uji', disposisi: { targets: [{ unitKerjaId: 'U1' }], instruksi: '' } });
    });

    it('kunci "__proto__" dari teks JSON tetap menjadi kunci biasa', () => {
        const hasil = JSON.parse(jalankanMultipart({ referensi: '{"__proto__":{"x":"<b>1</b>"},"jenis":"surat_keluar"}' }).referensi);
        expect(Object.getPrototypeOf(hasil)).toBe(Object.prototype);
        expect(Object.keys(hasil).sort()).toEqual(['__proto__', 'jenis']);
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

    it('mencakup persis bidang multi-baris §5 ditambah bidang lain yang berupa textarea', () => {
        expect([...MULTILINE_FIELDS].sort()).toEqual([
            'alasan', 'catatan', 'catatanPenyelesaian', 'description', 'deskripsi', 'details', 'instruction', 'instruksi',
            'keterangan', 'notes', 'perihal', 'purpose', 'reason', 'uraianBerkas',
        ]);
    });

    it('perihal mempertahankan baris baru dari isian multi-baris', () => {
        expect(jalankan({ perihal: 'Undangan\r\nRapat  Koordinasi <b>Tahap</b>\n\n\n\nII' }).perihal)
            .toBe('Undangan\nRapat Koordinasi Tahap\n\nII');
    });

    it.each(['uraianBerkas', 'purpose', 'details', 'notes', 'reason', 'deskripsi', 'description'])('%s (textarea) mempertahankan baris baru', (bidang) => {
        expect(jalankan({ [bidang]: 'Baris  <b>satu</b>\r\nbaris dua' })[bidang]).toBe('Baris satu\nbaris dua');
    });

    it('bidang lain tetap diratakan menjadi satu baris', () => {
        expect(jalankan({ dari: 'Biro\n  Umum' }).dari).toBe('Biro Umum');
    });

    it('bidang bersarang (disposisi.instruksi) ikut dipertahankan', () => {
        expect(jalankan({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: ' dir_bppt ' }] } }))
            .toEqual({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: 'dir_bppt' }] } });
    });
});

/**
 * Tag yang masih hidup: nama elemen dikenal yang diikuti pemisah, '/' atau '>',
 * atau nama lain yang diikuti pemisah atau '/' dan membawa atribut on* bernilai
 * sebelum '>'. Nama dibaca seperti peramban (berlanjut melewati '<'). Ditulis
 * ulang dengan ekspresi reguler, terpisah dari pemindai yang diuji; oracle parse5
 * ada di sanitize.parse5-oracle.test.ts.
 */
function tagHidup(teks: string): string[] {
    const temuan: string[] = [];
    for (const [cocok, nama] of teks.matchAll(/<\/?([A-Za-z][^\s/>]*)(?=[\s/>])/g)) {
        if (NAMA_ELEMEN_MARKUP.has(nama.toLowerCase())) temuan.push(cocok);
    }
    temuan.push(...(teks.match(/<[A-Za-z][^\s/>]*[\s/](?:[^>]*[\s/"'])?on[a-z]+\s*=[^>]*>/gi) ?? []));
    return temuan;
}

/** Hasil penyaringan aman dan tetap: tanpa tag hidup, dan menyaring ulang tidak mengubahnya. */
function periksaAman(masukan: string): string[] {
    const galat: string[] = [];
    const satu = sanitizeSatuBaris(masukan);
    const multi = jalankan({ keterangan: masukan }).keterangan as string;
    for (const [jenis, hasil, ulang] of [
        ['satu baris', satu, sanitizeSatuBaris(satu)],
        ['multi-baris', multi, jalankan({ keterangan: multi }).keterangan],
    ] as const) {
        if (tagHidup(hasil).length > 0) galat.push(`${jenis} ${JSON.stringify(masukan)} → ${JSON.stringify(hasil)}`);
        if (ulang !== hasil) galat.push(`${jenis} tidak tetap ${JSON.stringify(masukan)}: ${JSON.stringify(hasil)} → ${JSON.stringify(ulang)}`);
    }
    return galat;
}

describe('penyaring tahan terhadap pemisah dan atribut yang tidak lazim', () => {
    // Semua karakter kelas \s JavaScript, ditambah karakter yang bukan pemisah.
    const pemisah = [
        '\t', '\n', '\u000b', '\f', '\r', ' ', ' ', ' ',
        ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)),
        ' ', ' ', ' ', ' ', '　', '﻿', '/', '\u0000', '​',
    ];
    const nama = ['img', 'IMG', 'svg', 'iframe', 'script', 'style', 'a', 'math', 'x-foo', 'X-Foo', 'xss'];
    const pola = [
        (n: string, s: string) => `<${n}${s}src=x onerror=alert(1)>`,
        (n: string, s: string) => `<${n}${s}onload=alert(1)>`,
        (n: string, s: string) => `teks <${n}${s}>alert(1)</${n}${s}> akhir`,
        (n: string, s: string) => `<${n}${s}title="a<b" onclick=alert(1)>klik`,
        (n: string, s: string) => `awal <${n}${s}onfocus=alert(1) autofocus`,
    ];

    it('setiap kombinasi pemisah, nama elemen, dan bentuk tag menghasilkan teks tanpa tag hidup yang tetap', () => {
        const galat = pemisah.flatMap(s => nama.flatMap(n => pola.flatMap(p => periksaAman(p(n, s)))));
        expect(galat).toEqual([]);
    });

    it.each([
        // Pemisah selain spasi HTML yang kemudian dinormalisasi menjadi spasi.
        ['<img\u000bsrc=x onerror=alert(1)>', ''],
        ['<svg onload=alert(1)>', ''],
        ['<iframe　src=//x>', ''],
        ['<script\u000b>alert(1)</script\u000b>', ''],
        ['<a href=x>klik</a>', 'klik'],
        // '<' di dalam tag, di dalam atau di luar nilai berkutip.
        ['<img src=x onerror=alert(1<2)>', ''],
        ['<img src=x onerror="alert(1<2)">', ''],
        ["<img src=x onerror=alert(1) x='<'>", ''],
        ['<img src=x onerror=alert(1) <>', ''],
        ['<a href="javascript:alert(1)" title="<">klik</a>', 'klik'],
        ['<img src=x one<b>rror=alert(1)>', 'rror=alert(1)>'],
        // Tag yang tidak pernah ditutup: '<'-nya dinetralkan.
        ['<img src=x onerror=alert(1)', '< img src=x onerror=alert(1)'],
        ['<img src=x onerror=alert(1) x="', '< img src=x onerror=alert(1) x="'],
        // Nama lain (termasuk nama bertanda hubung) yang membawa atribut.
        ['<xss onmouseover=alert(1)>', ''],
        ['<nama onfocus=alert(1) autofocus>', ''],
        ['<X-Foo onclick=alert(1)>', ''],
        ['<x/onclick=alert(1)>', ''],
        ['<img:x src=x onerror=1>', ''],
        // Nama dibaca seperti peramban: melewati '<' sampai pemisah, '/' atau '>'.
        ['<img<1 onfocus=alert(1) autofocus tabindex=1>', ''],
        ['<x<!-- onfocus=alert(1) autofocus tabindex=1>', ''],
        // 'onfocus=...' di sini bagian dari nama tag, bukan atribut: tidak ada penangan.
        ['<img<?onfocus=alert(1) autofocus tabindex=1>', '<img<?onfocus=alert(1) autofocus tabindex=1>'],
        ["<imgx='<' onfocus=1>", ''],
        // '/' setelah nama tak dikenal diperlakukan seperti spasi.
        ['<x/ onfocus=alert(1) autofocus tabindex=1>', ''],
        ['<x/\tonfocus=alert(1) autofocus tabindex=1>', ''],
        ['<x/=a onfocus=alert(1) autofocus tabindex=1>', ''],
        ["<x/'a' onfocus=alert(1) autofocus tabindex=1>", ''],
        ['<x/"x" onfocus=alert(1) autofocus tabindex=1>', ''],
        ['<x\u0000/ onfocus=alert(1) autofocus tabindex=1>', ''],
        // Atribut on* bernilai dibaca seperti peramban: nilai berkutip boleh memuat '>'.
        ["<x title='a>b' onclick=alert(1)>klik", 'klik'],
        ['<x title="a>b" onclick=alert(1)>klik', 'klik'],
        // Tag bernama lain dengan penangan bernilai tetapi tanpa '>': '<' diberi spasi.
        ['<x onclick=alert(1)', '< x onclick=alert(1)'],
        // Nama elemen dikenal + pemisah tanpa '>' sesudahnya: '<' diberi spasi.
        ['a <b dan c', 'a < b dan c'],
    ])('%j menjadi %j', (masukan, hasil) => {
        expect(sanitizeSatuBaris(masukan)).toBe(hasil);
        expect(periksaAman(masukan)).toEqual([]);
    });

    // Kasus dari tinjauan keamanan; hasilnya cukup tanpa tag hidup dan tetap.
    const serangan = [
        '<IMG SRC=x OnErRoR=alert(1)>', '<img/src=x onerror=alert(1)>', '<svg\nonload=alert(1)>', '<svg\tonload=alert(1)>',
        '<img src=x onerror=alert(1) <b>', '<img src="x" onerror=alert(1)//<', '<scr<b>ipt>alert(1)</scr<b>ipt>',
        '<img\u0000 src=x onerror=alert(1)>', '<\u0000img src=x onerror=alert(1)>', '<img\u000csrc=x onerror=alert(1)>',
        '<!-- <img src=x onerror=alert(1)>', '<!--><img src=x onerror=alert(1)>', '<!---><img src=x onerror=1>-->',
        '<![CDATA[<img src=x onerror=alert(1)>]]>', '<?xml version="1.0"?><svg onload=alert(1)>', '<!DOCTYPE html><img src=x onerror=1>',
        '</script >', '</script\n>x', '<script>alert(1)</script foo="bar">', '<script>alert(1)</SCRIPT>y', '<script>alert(1)',
        '<script src=//evil></script>', '<style>*{x:y}</style >z', '<script>a</script<b>>', '<x-foo onclick=alert(1)>',
        '<xss onmouseover=alert(1) style=position:fixed;inset:0>', '<nama onfocus=alert(1) autofocus tabindex=1>',
        '<img;src=x onerror=1>', '<img,src>', '<svg:script>alert(1)</svg:script>', '<img\rsrc=x onerror=1>',
        '<iframe srcdoc="<script>alert(1)</script>">', '<math><mtext><img src=x onerror=1>', '<a<b>c>', '<b<a href=x>>',
        '<form action=//evil><input name=x>', '<base href=//evil/>', '<meta http-equiv=refresh content="0;url=//evil">',
        '<img src=x onerror=alert`1`>', '<img src=x onerror=alert(1) x=<>', '<iframe　src=//evil>',
        ...[1, 5, 9, 10, 11, 30].flatMap(d => {
            const x = '<b'.repeat(d) + '>'.repeat(d);
            return [`<scr${x}ipt>alert(1)</script>`, `<img src=x onerror=alert(1) ${x}>`, `<im${x}g src=x onerror=alert(1)>`];
        }),
    ];

    it('kasus tinjauan keamanan tidak menyisakan tag hidup dan hasilnya tetap', () => {
        expect(serangan.flatMap(periksaAman)).toEqual([]);
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
        'nilai p<q',
        '&lt;img src=x onerror=alert(1)&gt;',
        // Nama bertanda hubung tanpa atribut tetap teks.
        'Aplikasi <e-Office>',
        // Nama lain dengan atribut yang tidak dapat menjalankan apa pun tetap teks.
        'Tautan <http://contoh.go.id/berkas?nomor=1> terlampir',
        '<https://contoh.go.id/a/b?x=1&y=2>',
        '<Rapat Online>',
        '<x a=1 b="2" c=3>',
        '<x onfocus autofocus>',
        'Lampiran <PP-24/1997>',
        'Lihat <Sub-Bagian TU>',
        'Kode <A-1> dan <B_2>',
        '<x-foo>',
        // Nama elemen di akhir teks bukan tag; nama tak dikenal tanpa '>' tetap.
        'teks <img',
        'nilai x <y dan z = 5',
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

    it('waktu kerja tetap linear untuk masukan 500 ribu karakter yang dirancang memperlambat', () => {
        const N = 500_000;
        let dalam = 'b';
        for (let i = 0; i < 2000; i += 1) dalam = `<${dalam}>`;
        const bentuk = [
            '<'.repeat(N),
            '<a '.repeat(N / 3),
            '<a ="'.repeat(N / 5),
            '<a b="'.repeat(N / 6),
            '<script>'.repeat(N / 8),
            ('<script>' + '<style>').repeat(N / 15),
            '<style>'.repeat(N / 16) + '</script>' + '<script>'.repeat(N / 16),
            '<!--'.repeat(N / 4),
            '<b'.repeat(N / 2) + '>'.repeat(N / 2),
            '</script'.repeat(N / 8),
            '<script>' + '<a x="'.repeat(N / 6),
            '<scr'.repeat(N / 8) + 'ipt>'.repeat(N / 8),
            ('<a x="' + 'y'.repeat(10)).repeat(N / 16),
            '<script></script >'.repeat(N / 18),
            ('<script>' + '</scrip').repeat(N / 15),
            '<b>'.repeat(N / 6) + '<i' + '>'.repeat(N / 6),
            'x<<b>b>'.repeat(N / 7),
            ('<a y=">"').repeat(N / 8) + ' x="',
            '<xss a'.repeat(N / 6) + '=>',
            '<x '.repeat(N / 3) + '=',
            '<x '.repeat(N / 3) + ' onclick=1',
            '<x onclick=1 '.repeat(N / 13),
            '<x/ '.repeat(N / 4),
            '<img<1 a=1 '.repeat(N / 11),
            '<x<1 a=1'.repeat(N / 8),
            ('<img a="' + "'" + "<x b='").repeat(N / 15),
            '<b\n'.repeat(N / 3),
            '<' + 'a'.repeat(N),
            '<aa'.repeat(N / 3),
            dalam.repeat(60),
            ' \n'.repeat(N / 2),
        ];
        for (const masukan of bentuk) {
            const mulai = performance.now();
            const hasil = sanitizeSatuBaris(masukan);
            expect(performance.now() - mulai).toBeLessThan(3_000);
            // Pemeriksa ekspresi reguler tagHidup sendiri tidak linear untuk masukan
            // sebesar ini; di sini cukup dipastikan hasilnya titik tetap.
            expect(sanitizeSatuBaris(hasil)).toBe(hasil);
        }
    });
});
