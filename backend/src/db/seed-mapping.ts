import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from '../config/database.js';
import {
    JRA_RULE_SET_2020_ID,
    KLASIFIKASI_RULE_SET_2018_ID,
    klasifikasiJraMapping,
} from './schema/index.js';

// Data pemetaan tematik antara Klasifikasi Arsip (Permen ATR/BPN 10/2018)
// dan Jadwal Retensi Arsip (Permen ATR/BPN 8/2020)
// Mapping berdasarkan kesamaan area/tema, bukan kode langsung

const MAPPING_DATA = [
    // === FASILITATIF ===
    { klasifikasiPrefix: 'KU', jraPrefix: 'F.I', tema: 'Keuangan', keterangan: 'Pemetaan area keuangan: anggaran, perbendaharaan, verifikasi, PNBP, BMN', isActive: true },
    { klasifikasiPrefix: 'KP', jraPrefix: 'F.II', tema: 'Kepegawaian', keterangan: 'Pemetaan area kepegawaian: formasi, pengadaan, pembinaan karier, mutasi, disiplin', isActive: true },
    { klasifikasiPrefix: 'PR', jraPrefix: 'F.III', tema: 'Perencanaan', keterangan: 'Pemetaan area perencanaan: RPJP, RPJM, Renstra, RKP, program & anggaran', isActive: true },
    { klasifikasiPrefix: 'HK', jraPrefix: 'F.IV', tema: 'Hukum', keterangan: 'Pemetaan area hukum: peraturan, litigasi, bantuan hukum, advokasi', isActive: true },
    { klasifikasiPrefix: 'OT', jraPrefix: 'F.V', tema: 'Organisasi dan Tata Laksana', keterangan: 'Pemetaan area organisasi: kelembagaan, tata laksana, reformasi birokrasi', isActive: true },
    { klasifikasiPrefix: 'TU', jraPrefix: 'F.VII', tema: 'Ketatausahaan', keterangan: 'Pemetaan area tata usaha: persuratan, keprotokolan, kerumahtanggaan', isActive: true },
    { klasifikasiPrefix: 'TU.02', jraPrefix: 'F.VI', tema: 'Kearsipan', keterangan: 'Pemetaan area kearsipan: pengelolaan arsip, penyimpanan, pemusnahan', isActive: true },
    { klasifikasiPrefix: 'HM', jraPrefix: 'F.VIII', tema: 'Hubungan Masyarakat', keterangan: 'Pemetaan area humas: pelayanan informasi, publikasi, hubungan media', isActive: true },
    { klasifikasiPrefix: 'PW', jraPrefix: 'F.XI', tema: 'Pengawasan', keterangan: 'Pemetaan area pengawasan: audit internal, inspeksi, reviu, evaluasi', isActive: true },
    { klasifikasiPrefix: 'PL', jraPrefix: 'F.XII', tema: 'Perlengkapan', keterangan: 'Pemetaan area perlengkapan: pengadaan barang/jasa, inventarisasi', isActive: true },
    { klasifikasiPrefix: 'DL', jraPrefix: 'F.XIII', tema: 'Pendidikan dan Pelatihan', keterangan: 'Pemetaan area diklat: perencanaan diklat, pelaksanaan, evaluasi', isActive: true },
    { klasifikasiPrefix: 'LB', jraPrefix: 'F.XIV', tema: 'Penelitian dan Pengembangan', keterangan: 'Pemetaan area litbang: riset, pengembangan, studi', isActive: true },
    { klasifikasiPrefix: 'DI', jraPrefix: 'F.X', tema: 'Informatika/Sistem Informasi', keterangan: 'Pemetaan area data & info: sistem informasi, TIK, database', isActive: true },

    // === SUBSTANTIF ===
    // S.II Tata Ruang
    { klasifikasiPrefix: 'TR', jraPrefix: 'S.II', tema: 'Tata Ruang', keterangan: 'Pemetaan area tata ruang: perencanaan, pemanfaatan, pengendalian ruang', isActive: true },
    { klasifikasiPrefix: 'PF', jraPrefix: 'S.II', tema: 'Pemanfaatan Ruang', keterangan: 'Pemetaan area pemanfaatan ruang ke tata ruang JRA', isActive: true },
    { klasifikasiPrefix: 'PK', jraPrefix: 'S.II', tema: 'Penataan Kawasan', keterangan: 'Pemetaan area penataan kawasan ke tata ruang JRA', isActive: true },
    { klasifikasiPrefix: 'PB', jraPrefix: 'S.II', tema: 'Pembinaan Tata Ruang', keterangan: 'Pemetaan area pembinaan tata ruang daerah ke tata ruang JRA', isActive: true },

    // S.III Infrastruktur Keagrariaan
    { klasifikasiPrefix: 'PU', jraPrefix: 'S.III', tema: 'Pengukuran Dasar', keterangan: 'Pemetaan area pengukuran dasar ke infrastruktur keagrariaan', isActive: true },
    { klasifikasiPrefix: 'UK', jraPrefix: 'S.III', tema: 'Pengukuran Kadastral', keterangan: 'Pemetaan area pengukuran kadastral ke infrastruktur keagrariaan', isActive: true },
    { klasifikasiPrefix: 'ST', jraPrefix: 'S.III', tema: 'Survei Tematik', keterangan: 'Pemetaan area survei tematik ke infrastruktur keagrariaan', isActive: true },

    // S.IV Hubungan Hukum Keagrariaan
    { klasifikasiPrefix: 'HT', jraPrefix: 'S.IV', tema: 'Hak Tanah', keterangan: 'Pemetaan area hak tanah: pendaftaran, penetapan hak, sertifikasi', isActive: true },
    { klasifikasiPrefix: 'HR', jraPrefix: 'S.IV', tema: 'Hubungan Hukum', keterangan: 'Pemetaan area hubungan hukum pertanahan ke hak tanah JRA', isActive: true },
    { klasifikasiPrefix: 'PH', jraPrefix: 'S.IV', tema: 'Pemberdayaan Hak', keterangan: 'Pemetaan area pemberdayaan hak masyarakat (S.IV.D)', isActive: true },

    // S.V Penataan Agraria
    { klasifikasiPrefix: 'PG', jraPrefix: 'S.V', tema: 'Penatagunaan Tanah', keterangan: 'Pemetaan area penatagunaan tanah (S.V.A)', isActive: true },
    { klasifikasiPrefix: 'PS', jraPrefix: 'S.V', tema: 'Pesisir & Pulau Kecil', keterangan: 'Pemetaan area pesisir (S.V.B WP3WT)', isActive: true },
    { klasifikasiPrefix: 'KT', jraPrefix: 'S.V', tema: 'Konsolidasi Tanah', keterangan: 'Pemetaan area konsolidasi tanah (S.V.C)', isActive: true },
    { klasifikasiPrefix: 'LR', jraPrefix: 'S.V', tema: 'Landreform', keterangan: 'Pemetaan area landreform (S.V.D)', isActive: true },

    // S.VI Pengadaan Tanah
    { klasifikasiPrefix: 'BP', jraPrefix: 'S.VI', tema: 'Pembinaan Pengadaan Tanah', keterangan: 'Pemetaan area pembinaan pengadaan tanah', isActive: true },
    { klasifikasiPrefix: 'PT', jraPrefix: 'S.VI', tema: 'Penilaian Tanah', keterangan: 'Pemetaan area penilaian tanah (S.VI.B)', isActive: true },
    { klasifikasiPrefix: 'TP', jraPrefix: 'S.VI', tema: 'Tanah Pemerintah', keterangan: 'Pemetaan area tanah pemerintah (S.VI.C)', isActive: true },

    // S.VII Pengendalian Pemanfaatan Ruang dan Penguasaan Tanah
    { klasifikasiPrefix: 'MR', jraPrefix: 'S.VII', tema: 'Pengendalian Pemanfaatan Ruang', keterangan: 'Pemetaan area pengendalian pemanfaatan ruang (S.VII.A)', isActive: true },
    { klasifikasiPrefix: 'PM', jraPrefix: 'S.VII', tema: 'Penertiban Ruang', keterangan: 'Pemetaan area penertiban pemanfaatan ruang (S.VII.B)', isActive: true },
    { klasifikasiPrefix: 'PP', jraPrefix: 'S.VII', tema: 'Pengendalian Pertanahan', keterangan: 'Pemetaan area pengendalian pertanahan', isActive: true },
    { klasifikasiPrefix: 'TL', jraPrefix: 'S.VII', tema: 'Tanah Terlantar', keterangan: 'Pemetaan area tanah terlantar (S.VII.C)', isActive: true },

    // S.VIII Penanganan Masalah Agraria
    { klasifikasiPrefix: 'SK', jraPrefix: 'S.VIII', tema: 'Sengketa dan Konflik', keterangan: 'Pemetaan area sengketa: penanganan sengketa, konflik, perkara pertanahan', isActive: true },
    { klasifikasiPrefix: 'PN', jraPrefix: 'S.VIII', tema: 'Penanganan Perkara', keterangan: 'Pemetaan area penanganan perkara ke sengketa & konflik JRA', isActive: true },
];

export async function seedKlasifikasiJraMapping() {
    console.log('Seeding klasifikasi-JRA mapping...');

    const batchSize = 50;
    for (let i = 0; i < MAPPING_DATA.length; i += batchSize) {
        const batch = MAPPING_DATA.slice(i, i + batchSize).map((mapping) => ({
            ...mapping,
            klasifikasiRuleSetId: KLASIFIKASI_RULE_SET_2018_ID,
            jraRuleSetId: JRA_RULE_SET_2020_ID,
        }));
        // Mappings are bound to an exact pair of legal editions. Existing
        // rows are retained verbatim so reruns cannot rewrite historical
        // recommendations; newly missing rows are added idempotently.
        await db
            .insert(klasifikasiJraMapping)
            .values(batch)
            .onConflictDoNothing();
        console.log(`  Processed ${Math.min(i + batchSize, MAPPING_DATA.length)}/${MAPPING_DATA.length} records`);
    }
    console.log(`Seeding mapping complete! Versioned definitions: ${MAPPING_DATA.length}`);
}

// ESM-compatible entry point
const isMain = Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
    seedKlasifikasiJraMapping()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('❌ Seeding mapping failed:', error);
            process.exit(1);
        });
}
