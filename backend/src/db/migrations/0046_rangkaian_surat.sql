-- 0046: Rangkaian Surat. Keanggotaan disimpan di tabel terpisah sehingga
-- surat_masuk hanya mendapat index ekspresi dan surat_keluar satu kolom
-- opsional asal_naskah (bukan kolom yang dijaga trigger 0021).
-- Precheck fail-closed (pola 0012/0021): data harus direkonsiliasi operator,
-- migrasi tidak pernah mengubahnya diam-diam.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM surat_distributions
        WHERE status IS NULL OR status NOT IN ('sent', 'received', 'processed', 'rejected')
    ) THEN
        RAISE EXCEPTION '0046: status surat_distributions tidak dikenal, rekonsiliasi dulu'
            USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM surat_distributions
        WHERE status <> 'rejected'
        GROUP BY surat_masuk_id, target_unit_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION '0046: distribusi aktif ganda (surat,target), rekonsiliasi dulu'
            USING ERRCODE = '23505';
    END IF;
END $$;
--> statement-breakpoint
-- D5: pengawas ditentukan unit, bukan role. Hanya super_admin yang mengubahnya.
ALTER TABLE unit_kerja ADD COLUMN is_unit_pengawas boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE unit_kerja
SET is_unit_pengawas = true, updated_at = now()
WHERE id IN ('ditjen', 'sesditjen') AND is_unit_pengawas IS DISTINCT FROM true;
--> statement-breakpoint
-- Instalasi baru: seed deployment membuat ditjen/sesditjen SESUDAH migrasi.
-- Trigger ini hanya memberi nilai awal saat baris dibuat; perubahan
-- berikutnya tetap lewat pengaturan unit kerja oleh super_admin.
CREATE OR REPLACE FUNCTION unit_kerja_default_pengawas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IN ('ditjen', 'sesditjen') THEN
        NEW.is_unit_pengawas := true;
    END IF;
    RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION unit_kerja_default_pengawas() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS unit_kerja_default_pengawas ON unit_kerja;
--> statement-breakpoint
CREATE TRIGGER unit_kerja_default_pengawas
BEFORE INSERT ON unit_kerja
FOR EACH ROW EXECUTE FUNCTION unit_kerja_default_pengawas();
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS rangkaian_surat_kode_seq;
--> statement-breakpoint
CREATE TABLE rangkaian_surat (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode varchar(30) NOT NULL CONSTRAINT rangkaian_surat_kode_key UNIQUE,
    asal varchar(20) NOT NULL CONSTRAINT rangkaian_surat_asal_check
        CHECK (asal IN ('surat_masuk', 'inisiatif', 'data_lama')),
    status varchar(20) NOT NULL DEFAULT 'aktif' CONSTRAINT rangkaian_surat_status_check
        CHECK (status IN ('aktif', 'selesai', 'diberkaskan', 'digabung')),
    unit_pencatat_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
    unit_pengolah_id varchar(50) REFERENCES unit_kerja(id),
    judul text NOT NULL,
    tahun integer NOT NULL,
    klasifikasi_item_id integer REFERENCES klasifikasi_arsip(id) ON DELETE RESTRICT,
    lanjutan_dari_id uuid REFERENCES rangkaian_surat(id),
    digabung_ke_id uuid REFERENCES rangkaian_surat(id),
    selesai_at timestamptz,
    selesai_by uuid REFERENCES users(id),
    catatan_selesai text,
    selesai_manual boolean NOT NULL DEFAULT false,
    diberkaskan_at timestamptz,
    diberkaskan_by uuid REFERENCES users(id),
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rangkaian_berkas_check CHECK (
        status <> 'diberkaskan' OR (
            unit_pengolah_id IS NOT NULL
            AND klasifikasi_item_id IS NOT NULL
            AND diberkaskan_at IS NOT NULL
            AND diberkaskan_by IS NOT NULL
        )
    ),
    CONSTRAINT rangkaian_gabung_check CHECK (
        (status = 'digabung') = (digabung_ke_id IS NOT NULL)
        AND digabung_ke_id IS DISTINCT FROM id
    ),
    CONSTRAINT rangkaian_selesai_manual_check CHECK (
        NOT selesai_manual
        OR (selesai_by IS NOT NULL AND coalesce(length(trim(catatan_selesai)), 0) >= 10)
    )
);
--> statement-breakpoint
CREATE INDEX rangkaian_surat_pengolah_status_idx ON rangkaian_surat (unit_pengolah_id, status);
--> statement-breakpoint
CREATE TABLE rangkaian_anggota (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
    surat_masuk_id uuid REFERENCES surat_masuk(id),
    surat_keluar_id uuid REFERENCES surat_keluar(id),
    -- Snapshot pemilik rekaman; tidak pernah berubah (dijaga trigger 0046).
    unit_kerja_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
    peran varchar(10) NOT NULL DEFAULT 'anggota' CONSTRAINT rangkaian_anggota_peran_check
        CHECK (peran IN ('induk', 'anggota')),
    sumber varchar(15) NOT NULL DEFAULT 'aplikasi' CONSTRAINT rangkaian_anggota_sumber_check
        CHECK (sumber IN ('aplikasi', 'tautan', 'gabung', 'data_lama')),
    ditambahkan_by uuid REFERENCES users(id),
    ditambahkan_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rangkaian_anggota_satu_surat_check
        CHECK (num_nonnulls(surat_masuk_id, surat_keluar_id) = 1),
    CONSTRAINT rangkaian_anggota_rangkaian_member_key UNIQUE (rangkaian_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_anggota_sm_uidx ON rangkaian_anggota (surat_masuk_id) WHERE surat_masuk_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_anggota_sk_uidx ON rangkaian_anggota (surat_keluar_id) WHERE surat_keluar_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_anggota_induk_uidx ON rangkaian_anggota (rangkaian_id) WHERE peran = 'induk';
--> statement-breakpoint
CREATE INDEX rangkaian_anggota_unit_idx ON rangkaian_anggota (unit_kerja_id, rangkaian_id);
--> statement-breakpoint
CREATE TABLE rangkaian_relasi (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL,
    dari_anggota_id uuid NOT NULL,
    ke_anggota_id uuid NOT NULL,
    jenis_relasi varchar(20) NOT NULL CONSTRAINT rangkaian_relasi_jenis_check
        CHECK (jenis_relasi IN ('balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk')),
    keterangan text,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    cancelled_by uuid REFERENCES users(id),
    cancellation_reason text,
    CONSTRAINT rangkaian_relasi_dari_fk FOREIGN KEY (rangkaian_id, dari_anggota_id)
        REFERENCES rangkaian_anggota (rangkaian_id, id) ON UPDATE CASCADE,
    CONSTRAINT rangkaian_relasi_ke_fk FOREIGN KEY (rangkaian_id, ke_anggota_id)
        REFERENCES rangkaian_anggota (rangkaian_id, id) ON UPDATE CASCADE,
    CONSTRAINT rangkaian_relasi_bukan_diri_check CHECK (dari_anggota_id <> ke_anggota_id),
    -- Pola 0012:22: alasan NULL ditolak karena coalesce(...) = 0.
    CONSTRAINT rangkaian_relasi_pembatalan_check CHECK (
        (cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR (
            cancelled_at IS NOT NULL
            AND cancelled_by IS NOT NULL
            AND coalesce(length(trim(cancellation_reason)), 0) >= 10
        )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_relasi_active_uidx ON rangkaian_relasi (dari_anggota_id, ke_anggota_id, jenis_relasi) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX rangkaian_relasi_ke_idx ON rangkaian_relasi (ke_anggota_id) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX rangkaian_relasi_rangkaian_idx ON rangkaian_relasi (rangkaian_id);
--> statement-breakpoint
-- Peserta eksplisit HANYA untuk data lama (P5); dapat dicabut dengan jejak.
CREATE TABLE rangkaian_peserta (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
    unit_kerja_id varchar(50) NOT NULL REFERENCES unit_kerja(id),
    peran varchar(20) NOT NULL CONSTRAINT rangkaian_peserta_peran_check
        CHECK (peran IN ('disposisi_lama')),
    label_asal text,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    berakhir_at timestamptz,
    berakhir_by uuid REFERENCES users(id),
    alasan_berakhir text,
    CONSTRAINT rangkaian_peserta_berakhir_check CHECK (
        berakhir_at IS NULL OR (
            berakhir_by IS NOT NULL
            AND coalesce(length(trim(alasan_berakhir)), 0) >= 10
        )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX rangkaian_peserta_active_uidx ON rangkaian_peserta (rangkaian_id, unit_kerja_id, peran) WHERE berakhir_at IS NULL;
--> statement-breakpoint
-- Koreksi berkas yang sudah diberkaskan (maker-checker, spesifikasi §9).
CREATE TABLE rangkaian_koreksi_berkas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rangkaian_id uuid NOT NULL REFERENCES rangkaian_surat(id),
    unit_pengolah_lama varchar(50) NOT NULL,
    unit_pengolah_baru varchar(50) NOT NULL REFERENCES unit_kerja(id),
    klasifikasi_lama integer NOT NULL,
    klasifikasi_baru integer NOT NULL REFERENCES klasifikasi_arsip(id),
    alasan text NOT NULL CONSTRAINT rangkaian_koreksi_alasan_check
        CHECK (coalesce(length(trim(alasan)), 0) >= 10),
    status varchar(15) NOT NULL DEFAULT 'pending' CONSTRAINT rangkaian_koreksi_status_check
        CHECK (status IN ('pending', 'approved', 'denied', 'applied')),
    diajukan_by uuid NOT NULL REFERENCES users(id),
    diajukan_at timestamptz NOT NULL DEFAULT now(),
    diputuskan_by uuid REFERENCES users(id),
    diputuskan_at timestamptz,
    CONSTRAINT rangkaian_koreksi_maker_checker_check
        CHECK (diputuskan_by IS NULL OR diputuskan_by <> diajukan_by)
);
--> statement-breakpoint
CREATE TABLE disposisi_label_unit (
    label_norm varchar(100) PRIMARY KEY,
    unit_kerja_id varchar(50) REFERENCES unit_kerja(id),
    perlu_verifikasi boolean NOT NULL DEFAULT false,
    catatan text
);
--> statement-breakpoint
ALTER TABLE surat_distributions
    ADD COLUMN rangkaian_id uuid REFERENCES rangkaian_surat(id),
    ADD COLUMN batas_waktu date,
    ADD COLUMN penanggung_jawab boolean NOT NULL DEFAULT false,
    ADD COLUMN processed_by uuid REFERENCES users(id),
    ADD COLUMN penyelesaian_surat_keluar_id uuid REFERENCES surat_keluar(id),
    ADD COLUMN catatan_penyelesaian text,
    ADD COLUMN ditutup_pengawas boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE surat_distributions ADD CONSTRAINT surat_distributions_status_check
    CHECK (status IN ('sent', 'received', 'processed', 'rejected'));
--> statement-breakpoint
CREATE UNIQUE INDEX surat_distributions_active_target_uidx ON surat_distributions (surat_masuk_id, target_unit_id) WHERE status <> 'rejected';
--> statement-breakpoint
CREATE INDEX surat_distributions_target_status_idx ON surat_distributions (target_unit_id, status);
--> statement-breakpoint
CREATE INDEX surat_distributions_rangkaian_idx ON surat_distributions (rangkaian_id, target_unit_id) WHERE rangkaian_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE surat_keluar ADD COLUMN asal_naskah varchar(15)
    CONSTRAINT surat_keluar_asal_naskah_check
    CHECK (asal_naskah IS NULL OR asal_naskah IN ('inisiatif', 'tindak_lanjut'));
--> statement-breakpoint
-- Hanya menyentuh kolom yang tidak dijaga 0021; baris terarsip tetap konsisten.
UPDATE surat_keluar SET asal_naskah = 'tindak_lanjut'
WHERE balasan_untuk IS NOT NULL AND asal_naskah IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_surat_keluar_balasan ON surat_keluar (balasan_untuk) WHERE balasan_untuk IS NOT NULL;
--> statement-breakpoint
-- Ekspresi HARUS identik dengan nomorNormSql() di backend/src/utils/nomor-surat.ts.
CREATE INDEX surat_masuk_nomor_norm_idx ON surat_masuk ((lower(regexp_replace(coalesce(nomor_surat, ''), '[^0-9A-Za-z]+', '', 'g'))) text_pattern_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_nomor_norm_idx ON surat_keluar ((lower(regexp_replace(coalesce(nomor_surat, ''), '[^0-9A-Za-z]+', '', 'g'))) text_pattern_ops);
--> statement-breakpoint
-- Default privileges memberi DELETE ke runtime; tabel berkas ini append-only
-- bagi aplikasi sejak migrasi (grants/0002 mengulanginya saat konvergensi).
REVOKE DELETE ON TABLE
    rangkaian_surat,
    rangkaian_anggota,
    rangkaian_relasi,
    rangkaian_peserta,
    rangkaian_koreksi_berkas
    FROM simsa_api_runtime;
