import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { classifyLacakQuery } from '../utils/nomor-surat';

vi.mock('../config/database', () => ({ db: null }));
vi.mock('../config/database.js', () => ({ db: null }));

const { skorSql } = await import('../services/rangkaian/lacak.service');

const SM = { jenis: 'surat_masuk', table: 'surat_masuk', alias: 'sm', pihak: 'sm.dari', anggotaCol: 'surat_masuk_id', naskah: 'NULL::text' } as const;
const dialect = new PgDialect();

function cocokNomor(q: string): { sql: string; params: unknown[] } {
    const s = skorSql(SM as never, classifyLacakQuery(q), 'lacak');
    if (!s) throw new Error('kueri tidak dapat dicocokkan');
    return dialect.sqlToQuery(s.cocok);
}

// P5 Task 14 (review I-2): tanpa index trigram 0049, setiap arm nomor di WHERE
// mengevaluasi regexp_replace per baris. Kesamaan dan prefix adalah himpunan
// bagian substring, jadi untuk qNorm >= 5 WHERE hanya boleh memuat SATU arm
// nomor (substring); untuk qNorm < 5 satu arm prefix (btree 0046), karena kesamaan
// adalah himpunan bagian prefix.
describe('predikat cocok nomor Lacak', () => {
    it('qNorm >= 5: hanya satu arm substring, satu regexp_replace per baris', () => {
        const { sql, params } = cocokNomor('B-12345/PTPP');
        expect(sql.match(/regexp_replace/g)).toHaveLength(1);
        expect(params).toContain('%b12345ptpp%');
        expect(params).not.toContain('b12345ptpp');
        expect(params).not.toContain('b12345ptpp%');
    });

    it('qNorm < 5: hanya satu arm prefix, tanpa substring', () => {
        const { sql, params } = cocokNomor('B-123');
        expect(sql.match(/regexp_replace/g)).toHaveLength(1);
        expect(params).toContain('b123%');
        expect(params).not.toContain('b123');
        expect(params).not.toContain('%b123%');
    });
});
