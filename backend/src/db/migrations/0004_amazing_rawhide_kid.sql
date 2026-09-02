-- Repair a historic journal/snapshot gap. The 0004 snapshot contains these
-- tables, but the generated SQL only retained the disposisi type change. Keep
-- the repair here (before 0005 first alters arsip_elektronik) and make it safe
-- when a production database already received the tables through db:push.

CREATE TABLE IF NOT EXISTS "arsip_elektronik" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arsip_id" uuid NOT NULL,
	"format_file" varchar(20) NOT NULL,
	"ukuran_file" integer,
	"hash_sha256" varchar(64),
	"resolusi_dpi" integer,
	"jumlah_halaman" integer,
	"media_asal" varchar(30) DEFAULT 'kertas',
	"media_tujuan" varchar(30) DEFAULT 'digital',
	"tanggal_digitalisasi" date,
	"didigitalisasi_oleh" uuid,
	"alat_digitalisasi" varchar(100),
	"software_digitalisasi" varchar(100),
	"status_verifikasi" varchar(20) DEFAULT 'pending' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp,
	"catatan_verifikasi" text,
	"tanda_tangan_digital" text,
	"versi_dokumen" integer DEFAULT 1 NOT NULL,
	"catatan_konversi" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tunjuk_silang" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_id" uuid NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"jenis_relasi" varchar(30) NOT NULL,
	"keterangan" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "klasifikasi_jra_mapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"klasifikasi_prefix" varchar(20) NOT NULL,
	"jra_prefix" varchar(20) NOT NULL,
	"tema" varchar(100) NOT NULL,
	"keterangan" text,
	"is_active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'arsip_elektronik_arsip_id_arsip_id_fk'
		  AND conrelid = 'public.arsip_elektronik'::regclass
	) THEN
		ALTER TABLE "arsip_elektronik"
			ADD CONSTRAINT "arsip_elektronik_arsip_id_arsip_id_fk"
			FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'arsip_elektronik_didigitalisasi_oleh_users_id_fk'
		  AND conrelid = 'public.arsip_elektronik'::regclass
	) THEN
		ALTER TABLE "arsip_elektronik"
			ADD CONSTRAINT "arsip_elektronik_didigitalisasi_oleh_users_id_fk"
			FOREIGN KEY ("didigitalisasi_oleh") REFERENCES "public"."users"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'arsip_elektronik_verified_by_users_id_fk'
		  AND conrelid = 'public.arsip_elektronik'::regclass
	) THEN
		ALTER TABLE "arsip_elektronik"
			ADD CONSTRAINT "arsip_elektronik_verified_by_users_id_fk"
			FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'tunjuk_silang_created_by_users_id_fk'
		  AND conrelid = 'public.tunjuk_silang'::regclass
	) THEN
		ALTER TABLE "tunjuk_silang"
			ADD CONSTRAINT "tunjuk_silang_created_by_users_id_fk"
			FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'surat_masuk'
		  AND column_name = 'disposisi'
		  AND data_type IN ('text', 'character varying', 'character')
	) THEN
		ALTER TABLE "surat_masuk"
			ALTER COLUMN "disposisi" SET DATA TYPE text[]
			USING CASE WHEN "disposisi" IS NULL THEN NULL ELSE ARRAY["disposisi"] END;
	END IF;
END $$;
