import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

const { supervisionService } = await import('../services/supervision.service');

const PETUGAS = '10000000-0000-4000-8000-0000000009d1';
const PEMBACA = '10000000-0000-4000-8000-0000000009d2';

describe('Pengguna Paling Aktif', () => {
    let database: PGlite;

    beforeAll(async () => {
        database = new PGlite();
        for (const table of [schema.users, schema.auditLog]) {
            const config = getTableConfig(table);
            const columns = config.columns.map(column => [
                `"${column.name}" ${column.getSQLType()}`,
                column.primary ? 'PRIMARY KEY' : '',
                column.name === 'id' ? 'DEFAULT gen_random_uuid()' : '',
                ['created_at', 'updated_at'].includes(column.name) ? 'DEFAULT now()' : '',
            ].filter(Boolean).join(' ')).join(', ');
            await database.exec(`CREATE TABLE "${config.name}" (${columns})`);
        }
        await database.query(`INSERT INTO users (id, email, name) VALUES ($1, 'petugas@example.test', 'Petugas Arsip'), ($2, 'pembaca@example.test', 'Pembaca Surat')`, [PETUGAS, PEMBACA]);
        const tulis = (userId: string | null, action: string, times: number) => database.query(
            `INSERT INTO audit_log (user_id, user_email, action, entity_type) SELECT $1, 'x@example.test', $2, 'user' FROM generate_series(1, $3)`,
            [userId, action, times],
        );
        // Signing in and out many times is not work in the application.
        await tulis(PEMBACA, 'sign_in', 20);
        await tulis(PEMBACA, 'sign_out', 20);
        await tulis(PEMBACA, 'change_password', 3);
        await tulis(PEMBACA, 'view', 1);
        await tulis(PETUGAS, 'update', 3);
        // Failed sign-ins carry no user.
        await tulis(null, 'sign_in_failed', 50);
        await tulis(null, 'create', 10);
        holder.db = drizzle(database, { schema });
    });

    afterAll(async () => {
        holder.db = null;
        await database?.close();
    });

    it('menghitung pekerjaan di aplikasi saja, tanpa masuk/keluar dan tanpa baris tanpa pengguna', async () => {
        await expect(supervisionService.getUserActivityStats(5)).resolves.toEqual([
            { userId: PETUGAS, userName: 'Petugas Arsip', userEmail: 'petugas@example.test', actionCount: 3 },
            { userId: PEMBACA, userName: 'Pembaca Surat', userEmail: 'pembaca@example.test', actionCount: 1 },
        ]);
    });
});
