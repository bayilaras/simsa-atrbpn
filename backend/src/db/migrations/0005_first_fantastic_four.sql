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