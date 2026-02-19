CREATE TABLE "surat_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"surat_masuk_id" uuid NOT NULL,
	"source_unit_id" varchar(50) NOT NULL,
	"target_unit_id" varchar(50) NOT NULL,
	"cc_units" text,
	"instruction" text,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"rejection_reason" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"received_at" timestamp,
	"processed_at" timestamp,
	"sent_by" uuid,
	"received_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "penyusutan_arsip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"nomor_ba" varchar(100),
	"jenis_penyusutan" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"tanggal_usul" date,
	"tanggal_review" date,
	"tanggal_persetujuan" date,
	"tanggal_pelaksanaan" date,
	"catatan_panitia" text,
	"total_berkas" integer DEFAULT 0,
	"total_volume" integer DEFAULT 0,
	"keterangan" text,
	"created_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "penyusutan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"penyusutan_id" uuid NOT NULL,
	"arsip_id" uuid NOT NULL,
	"nomor_urut" integer,
	"keterangan" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arsip_vital" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arsip_id" uuid NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"kategori_vital" varchar(30) NOT NULL,
	"tingkat_kekritisan" varchar(20) NOT NULL,
	"alasan_penetapan" text,
	"metode_proteksi" varchar(20),
	"lokasi_backup" varchar(255),
	"media_backup" varchar(100),
	"jadwal_backup" varchar(20),
	"tanggal_penetapan" date,
	"tanggal_review_selanjutnya" date,
	"status_proteksi" varchar(20) DEFAULT 'belum_diproteksi' NOT NULL,
	"penanggung_jawab" varchar(255),
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arsip_terjaga" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arsip_id" uuid NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"kategori_terjaga" varchar(30) NOT NULL,
	"dasar_hukum" text,
	"uraian_isi" text,
	"status_pelaporan" varchar(20) DEFAULT 'belum_dilaporkan' NOT NULL,
	"tanggal_pelaporan" date,
	"nomor_laporan_anri" varchar(100),
	"periode_pelaporan_hari" integer DEFAULT 365,
	"tanggal_penetapan" date,
	"tanggal_review_selanjutnya" date,
	"status_kepatuhan" varchar(20) DEFAULT 'belum_dinilai' NOT NULL,
	"catatan" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_kerja" ADD COLUMN "parent_id" varchar(50);--> statement-breakpoint
ALTER TABLE "unit_kerja" ADD COLUMN "unit_type" varchar(30);--> statement-breakpoint
ALTER TABLE "unit_kerja" ADD COLUMN "can_receive_distribution" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "disposal_status" varchar(30) DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "disposal_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "surat_distributions" ADD CONSTRAINT "surat_distributions_surat_masuk_id_surat_masuk_id_fk" FOREIGN KEY ("surat_masuk_id") REFERENCES "public"."surat_masuk"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_distributions" ADD CONSTRAINT "surat_distributions_source_unit_id_unit_kerja_id_fk" FOREIGN KEY ("source_unit_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_distributions" ADD CONSTRAINT "surat_distributions_target_unit_id_unit_kerja_id_fk" FOREIGN KEY ("target_unit_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_distributions" ADD CONSTRAINT "surat_distributions_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_distributions" ADD CONSTRAINT "surat_distributions_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penyusutan_arsip" ADD CONSTRAINT "penyusutan_arsip_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penyusutan_arsip" ADD CONSTRAINT "penyusutan_arsip_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penyusutan_arsip" ADD CONSTRAINT "penyusutan_arsip_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penyusutan_items" ADD CONSTRAINT "penyusutan_items_penyusutan_id_penyusutan_arsip_id_fk" FOREIGN KEY ("penyusutan_id") REFERENCES "public"."penyusutan_arsip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penyusutan_items" ADD CONSTRAINT "penyusutan_items_arsip_id_arsip_id_fk" FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_vital" ADD CONSTRAINT "arsip_vital_arsip_id_arsip_id_fk" FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_vital" ADD CONSTRAINT "arsip_vital_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_vital" ADD CONSTRAINT "arsip_vital_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_terjaga" ADD CONSTRAINT "arsip_terjaga_arsip_id_arsip_id_fk" FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_terjaga" ADD CONSTRAINT "arsip_terjaga_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip_terjaga" ADD CONSTRAINT "arsip_terjaga_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;