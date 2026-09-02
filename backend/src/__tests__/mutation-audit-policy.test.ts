import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(process.cwd(), 'src');

function tsFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return tsFiles(absolute);
        return entry.isFile() && entry.name.endsWith('.ts') ? [absolute] : [];
    });
}

function relative(file: string): string {
    return path.relative(sourceRoot, file).replaceAll('\\', '/');
}

describe('mutation audit architecture policy', () => {
    it('keeps best-effort audit calls out of protected routes', () => {
        const occurrences = tsFiles(path.join(sourceRoot, 'routes'))
            .filter((file) => fs.readFileSync(file, 'utf8').includes('auditLogService.logAction('))
            .map(relative)
            .sort();

        expect(occurrences).toEqual([]);

        for (const file of [
            'routes/file-access.routes.ts',
            'routes/regulatory-rule-set.routes.ts',
        ]) {
            const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
            expect(source).toContain("action: download ? 'download' : 'view'");
            expect(source).toContain('auditLogService.logActionOrThrow(');
        }
    });

    it('keeps critical mutation groups on transactional fail-closed audit paths', () => {
        const transactionalServices = [
            'services/arsip.service.ts',
            'services/surat-masuk.service.ts',
            'services/surat-keluar.service.ts',
            'services/penyusutan.service.ts',
            'services/distribution.service.ts',
            'services/record-access-grant.service.ts',
            'services/arsip-elektronik.service.ts',
            'services/archive-lending.service.ts',
            'services/dosir.service.ts',
            'services/storage-location.service.ts',
            'services/user-management.service.ts',
            'services/settings.service.ts',
            'services/tunjuk-silang.service.ts',
            'services/layanan-arsip.service.ts',
            'services/arsip-vital.service.ts',
            'services/arsip-terjaga.service.ts',
            'services/file-attachment.service.ts',
        ];

        for (const file of transactionalServices) {
            const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
            expect(source, `${file} must own a DB transaction`).toContain('db.transaction');
            expect(source, `${file} must persist critical audit inside that transaction`)
                .toContain('logActionOrThrow');
        }
    });

    it('prevents import adapters from bypassing canonical transactional services', () => {
        for (const file of [
            'services/google-drive-import.service.ts',
            'services/migration.service.ts',
        ]) {
            const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
            expect(source).toContain('suratMasukService.create');
            expect(source).toContain('suratKeluarService.create');
            expect(source).not.toMatch(/db\.insert\((suratMasuk|suratKeluar)/);
        }
        const migration = fs.readFileSync(
            path.join(sourceRoot, 'services/migration.service.ts'),
            'utf8',
        );
        expect(migration).toContain('arsipService.create');
        expect(migration).not.toContain('db.insert(arsipTable)');
    });
});
