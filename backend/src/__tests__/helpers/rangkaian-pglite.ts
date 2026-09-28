import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { enterTestMigratorRole } from './database-role-fixture';
import { applyMigrationTag, assertStopBeforeDikenal, journalEntries } from './rangkaian-p5-pglite.js';

/** Rantai migrasi penuh sesuai urutan journal (termasuk 0048+), atau berhenti sebelum `stopBefore`. */
export async function bootRangkaianDatabase(options: { stopBefore?: string } = {}): Promise<PGlite> {
    assertStopBeforeDikenal(options.stopBefore);
    const database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    for (const entry of journalEntries) {
        if (entry.tag === options.stopBefore) break;
        await applyMigrationTag(database, entry.tag);
    }
    return database;
}

export const USER_ID = {
    superAdmin: '10000000-0000-4000-8000-000000000001',
    tu: '10000000-0000-4000-8000-000000000002',
    bppt: '10000000-0000-4000-8000-000000000003',
    ptep: '10000000-0000-4000-8000-000000000004',
    staffSes: '10000000-0000-4000-8000-000000000005',
    adminSesNull: '10000000-0000-4000-8000-000000000006',
    plp: '10000000-0000-4000-8000-000000000007',
    auditorSes: '10000000-0000-4000-8000-000000000008',
    approver: '10000000-0000-4000-8000-000000000009',
} as const;

export const PENGGUNA = {
    superAdmin: { id: USER_ID.superAdmin, role: 'super_admin', unitKerjaId: null },
    tu: { id: USER_ID.tu, role: 'admin_unit', unitKerjaId: 'sesditjen' },
    bppt: { id: USER_ID.bppt, role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: USER_ID.ptep, role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    staffSes: { id: USER_ID.staffSes, role: 'staff', unitKerjaId: 'sesditjen' },
    adminSesNull: { id: USER_ID.adminSesNull, role: 'admin_sesditjen', unitKerjaId: null },
    plp: { id: USER_ID.plp, role: 'admin_unit', unitKerjaId: 'dir_plp' },
    auditorSes: { id: USER_ID.auditorSes, role: 'auditor', unitKerjaId: 'sesditjen' },
} as const;

export const SURAT = {
    smBiasa: '30000000-0000-4000-8000-000000000001',
    smTerbatas: '30000000-0000-4000-8000-000000000002',
    smTunggal: '30000000-0000-4000-8000-000000000003',
    smBagian: '30000000-0000-4000-8000-000000000004',
    skBpptBiasa: '40000000-0000-4000-8000-000000000001',
    skBpptNull: '40000000-0000-4000-8000-000000000002',
    skPtepBiasa: '40000000-0000-4000-8000-000000000003',
    skBpptTunggal: '40000000-0000-4000-8000-000000000004',
    // Catatan: id surat_keluar/surat_masuk khusus satu tes (mis. anggota
    // tambahan yang disisipkan ad hoc lewat database.exec) SENGAJA TIDAK
    // ditaruh di sini. record-access-check.snapshot.integration.test.ts
    // meng-enumerate Object.entries(SURAT) untuk snapshot karakterisasi
    // check() yang dibekukan (dilarang -u); menambah kunci di sini
    // menambah baris baru ke snapshot itu dan membuatnya merah. Taruh id
    // semacam itu sebagai konstanta lokal pada berkas tes yang memakainya.
} as const;

export const ARSIP_TERBATAS = '60000000-0000-4000-8000-000000000001';

export const RANGKAIAN = {
    rs1: '50000000-0000-4000-8000-000000000001',
    rs2: '50000000-0000-4000-8000-000000000002',
    rs3Digabung: '50000000-0000-4000-8000-000000000003',
    rs4Lanjutan: '50000000-0000-4000-8000-000000000004',
    rsBesar: '50000000-0000-4000-8000-000000000005',
    rsBagianUmum: '50000000-0000-4000-8000-000000000006',
    rsRantaiA: '50000000-0000-4000-8000-000000000007',
    rsRantaiB: '50000000-0000-4000-8000-000000000008',
    rsRantaiC: '50000000-0000-4000-8000-000000000009',
} as const;

export const ANGGOTA = {
    rs1Sm: '51000000-0000-4000-8000-000000000001',
    rs1SkBiasa: '51000000-0000-4000-8000-000000000002',
    rs1SkNull: '51000000-0000-4000-8000-000000000003',
    rs2Sm: '51000000-0000-4000-8000-000000000004',
    rs2SkPtep: '51000000-0000-4000-8000-000000000005',
    rsBagianUmumInduk: '51000000-0000-4000-8000-000000000006',
    rsBagianUmumSk: '51000000-0000-4000-8000-000000000007',
    rs2SkRahasia: '51000000-0000-4000-8000-000000000008',
} as const;

export const DISPOSISI = {
    rs1Bppt: '52000000-0000-4000-8000-000000000001',
    rs1Ptep: '52000000-0000-4000-8000-000000000002',
    rs2Ptep: '52000000-0000-4000-8000-000000000003',
    rs2Ditolak: '52000000-0000-4000-8000-000000000004',
    rs2Selesai: '52000000-0000-4000-8000-000000000005',
} as const;

export const GRANT = {
    ptepSmTerbatas: '53000000-0000-4000-8000-000000000001',
    bpptSmTerbatas: '53000000-0000-4000-8000-000000000002',
    tuSkBpptNull: '53000000-0000-4000-8000-000000000003',
    adminSesSalahUnit: '53000000-0000-4000-8000-000000000004',
    tuArsip: '53000000-0000-4000-8000-000000000005',
    tuSmTerbatasKadaluarsa: '53000000-0000-4000-8000-000000000006',
} as const;

/** Teks yang TIDAK boleh muncul pada respons untuk pembaca yang node-nya tersamar. */
export const RAHASIA = {
    perihalSmTerbatas: 'Perihal SM rahasia terbatas',
    nomorSmTerbatas: 'SM-2/RHS/2026',
    instruksiRs2: 'Instruksi rahasia untuk PTEP',
    keteranganRs2: 'Tanggapan atas surat terbatas',
    perihalSkNull: 'ND BPPT klasifikasi lama',
    nomorSkNull: 'ND-2/BPPT/2026',
    keteranganSkNull: 'Keterangan relasi rahasia',
    alasanTolakRs2: 'Alasan penolakan rahasia PTEP 2026',
    catatanSelesaiRs2: 'Catatan penyelesaian rahasia PTEP 2026',
    perihalSkRahasiaRs2: 'ND rahasia PTEP tanpa grant',
    nomorSkRahasiaRs2: 'ND-9/PTEP/2026',
    tanggalSkRahasiaRs2: '2031-07-19',
} as const;

function grantRow(id: string, user: string, type: string, entity: string, unit: string, purpose: string, mode: string, decidedAt: string, expiresAt: string): string {
    return `('${id}','${user}','${user}','${type}','${entity}','${unit}','terbatas','${purpose}','${mode}','approved','${USER_ID.approver}','${decidedAt}','Kebutuhan kerja terverifikasi','${expiresAt}')`;
}

export async function seedRangkaianFixture(database: PGlite): Promise<void> {
    await database.exec(`
        TRUNCATE rangkaian_relasi, rangkaian_peserta, rangkaian_anggota, surat_distributions, rangkaian_surat,
            record_access_grants, audit_log, arsip, surat_keluar, surat_masuk, users, unit_kerja CASCADE;
        INSERT INTO unit_kerja (id, name, is_unit_pengawas) VALUES
            ('ditjen','Direktorat Jenderal',true), ('sesditjen','Sekretariat Ditjen',true),
            ('dir_bppt','Dit. BPPT',false), ('dir_ptep','Dit. PTEP',false),
            ('dir_plp','Dit. PLP',false), ('bagian_umum','Bagian Umum',false);
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES
            ('${USER_ID.superAdmin}','super@example.test','super_admin',NULL),
            ('${USER_ID.tu}','tu@example.test','admin_unit','sesditjen'),
            ('${USER_ID.bppt}','bppt@example.test','admin_unit','dir_bppt'),
            ('${USER_ID.ptep}','ptep@example.test','admin_unit','dir_ptep'),
            ('${USER_ID.staffSes}','staff@example.test','staff','sesditjen'),
            -- DB baris ini WAJIB unit_kerja_id='sesditjen' (constraint
            -- users_role_unit_mandate_check, migrasi 0027). Objek in-memory
            -- PENGGUNA.adminSesNull tetap unitKerjaId: null -- itulah yang
            -- benar-benar dipakai check()/findActiveGrant, bukan baris ini.
            ('${USER_ID.adminSesNull}','sesditjen@example.test','admin_sesditjen','sesditjen'),
            ('${USER_ID.plp}','plp@example.test','admin_unit','dir_plp'),
            ('${USER_ID.auditorSes}','auditor@example.test','auditor','sesditjen'),
            ('${USER_ID.approver}','approver@example.test','super_admin',NULL);
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat) VALUES
            ('${SURAT.smBiasa}','sesditjen',1,2026,'Sangat Segera','SM-1/2026','Permohonan data pertanahan','Kanwil A','2026-09-01'),
            ('${SURAT.smTerbatas}','sesditjen',2,2026,'Terbatas','${RAHASIA.nomorSmTerbatas}','${RAHASIA.perihalSmTerbatas}','Kanwil B','2026-09-02'),
            ('${SURAT.smTunggal}','sesditjen',3,2026,'biasa','SM-3/2026','Surat tunggal TU','Kanwil C','2026-09-03'),
            ('${SURAT.smBagian}','bagian_umum',1,2026,'biasa','SM-4/2026','Surat bagian umum','Kanwil D','2026-09-04');
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat) VALUES
            ('${SURAT.skBpptBiasa}','dir_bppt',1,2026,'biasa','ND-1/BPPT/2026','Tindak lanjut permohonan data','Sesditjen','Nota Dinas','2026-09-05'),
            ('${SURAT.skBpptNull}','dir_bppt',2,2026,NULL,'${RAHASIA.nomorSkNull}','${RAHASIA.perihalSkNull}','Sesditjen','Nota Dinas','2026-09-06'),
            ('${SURAT.skPtepBiasa}','dir_ptep',1,2026,'biasa','ND-1/PTEP/2026','Tanggapan PTEP','Sesditjen','Nota Dinas','2026-09-07'),
            ('${SURAT.skBpptTunggal}','dir_bppt',3,2026,'biasa','ND-3/BPPT/2026','Surat inisiatif BPPT','Kanwil','Nota Dinas','2026-09-08');
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan)
            VALUES ('${ARSIP_TERBATAS}','sesditjen','masuk',2026,'terbatas','Arsip terbatas TU');
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun) VALUES
            ('${RANGKAIAN.rs1}','RS-2026-000001','surat_masuk','aktif','sesditjen','dir_bppt','Permohonan data pertanahan',2026),
            ('${RANGKAIAN.rs2}','RS-2026-000002','surat_masuk','aktif','sesditjen',NULL,'${RAHASIA.perihalSmTerbatas}',2026);
        INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_at) VALUES
            ('${ANGGOTA.rs1Sm}','${RANGKAIAN.rs1}','${SURAT.smBiasa}',NULL,'sesditjen','induk','aplikasi','2026-09-01T01:00:00Z'),
            ('${ANGGOTA.rs1SkBiasa}','${RANGKAIAN.rs1}',NULL,'${SURAT.skBpptBiasa}','dir_bppt','anggota','aplikasi','2026-09-05T01:00:00Z'),
            ('${ANGGOTA.rs1SkNull}','${RANGKAIAN.rs1}',NULL,'${SURAT.skBpptNull}','dir_bppt','anggota','aplikasi','2026-09-06T01:00:00Z'),
            ('${ANGGOTA.rs2Sm}','${RANGKAIAN.rs2}','${SURAT.smTerbatas}',NULL,'sesditjen','induk','aplikasi','2026-09-02T01:00:00Z'),
            ('${ANGGOTA.rs2SkPtep}','${RANGKAIAN.rs2}',NULL,'${SURAT.skPtepBiasa}','dir_ptep','anggota','aplikasi','2026-09-07T01:00:00Z');
        INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi, keterangan) VALUES
            ('${RANGKAIAN.rs1}','${ANGGOTA.rs1SkBiasa}','${ANGGOTA.rs1Sm}','tindak_lanjut','Menindaklanjuti permohonan'),
            ('${RANGKAIAN.rs1}','${ANGGOTA.rs1SkNull}','${ANGGOTA.rs1Sm}','menjelaskan','${RAHASIA.keteranganSkNull}'),
            ('${RANGKAIAN.rs2}','${ANGGOTA.rs2SkPtep}','${ANGGOTA.rs2Sm}','tindak_lanjut','${RAHASIA.keteranganRs2}');
        INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, instruction, status, rejection_reason, rangkaian_id, penanggung_jawab, batas_waktu) VALUES
            ('${DISPOSISI.rs1Bppt}','${SURAT.smBiasa}','sesditjen','dir_bppt','Mohon ditindaklanjuti','received',NULL,'${RANGKAIAN.rs1}',true,'2026-09-30'),
            ('${DISPOSISI.rs1Ptep}','${SURAT.smBiasa}','sesditjen','dir_ptep','Untuk diketahui','rejected','Bukan kewenangan PTEP','${RANGKAIAN.rs1}',false,NULL),
            ('${DISPOSISI.rs2Ptep}','${SURAT.smTerbatas}','sesditjen','dir_ptep','${RAHASIA.instruksiRs2}','sent',NULL,'${RANGKAIAN.rs2}',true,'2026-10-01');
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at) VALUES
            ${grantRow(GRANT.ptepSmTerbatas, USER_ID.ptep, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Tindak lanjut disposisi surat terbatas', 'view', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.bpptSmTerbatas, USER_ID.bppt, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Permintaan baca tanpa jangkauan rangkaian', 'view', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.tuSkBpptNull, USER_ID.tu, 'surat_keluar', SURAT.skBpptNull, 'dir_bppt', 'Pengawasan tindak lanjut direktorat BPPT', 'manage', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.adminSesSalahUnit, USER_ID.adminSesNull, 'surat_keluar', SURAT.skBpptNull, 'dir_ptep', 'Grant terikat unit lama yang sudah pindah', 'view', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z')},
            ${grantRow(GRANT.tuSmTerbatasKadaluarsa, USER_ID.tu, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Grant lama yang sudah kedaluwarsa', 'view', '2025-12-01T00:00:00Z', '2026-01-01T00:00:00Z')};
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at) VALUES
            ('${GRANT.tuArsip}','${USER_ID.tu}','${USER_ID.tu}','arsip','${ARSIP_TERBATAS}','sesditjen','terbatas','Koreksi metadata arsip terbatas TU','manage','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z');
    `);
}
