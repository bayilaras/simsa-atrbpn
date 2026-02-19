import { db } from '../../config/database';
import { unitKerja } from '../schema/unit-kerja';

const unitKerjaData = [
    // Ditjen (top level)
    {
        id: 'ditjen',
        name: 'Direktorat Jenderal',
        description: 'Direktorat Jenderal PTEP',
        parentId: null,
        unitType: 'ditjen',
        canReceiveDistribution: true,
    },
    // Sesditjen (reports to Ditjen)
    {
        id: 'sesditjen',
        name: 'Sekretariat Ditjen',
        description: 'Sekretariat Direktorat Jenderal',
        parentId: 'ditjen',
        unitType: 'sesditjen',
        canReceiveDistribution: true,
    },
    // Bagian di bawah Sesditjen (tidak bisa terima distribusi)
    {
        id: 'bagian_keuangan',
        name: 'Bagian Keuangan',
        description: 'Bagian Keuangan Sesditjen',
        parentId: 'sesditjen',
        unitType: 'bagian',
        canReceiveDistribution: false,
    },
    {
        id: 'bagian_kepegawaian',
        name: 'Bagian Kepegawaian',
        description: 'Bagian Kepegawaian Sesditjen',
        parentId: 'sesditjen',
        unitType: 'bagian',
        canReceiveDistribution: false,
    },
    {
        id: 'bagian_umum',
        name: 'Bagian Umum',
        description: 'Bagian Umum Sesditjen',
        parentId: 'sesditjen',
        unitType: 'bagian',
        canReceiveDistribution: false,
    },
    // Direktorat Teknis (reports to Ditjen)
    {
        id: 'dir_bppt',
        name: 'Direktorat BPPT',
        description: 'Direktorat Bina Pengembangan dan Pemanfaatan Tanah',
        parentId: 'ditjen',
        unitType: 'direktorat',
        canReceiveDistribution: true,
    },
    {
        id: 'dir_ptep',
        name: 'Direktorat PTEP',
        description: 'Direktorat Pengadaan Tanah untuk Kepentingan Pembangunan',
        parentId: 'ditjen',
        unitType: 'direktorat',
        canReceiveDistribution: true,
    },
    {
        id: 'dir_ktpp',
        name: 'Direktorat KTPP',
        description: 'Direktorat Konsolidasi Tanah dan Pengembangan Pertanahan',
        parentId: 'ditjen',
        unitType: 'direktorat',
        canReceiveDistribution: true,
    },
    {
        id: 'dir_plp',
        name: 'Direktorat PLP',
        description: 'Direktorat Pengendalian dan Penggunaan Tanah',
        parentId: 'ditjen',
        unitType: 'direktorat',
        canReceiveDistribution: true,
    },
];

async function seedUnitKerja() {
    console.log('🌱 Seeding unit_kerja data...');

    try {
        for (const unit of unitKerjaData) {
            // Upsert: insert or update if exists
            await db
                .insert(unitKerja)
                .values(unit)
                .onConflictDoUpdate({
                    target: unitKerja.id,
                    set: {
                        name: unit.name,
                        description: unit.description,
                        parentId: unit.parentId,
                        unitType: unit.unitType,
                        canReceiveDistribution: unit.canReceiveDistribution,
                        updatedAt: new Date(),
                    },
                });
            console.log(`  ✓ ${unit.id}: ${unit.name}`);
        }

        console.log('\n✅ Unit kerja seeded successfully!');
        console.log('\nHierarchy:');
        console.log('  ditjen (Direktorat Jenderal)');
        console.log('  ├── sesditjen (Sekretariat Ditjen)');
        console.log('  │   ├── bagian_keuangan (no distribution)');
        console.log('  │   ├── bagian_kepegawaian (no distribution)');
        console.log('  │   └── bagian_umum (no distribution)');
        console.log('  ├── dir_bppt (Direktorat BPPT)');
        console.log('  ├── dir_ptep (Direktorat PTEP)');
        console.log('  ├── dir_ktpp (Direktorat KTPP)');
        console.log('  └── dir_plp (Direktorat PLP)');

    } catch (error) {
        console.error('❌ Error seeding unit_kerja:', error);
        process.exit(1);
    }

    process.exit(0);
}

seedUnitKerja();
