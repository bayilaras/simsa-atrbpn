import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AKSES, KONTRAK_RUTE, TANPA_SESI, type EntriKontrak } from './kontrak-rute.data';

// Setiap handler HTTP tercatat bersama mekanisme aksesnya. Rute baru tanpa
// entri, entri yang tertinggal setelah rute dihapus, atau `lewat` yang tidak
// lagi dipanggil handler menggagalkan tes ini.

const sourceRoot = path.resolve(process.cwd(), 'src');
const VERB = 'get|post|put|patch|delete|all';

interface Rute {
    kunci: string;
    teks: string;
    bersesi: boolean;
}

function bacaRute(berkas: string, objek: 'router' | 'app'): Rute[] {
    const isi = fs.readFileSync(path.join(sourceRoot, berkas), 'utf8');
    const alias = [...isi.matchAll(/\bauthMiddleware\s+as\s+(\w+)/g)].map((m) => m[1]);
    const namaSesi = new RegExp(`\\b(${['authMiddleware', ...alias].join('|')})\\b`);

    // Pernyataan tingkat atas yang dimulai di awal baris: registrasi dan use.
    const pernyataan = [...isi.matchAll(new RegExp(`^[ \\t]*${objek}\\.(${VERB}|use)\\(`, 'gm'))];
    const rute: Rute[] = [];
    let sesiGlobal = false;
    pernyataan.forEach((m, i) => {
        const akhir = i + 1 < pernyataan.length ? pernyataan[i + 1].index! : isi.length;
        const teks = isi.slice(m.index!, akhir);
        const kepala = teks.includes('=>') ? teks.slice(0, teks.indexOf('=>')) : teks;
        if (m[1] === 'use') {
            // Hanya use tanpa path yang berlaku untuk semua rute sesudahnya.
            if (!/^\s*\w+\.use\(\s*['"`]/.test(teks) && namaSesi.test(kepala)) sesiGlobal = true;
            return;
        }
        const jalur = /^[^(]*\(\s*(['"`])(.*?)\1/s.exec(teks);
        if (!jalur) throw new Error(`${berkas}: path rute bukan literal: ${teks.slice(0, 80)}`);
        rute.push({
            kunci: `${m[1].toUpperCase()} ${jalur[2]}`,
            teks,
            bersesi: sesiGlobal || namaSesi.test(kepala),
        });
    });
    return rute;
}

const berkasRute = fs.readdirSync(path.join(sourceRoot, 'routes'))
    .filter((nama) => nama.endsWith('.ts'))
    .sort();

const semua: Record<string, Rute[]> = {
    'app.ts': bacaRute('app.ts', 'app'),
    ...Object.fromEntries(berkasRute.map((nama) => [nama, bacaRute(`routes/${nama}`, 'router')])),
};

function daftarKunci(sumber: Record<string, Rute[]>) {
    return Object.fromEntries(Object.entries(sumber)
        .filter(([, rute]) => rute.length > 0)
        .map(([berkas, rute]) => [berkas, rute.map((r) => r.kunci).sort()]));
}

function entriDari(entri: EntriKontrak | (typeof AKSES)[number]): EntriKontrak {
    return typeof entri === 'string' ? { akses: entri } : entri;
}

describe('kontrak rute', () => {
    it('registrasi hanya lewat router.<verb>/app.<verb> di awal baris dengan satu router per berkas', () => {
        for (const nama of berkasRute) {
            const isi = fs.readFileSync(path.join(sourceRoot, 'routes', nama), 'utf8');
            const namaRouter = [...isi.matchAll(/(\w+)\s*=\s*(?:express\.)?Router\(/g)].map((m) => m[1]);
            expect(namaRouter.filter((v) => v !== 'router'), `${nama}: router dengan nama lain`).toEqual([]);
            expect((isi.match(/\bRouter\(/g) ?? []).length, `${nama}: lebih dari satu router`).toBeLessThanOrEqual(1);
            expect(isi, `${nama}: router.route() tidak dibaca kontrak`).not.toMatch(/\brouter\s*\.\s*route\(/);
            expect((isi.match(new RegExp(`\\brouter\\s*\\.\\s*(${VERB})\\(`, 'g')) ?? []).length, `${nama}: registrasi tidak di awal baris`)
                .toBe((isi.match(new RegExp(`^[ \\t]*router\\.(${VERB})\\(`, 'gm')) ?? []).length);
        }
        const app = fs.readFileSync(path.join(sourceRoot, 'app.ts'), 'utf8');
        expect((app.match(new RegExp(`\\bapp\\.(${VERB})\\(`, 'g')) ?? []).length)
            .toBe((app.match(new RegExp(`^[ \\t]*app\\.(${VERB})\\(`, 'gm')) ?? []).length);
    });

    it('setiap rute tercatat dan setiap entri masih punya rute', () => {
        const kontrak = Object.fromEntries(Object.entries(KONTRAK_RUTE)
            .map(([berkas, entri]) => [berkas, Object.keys(entri).sort()]));
        expect(kontrak).toEqual(daftarKunci(semua));
    });

    it('mekanisme dikenal dan `lewat` dipanggil di handler', () => {
        for (const [berkas, daftar] of Object.entries(KONTRAK_RUTE)) {
            for (const [kunci, mentah] of Object.entries(daftar)) {
                const { akses, lewat } = entriDari(mentah);
                const label = `${berkas} ${kunci}`;
                expect(AKSES, label).toContain(akses);
                if (akses === 'proyeksi' || akses === 'checkRead' || akses === 'check') {
                    expect(lewat, `${label}: ${akses} wajib menyebut lewat`).toBeTruthy();
                }
                if (akses === 'bukan-rekaman') expect(lewat, label).toBeUndefined();
                if (lewat) {
                    const rute = semua[berkas]?.find((r) => r.kunci === kunci);
                    expect(rute?.teks, `${label}: lewat "${lewat}" tidak ada di handler`).toContain(lewat);
                }
            }
        }
    });

    it('rute tanpa sesi hanya yang tercatat', () => {
        const tanpaSesi = Object.fromEntries(Object.entries(semua)
            .map(([berkas, rute]) => [berkas, rute.filter((r) => !r.bersesi)])
            .filter(([, rute]) => rute.length > 0));
        expect(Object.fromEntries(Object.entries(TANPA_SESI)
            .map(([berkas, entri]) => [berkas, Object.keys(entri).sort()])))
            .toEqual(daftarKunci(tanpaSesi as Record<string, Rute[]>));
    });
});
