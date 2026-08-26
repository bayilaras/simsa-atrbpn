-- Resume guard for databases that already recorded the historic, truncated
-- 0004 migration. Those databases skip the repaired 0004 file, so recreate the
-- three tables represented by the 0004 snapshot before this migration first
-- alters arsip_elektronik. Every statement is safe when the tables came from
-- the repaired 0004 migration or an earlier db:push.

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

CREATE TABLE "autentikasi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomor_berita_acara" varchar(100) NOT NULL,
	"tanggal_autentikasi" date NOT NULL,
	"tempat_dilakukan" varchar(150) DEFAULT 'Kantor Pertanahan',
	"dilakukan_oleh" uuid,
	"jabatan_penanda_tangan" varchar(100),
	"kegiatan" varchar(255) NOT NULL,
	"jumlah_arsip" integer NOT NULL,
	"file_lampiran" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layanan_arsip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jenis_layanan" varchar(30) NOT NULL,
	"arsip_id" uuid NOT NULL,
	"jumlah_rangkap" integer DEFAULT 1,
	"keperluan" text NOT NULL,
	"keterangan" text,
	"status" varchar(20) DEFAULT 'diajukan' NOT NULL,
	"disetujui_oleh" uuid,
	"tanggal_persetujuan" timestamp,
	"catatan_persetujuan" text,
	"diajukan_oleh" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" varchar(255) NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arsip_elektronik" ADD COLUMN "algoritma_hash" varchar(20) DEFAULT 'SHA-256';--> statement-breakpoint
ALTER TABLE "arsip_elektronik" ADD COLUMN "waktu_pembuatan_hash" timestamp;--> statement-breakpoint
ALTER TABLE "arsip_elektronik" ADD COLUMN "autentikasi_id" uuid;--> statement-breakpoint
ALTER TABLE "autentikasi" ADD CONSTRAINT "autentikasi_dilakukan_oleh_users_id_fk" FOREIGN KEY ("dilakukan_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layanan_arsip" ADD CONSTRAINT "layanan_arsip_arsip_id_arsip_id_fk" FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layanan_arsip" ADD CONSTRAINT "layanan_arsip_disetujui_oleh_users_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layanan_arsip" ADD CONSTRAINT "layanan_arsip_diajukan_oleh_users_id_fk" FOREIGN KEY ("diajukan_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_elektronik" ADD CONSTRAINT "arsip_elektronik_autentikasi_id_autentikasi_id_fk" FOREIGN KEY ("autentikasi_id") REFERENCES "public"."autentikasi"("id") ON DELETE no action ON UPDATE no action;
