import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: '10000000-0000-4000-8000-000000000a01', email: 'staf@example.test', role: 'staff', unitKerjaId: 'dir_bppt' };
        next();
    },
}));

const { default: unitKerjaRoutes } = await import('../routes/unit-kerja.routes');

describe('GET /api/unit-kerja', () => {
    let database: PGlite;
    const app = express();
    app.use('/api/unit-kerja', unitKerjaRoutes);

    beforeAll(async () => {
        database = new PGlite();
        const config = getTableConfig(schema.unitKerja);
        const columns = config.columns.map((column) => [
            `"${column.name}" ${column.getSQLType()}`,
            column.primary ? 'PRIMARY KEY' : '',
            column.notNull && !column.primary ? 'NOT NULL' : '',
            column.hasDefault && ['created_at', 'updated_at'].includes(column.name) ? 'DEFAULT now()' : '',
            column.name === 'is_unit_pengawas' ? 'DEFAULT false' : '',
        ].filter(Boolean).join(' ')).join(', ');
        await database.exec(`CREATE TABLE "${config.name}" (${columns})`);
        await database.query(`
            INSERT INTO unit_kerja (id, name, drive_folder_id, drive_upload_folder_id)
            VALUES ('dir_bppt', 'Direktorat Bina Pengadaan', 'folder-lama-sintetis', 'unggah-lama-sintetis')
        `);
        holder.db = drizzle(database, { schema });
    });

    afterAll(async () => {
        holder.db = null;
        await database?.close();
    });

    it('lists units without the legacy Drive folder columns', async () => {
        const response = await request(app).get('/api/unit-kerja').expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(1);
        const [unit] = response.body.data;
        expect(unit).toMatchObject({ id: 'dir_bppt', name: 'Direktorat Bina Pengadaan', isUnitPengawas: false });
        expect(Object.keys(unit).sort()).toEqual([
            'canReceiveDistribution', 'createdAt', 'description', 'id', 'isUnitPengawas', 'name', 'parentId', 'unitType', 'updatedAt',
        ]);
        expect(unit).not.toHaveProperty('driveFolderId');
        expect(unit).not.toHaveProperty('driveUploadFolderId');
        expect(JSON.stringify(response.body)).not.toContain('lama-sintetis');
    });
});
