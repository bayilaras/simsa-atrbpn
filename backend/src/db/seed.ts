import { db } from '../config/database';
import { unitKerja } from '../db/schema';
import { seedKlasifikasiArsip } from './seed-klasifikasi';
import { seedJadwalRetensiArsip } from './seed-jra';
import { seedKlasifikasiJraMapping } from './seed-mapping';

async function seed() {
    console.log('🌱 Seeding database...');

    // Seed Unit Kerja
    console.log('Seeding unit_kerja...');
    await db.insert(unitKerja).values([
        {
            id: 'dirjen',
            name: 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan',
            description: 'Dirjen PTPP',
            driveFolderId: '1AQThU5U82bb7PqLfNyLHU-bbXoWuqb-k',
            driveUploadFolderId: '1s6h9YbNJE5Ig9jOXwEmt2udisOkKxRyA',
        },
        {
            id: 'sesditjen',
            name: 'Sekretariat Direktorat Jenderal',
            description: 'SesDitjen',
            driveFolderId: '1Bm_yBCzd4Y0XUk-JxgX9GfMFkJ2uBSIN',
            driveUploadFolderId: '1C3oAbKDfiGZcJPYyjMHQC3j8mMmpI0gK',
        },
    ]).onConflictDoNothing();

    // Seed Klasifikasi Arsip (Permen ATR/BPN No. 10 Tahun 2018)
    await seedKlasifikasiArsip();

    // Seed Jadwal Retensi Arsip (Permen ATR/BPN No. 8 Tahun 2020)
    await seedJadwalRetensiArsip();

    // Seed Klasifikasi-JRA Mapping (pemetaan tematik)
    await seedKlasifikasiJraMapping();

    console.log('✅ Seeding complete!');
    process.exit(0);
}

seed().catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
});
