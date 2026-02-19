
import { db } from '../src/config/database';
import { penyusutanService } from '../src/services/penyusutan.service';
import { penyusutanArsip, arsip, unitKerja, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

async function testWorkflow() {
    console.log('Starting Notification Workflow Test...');

    try {
        const arsipId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const unitKerjaId = 'test-unit-workflow';

        // 0. Setup: Create dummy unit kerja & user
        console.log('Creating dummy unit kerja...');
        await db.insert(unitKerja).values({
            id: unitKerjaId,
            name: 'Test Unit Workflow',
            unitType: 'bagian'
        }).onConflictDoNothing();

        console.log('Creating dummy user...');
        await db.insert(users).values({
            id: userId,
            email: 'test-workflow@example.com',
            name: 'Test Workflow User',
            role: 'admin_unit_kerja',
            unitKerjaId: unitKerjaId,
            isActive: true
        } as any).onConflictDoNothing();

        // 1. Setup: Create a dummy arsip and a draft batch
        console.log('Creating dummy arsip...');
        const [newArsip] = await db.insert(arsip).values({
            unitKerjaId: unitKerjaId,
            kodeKlasifikasi: 'HM.01',
            uraianBerkas: 'Test Arsip for Workflow',
            tahun: 2020,
            jenisArsip: 'Tekstual',
            kualitasArsip: 'Baik',
            jumlah: 1,
            satuanJml: 'Berkas',
            penciptaArsip: 'Test Unit',
            lokasiRuang: 'R.01',
            status: 'inaktif',
            retensiAktif: 2,
            retensiInaktif: 2,
            hasilAkhir: 'musnah',
            tanggalKadaluarsa: '2024-01-01',
        } as any).returning();

        console.log('Arsip created:', newArsip.id);

        console.log('Creating draft batch...');
        const batch = await penyusutanService.create({
            unitKerjaId: unitKerjaId,
            jenisPenyusutan: 'pemusnahan',
            nomorBA: 'BA/TEST/001',
            keterangan: 'Test Workflow',
            arsipIds: [newArsip.id],
            createdBy: userId
        });
        console.log('Batch created:', batch.id);

        // 2. Test Transition: Draft -> Proposed (Success)
        console.log('Testing Draft -> Proposed (Success)...');
        await penyusutanService.updateStatus(batch.id, {
            user: { id: userId, role: 'admin_unit_kerja', unitKerjaId: unitKerjaId }
        });
        console.log('Draft -> Proposed: OK');

        // 3. Test Transition: Proposed -> Reviewed (Fail - Insufficient Role)
        console.log('Testing Proposed -> Reviewed (Fail Expected)...');
        try {
            await penyusutanService.updateStatus(batch.id, {
                user: { id: crypto.randomUUID(), role: 'admin_unit_kerja', unitKerjaId: unitKerjaId }
            });
            console.error('Proposed -> Reviewed: FAILED (Should have thrown error)');
        } catch (e: any) {
            console.log('Proposed -> Reviewed: OK (Caught expected error:', e.message, ')');
        }

        // 4. Test Transition: Proposed -> Reviewed (Success)
        console.log('Testing Proposed -> Reviewed (Success)...');
        await penyusutanService.updateStatus(batch.id, {
            user: { id: userId, role: 'admin_dirjen', unitKerjaId: 'unit-pusat' } // Mocking higher role for same user or different user
        });
        console.log('Proposed -> Reviewed: OK');

        // 5. Cleanup
        console.log('Cleaning up...');
        await penyusutanService.deleteBatch(batch.id); // This might fail if status not draft, actually deleteBatch checks logic.
        // Direct DB delete for cleanup
        await db.delete(penyusutanArsip).where(eq(penyusutanArsip.id, batch.id));
        await db.delete(arsip).where(eq(arsip.id, newArsip.id));
        await db.delete(users).where(eq(users.id, userId));
        await db.delete(unitKerja).where(eq(unitKerja.id, unitKerjaId));
        console.log('Cleanup complete.');

    } catch (error) {
        console.error('Test failed:', error);
    }
}

testWorkflow()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
