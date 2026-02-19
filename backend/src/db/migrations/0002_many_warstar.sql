CREATE TABLE "dosir" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"kode" varchar(50) NOT NULL,
	"judul" varchar(500) NOT NULL,
	"deskripsi" text,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"kategori" varchar(100),
	"tanggal_mulai" date,
	"tanggal_selesai" date,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dosir_surat_keluar" (
	"dosir_id" uuid NOT NULL,
	"surat_keluar_id" uuid NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "dosir_surat_keluar_dosir_id_surat_keluar_id_pk" PRIMARY KEY("dosir_id","surat_keluar_id")
);
--> statement-breakpoint
CREATE TABLE "dosir_surat_masuk" (
	"dosir_id" uuid NOT NULL,
	"surat_masuk_id" uuid NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "dosir_surat_masuk_dosir_id_surat_masuk_id_pk" PRIMARY KEY("dosir_id","surat_masuk_id")
);
--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "keterangan" text;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "link_dokumen" text;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "file_original_name" varchar(255);--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "klasifikasi_kode" varchar(50);--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "klasifikasi_uraian" text;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "file_original_name" varchar(255);--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "ocr_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "ocr_processed_at" timestamp;--> statement-breakpoint
ALTER TABLE "dosir" ADD CONSTRAINT "dosir_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosir" ADD CONSTRAINT "dosir_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosir_surat_keluar" ADD CONSTRAINT "dosir_surat_keluar_dosir_id_dosir_id_fk" FOREIGN KEY ("dosir_id") REFERENCES "public"."dosir"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosir_surat_keluar" ADD CONSTRAINT "dosir_surat_keluar_surat_keluar_id_surat_keluar_id_fk" FOREIGN KEY ("surat_keluar_id") REFERENCES "public"."surat_keluar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosir_surat_masuk" ADD CONSTRAINT "dosir_surat_masuk_dosir_id_dosir_id_fk" FOREIGN KEY ("dosir_id") REFERENCES "public"."dosir"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosir_surat_masuk" ADD CONSTRAINT "dosir_surat_masuk_surat_masuk_id_surat_masuk_id_fk" FOREIGN KEY ("surat_masuk_id") REFERENCES "public"."surat_masuk"("id") ON DELETE cascade ON UPDATE no action;