import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Pesan galat yang sampai ke staf harus berbahasa Indonesia. `error` berbahasa
// Inggris boleh tetap ada sebagai label tetap bagi klien lama, asalkan respons
// yang sama membawa `message` berbahasa Indonesia (frontend mendahulukan
// `message`). Status 401 dijawab frontend dengan pesannya sendiri.

const sourceRoot = path.resolve(process.cwd(), 'src');
const KATA_INGGRIS = /\b(not found|required|Failed|Invalid|already|must|cannot|Cannot|Forbidden|denied|Only|exists|expired|Unsupported|immutable|successfully|deleted|marked as read|Imported|Please|requires)\b/;

function tsFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : tsFiles(absolute);
        return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [absolute] : [];
    });
}

const files = ['routes', 'middlewares', 'services'].flatMap(dir => tsFiles(path.join(sourceRoot, dir)))
    .concat(path.join(sourceRoot, 'app.ts'))
    .map(file => ({ file: path.relative(sourceRoot, file).replaceAll('\\', '/'), text: fs.readFileSync(file, 'utf8') }));

function objekJson(text: string) {
    const hasil: Array<{ status: string; isi: string; baris: number }> = [];
    const pola = /(?:status\((\d{3})\)\s*\.)?json\(\s*\{/g;
    let cocok: RegExpExecArray | null;
    while ((cocok = pola.exec(text))) {
        const awal = cocok.index + cocok[0].length - 1;
        let kedalaman = 0;
        for (let i = awal; i < text.length; i++) {
            if (text[i] === '{') kedalaman++;
            else if (text[i] === '}' && --kedalaman === 0) {
                hasil.push({ status: cocok[1] ?? '', isi: text.slice(awal, i + 1), baris: text.slice(0, cocok.index).split('\n').length });
                break;
            }
        }
    }
    return hasil;
}

describe('teks galat untuk staf', () => {
    it('respons JSON dengan error berbahasa Inggris membawa message berbahasa Indonesia', () => {
        const pelanggaran: string[] = [];
        for (const { file, text } of files) {
            for (const { status, isi, baris } of objekJson(text)) {
                if (status === '401') continue;
                const error = isi.match(/\berror\s*:\s*['`]([^'`]*)['`]/)?.[1];
                const message = isi.match(/\bmessage\s*:\s*['`]([^'`]*)['`]/)?.[1];
                if (message !== undefined && KATA_INGGRIS.test(message)) pelanggaran.push(`${file}:${baris} message "${message}"`);
                if (error !== undefined && KATA_INGGRIS.test(error) && !/\bmessage\s*:/.test(isi)) pelanggaran.push(`${file}:${baris} error "${error}"`);
            }
        }
        expect(pelanggaran).toEqual([]);
    });

    it('galat terklasifikasi (4xx) dari layanan dan rute tidak berbahasa Inggris', () => {
        const pelanggaran: string[] = [];
        const pola = /new (AppError|ValidationError|NotFoundError|ConflictError|ForbiddenError|GoneError|PayloadTooLargeError|BulkUploadError)\(\s*(['`])((?:\\.|(?!\2).)*)\2/g;
        for (const { file, text } of files) {
            for (const cocok of text.matchAll(pola)) {
                if (KATA_INGGRIS.test(cocok[3])) pelanggaran.push(`${file}: ${cocok[1]}("${cocok[3]}")`);
            }
        }
        expect(pelanggaran).toEqual([]);
    });
});
