import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizeInput, sanitizeSatuBaris } from '../middlewares/sanitize.middleware';
import { NAMA_ELEMEN_MARKUP } from '../constants/nama-elemen-markup';

/**
 * Oracle independen: keluaran penyaring diurai dengan parse5 (pengurai HTML
 * sesuai standar, bukan pemindai penyaring). Keluaran tidak boleh menghasilkan
 * elemen HTML/SVG/MathML yang dikenal, maupun elemen apa pun dengan atribut
 * bernama on* (/^on[a-z]+$/i) yang bernilai. Atribut on* tanpa nilai tidak
 * menjalankan apa pun dan harus dibiarkan, sebab kata biasa seperti "Online"
 * pada "<Rapat Online>" terbaca sebagai atribut bernama "online".
 *
 * parse5 adalah dependensi frontend (lewat jsdom). Uji ini memakai parse5 dari
 * backend/node_modules (job CI memasangnya tanpa mengubah package.json) atau
 * dari frontend/node_modules (lokal). Di CI uji gagal bila parse5 tidak ada,
 * supaya tidak terlewati diam-diam. Kasus tetapnya juga ada di
 * sanitize.middleware.test.ts dengan pemeriksa ekspresi reguler.
 */
const folderUji = path.dirname(fileURLToPath(import.meta.url));
const lokasiParse5 = ['../../node_modules/parse5/dist/index.js', '../../../frontend/node_modules/parse5/dist/index.js']
    .map(relatif => path.resolve(folderUji, relatif))
    .find(lokasi => existsSync(lokasi));
const parse5: any = lokasiParse5 ? await import(/* @vite-ignore */ pathToFileURL(lokasiParse5).href) : null;
if (!parse5 && process.env.CI) throw new Error('parse5 tidak terpasang; uji oracle penyaring tidak boleh dilewati di CI.');

const multiBaris = (teks: string): string => {
    const req: any = { body: { perihal: teks } };
    sanitizeInput(req, {} as any, () => undefined);
    return req.body.perihal;
};

function bahaya(html: string): string | null {
    const dikenal = new Set<string>([...NAMA_ELEMEN_MARKUP, ...Object.values(parse5.html.TAG_NAMES).map(String)]);
    const telusuri = (simpul: any): string | null => {
        for (const anak of simpul.childNodes ?? []) {
            if (anak.tagName) {
                if (dikenal.has(String(anak.tagName).toLowerCase())) return `elemen dikenal <${anak.tagName}>`;
                const penangan = (anak.attrs ?? []).filter((atribut: any) => /^on[a-z]+$/i.test(atribut.name) && atribut.value !== '');
                if (penangan.length > 0) return `<${anak.tagName} ${penangan.map((a: any) => `${a.name}=${a.value}`).join(' ')}>`;
            }
            const dalam = telusuri(anak.content ?? anak);
            if (dalam) return dalam;
        }
        return null;
    };
    return telusuri(parse5.parseFragment(html));
}

/** Semua masalah untuk satu masukan: elemen berbahaya, bukan titik tetap, atau beda hasil antarjalur. */
function periksa(masukan: string): string[] {
    const satu = sanitizeSatuBaris(masukan);
    const multi = multiBaris(masukan);
    const galat: string[] = [];
    for (const [jenis, hasil, ulang] of [['satu baris', satu, sanitizeSatuBaris(satu)], ['multi-baris', multi, multiBaris(multi)]] as const) {
        const temuan = bahaya(hasil);
        if (temuan) galat.push(`${jenis}: ${JSON.stringify(masukan)} → ${JSON.stringify(hasil)} (${temuan})`);
        if (ulang !== hasil) galat.push(`${jenis} tidak tetap: ${JSON.stringify(masukan)}`);
    }
    if (sanitizeSatuBaris(multi) !== satu) galat.push(`jalur multi-baris lalu satu baris berbeda: ${JSON.stringify(masukan)}`);
    return galat;
}

function acak(benih: number) {
    let nilai = benih;
    return (batas: number) => {
        nilai = (nilai * 1103515245 + 12345) & 0x7fffffff;
        return nilai % batas;
    };
}

describe.skipIf(!parse5)('penyaring diuji dengan pengurai HTML parse5', () => {
    it('kasus tinjauan keamanan', () => {
        const kasus = [
            '<x/ onfocus=alert(1) autofocus tabindex=1>', '<x/\tonfocus=alert(1) autofocus tabindex=1>', '<x/=a onfocus=alert(1) autofocus tabindex=1>',
            "<x/'a' onfocus=alert(1) autofocus tabindex=1>", '<x/"x" onfocus=alert(1) autofocus tabindex=1>', '<x\u0000/ onfocus=alert(1) autofocus tabindex=1>',
            '<x<1 onfocus=alert(1) autofocus tabindex=1>', '<img<1 onfocus=alert(1) autofocus tabindex=1>', '<x<1/onfocus=alert(1) autofocus tabindex=1>',
            '<x<<1 onfocus=alert(1) autofocus tabindex=1>', '<x/ /onfocus=alert(1) autofocus tabindex=1>', '<x / onfocus=alert(1)>',
            '<x<!-- onfocus=alert(1) autofocus tabindex=1>', '<img<?onfocus=alert(1) autofocus tabindex=1>', "<imgx='<' onfocus=1>",
            '<img src=x onerror=alert(1)\n', 'baris <img\n\nsrc=x', '<img src="a>b" onerror=alert(1)>', "<img src='a\" onerror=alert(1)>",
            '<img src=x onerror=alert(1) a="b>', '<img a=" <b>" onerror=alert(1)>', '<img a=" " <b> onerror=alert(1)>', '</img onerror=alert(1)>',
            '</x onfocus=alert(1)>', '<scr<x a=1>ipt>alert(1)</script>', '<i<x a=1>mg src=x onerror=alert(1)>', '<im\u000bg src=x onerror=1>',
            '<!--<img src=x onerror=1>--!><img src=x onerror=2>', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
            '<style><img src=x onerror=1></style>', '<textarea><img src=x onerror=1></textarea>', '<title><img src=x onerror=1></title>',
            '<script>/*</script ><img src=x onerror=1>*/', '<scrIPT >x</scrIPT >y', '<img\u000bsrc=x onerror=alert(1)>',
            '<svg onload=alert(1)>', '<iframe　src=//x>', '<script\u000b>alert(1)</script\u000b>', '<img src=x onerror=alert(1<2)>',
            '<img src=x onerror="alert(1<2)">', "<img src=x onerror=alert(1) x='<'>", '<img src=x onerror=alert(1) <>',
            '<a href="javascript:alert(1)" title="<">klik</a>', '<xss onmouseover=alert(1)>', '<nama onfocus=alert(1) autofocus>',
            '<X-Foo onclick=alert(1)>', '<x-foo onclick=alert(1)>', '<iframe srcdoc="<script>alert(1)</script>">', '<math><mtext><img src=x onerror=1>',
            '<b<a href=x>>', '<form action=//evil><input name=x>', '<base href=//evil/>', '<meta http-equiv=refresh content="0;url=//evil">',
            'Aplikasi <e-Office>', 'Lampiran <PP-24/1997>', 'Lihat <Sub-Bagian TU>', 'Kode <A-1> dan <B_2>', 'Undangan <Rapat Koordinasi>',
            'Budi <budi@contoh.go.id>', 'a < b > c', 'nilai p<q', 'teks <img', 'a <b dan c', 'nilai x <y dan z = 5',
            'Tautan <http://contoh.go.id/berkas?nomor=1> terlampir', '<https://contoh.go.id/a/b?x=1&y=2>', '<Rapat Online>', '<nama>',
            '<e-Office>', '<Lampiran 1>', '<x onfocus autofocus>', "<x title='a>b' onclick=alert(1)>klik", '<x title="a>b" onclick=alert(1)>klik',
            '<x onclick=alert(1)', `<x ${'a=1 '.repeat(100)}onclick=alert(1)>`, '<x a="1"onclick=alert(1)>', '<x a=1/onclick=alert(1)>',
        ];
        expect(kasus.flatMap(periksa)).toEqual([]);
    }, 120_000);

    it('acakan token dengan benih tetap', () => {
        const token = ['<', '<', '<', '<', '>', '>', '/', '/', '=', '"', "'", ' ', '\n', '\u000b', ' ', '\u0000', 'img', 'x', 'b', 'a',
            'script', 'svg', 'on', 'onerror', 'onfocus', 'x-y', 'X-Y', '<!--', '-->', '1', '!', '?', 'v', '</', '<b>', '<x a=1>', 'style',
            '<1', '=a', '`', '&', 'é', '\t', '\r', 'alert(1)', 'autofocus', 'iframe', 'src'];
        for (const benih of [777, 12345]) {
            const rnd = acak(benih);
            const galat: string[] = [];
            for (let i = 0; i < 15_000 && galat.length < 10; i += 1) {
                let teks = '';
                const panjang = 2 + rnd(16);
                for (let j = 0; j < panjang; j += 1) teks += token[rnd(token.length)];
                galat.push(...periksa(teks));
            }
            expect(galat).toEqual([]);
        }
    }, 120_000);

    it('kombinasi terstruktur awalan, nama, sisipan, atribut, dan akhiran', () => {
        const awalan = ['', 'teks ', '<', '<!--'];
        const nama = ['img', 'IMG', 'x', 'X-Y', 'x-y', 'svg', 'a', 'nama', 'e-Office', 'script', 'iframe', 'x\u0000', 'img\u0000', 'é'];
        const sisipan = ['', ' ', '/', '/ ', '//', '\n', '\u000b', '\f', '/=a ', "/'a' ", '<1 ', '<1/', '<!-- ', ' ', '<', ' / ',
            '/\t', '"', "'", '=', '<<1 ', '\u0000 ', '/"x" ', '<?', '<!'];
        const atribut = ['onfocus=alert(1) autofocus tabindex=1', "src=x onerror='alert(1)'", 'onfocus=a<b', 'x=">" onfocus=alert(1)', "x='<' onfocus=1"];
        const akhiran = ['>', '/>', '', '<', '"', '<b>'];
        const galat: string[] = [];
        for (const a of awalan) for (const n of nama) for (const s of sisipan) for (const t of atribut) for (const z of akhiran) {
            if (galat.length < 10) galat.push(...periksa(`${a}<${n}${s}${t}${z}`));
        }
        expect(galat).toEqual([]);
    }, 120_000);
});
