CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"image" text,
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"unit_kerja_id" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_kerja" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"drive_folder_id" varchar(255),
	"drive_upload_folder_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surat_masuk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"no_urut" integer NOT NULL,
	"tahun" integer NOT NULL,
	"jenis_surat" varchar(100),
	"sifat_surat" varchar(50),
	"nomor_surat" varchar(255),
	"tanggal_surat" date,
	"perihal" text,
	"dari" varchar(255),
	"kepada" varchar(255),
	"status" varchar(50) DEFAULT 'belum_dibalas',
	"disposisi" text,
	"is_archived" boolean DEFAULT false,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surat_keluar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"no_urut" integer NOT NULL,
	"tahun" integer NOT NULL,
	"naskah_dinas" varchar(100),
	"nomor_surat" varchar(255),
	"tanggal_surat" date,
	"perihal" text,
	"kepada" varchar(255),
	"link_dokumen" text,
	"balasan_untuk" uuid,
	"klasifikasi_fasilitatif_kode" varchar(50),
	"klasifikasi_fasilitatif" text,
	"klasifikasi_substantif_kode" varchar(50),
	"klasifikasi_substantif" text,
	"is_archived" boolean DEFAULT false,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arsip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"jenis_arsip" varchar(20) NOT NULL,
	"source_surat_id" uuid,
	"tahun" integer NOT NULL,
	"nomor_berkas" varchar(100),
	"kode_klasifikasi" varchar(50),
	"uraian_berkas" text,
	"nomor_item" varchar(100),
	"uraian_item" text,
	"tingkat_perkembangan" varchar(50),
	"tanggal_arsip" date,
	"kurun_waktu" varchar(100),
	"jumlah" integer,
	"lokasi_fc" varchar(50),
	"lokasi_laci" varchar(50),
	"lokasi_folder" varchar(50),
	"masa_simpan_aktif" varchar(50),
	"masa_simpan_inaktif" varchar(50),
	"hasil_akhir" varchar(50),
	"klasifikasi_keamanan" varchar(100),
	"keterangan" text,
	"jra_kode" varchar(50),
	"jra_uraian" text,
	"retensi_aktif" varchar(50),
	"retensi_inaktif" varchar(50),
	"retensi_keterangan" text,
	"nomor_surat_original" varchar(255),
	"tanggal_surat_original" date,
	"perihal_original" text,
	"tanggal_kadaluarsa" date,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" varchar(255),
	"file_url" text,
	"drive_file_id" varchar(255),
	"mime_type" varchar(100),
	"size_bytes" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" varchar(255),
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"changes" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jadwal_retensi_arsip" (
	"id" serial PRIMARY KEY NOT NULL,
	"kode" varchar(50) NOT NULL,
	"uraian" text NOT NULL,
	"retensi_aktif" varchar(150),
	"retensi_inaktif" varchar(150),
	"keterangan" text,
	"kategori" varchar(100),
	"parent_kode" varchar(50),
	"tipe" varchar(20) NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "jadwal_retensi_arsip_kode_unique" UNIQUE("kode")
);
--> statement-breakpoint
CREATE TABLE "klasifikasi_arsip" (
	"id" serial PRIMARY KEY NOT NULL,
	"kode" varchar(50) NOT NULL,
	"jenis" text NOT NULL,
	"keterangan" text,
	"kategori" varchar(100),
	"parent_kode" varchar(50),
	"tipe" varchar(20) NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "klasifikasi_arsip_kode_unique" UNIQUE("kode")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD CONSTRAINT "surat_keluar_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD CONSTRAINT "surat_keluar_balasan_untuk_surat_masuk_id_fk" FOREIGN KEY ("balasan_untuk") REFERENCES "public"."surat_masuk"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD CONSTRAINT "surat_keluar_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip" ADD CONSTRAINT "arsip_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip" ADD CONSTRAINT "arsip_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;