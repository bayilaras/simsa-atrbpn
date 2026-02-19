CREATE TABLE "preservasi_track" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arsip_elektronik_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"details" text,
	"performed_by" uuid,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "approval_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_id" uuid,
	"user_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"current_step_order" integer DEFAULT 1 NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"requester_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_id" uuid,
	"role" varchar(50),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"action_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digital_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"certificate_id" varchar(255),
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"qr_code_content" text,
	"visual_page" integer,
	"visual_x" integer,
	"visual_y" integer,
	"document_hash" varchar(255),
	"signature_value" text,
	"is_valid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "is_deleted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "is_deleted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "approval_status" varchar(50) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "current_approver_id" uuid;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "is_signed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "media_type" varchar(50) DEFAULT 'kertas';--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "person_in_charge" varchar(255);--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "unit_pengolah" varchar(255);--> statement-breakpoint
ALTER TABLE "preservasi_track" ADD CONSTRAINT "preservasi_track_arsip_elektronik_id_arsip_elektronik_id_fk" FOREIGN KEY ("arsip_elektronik_id") REFERENCES "public"."arsip_elektronik"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preservasi_track" ADD CONSTRAINT "preservasi_track_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_entity_id_surat_keluar_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."surat_keluar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_entity_id_surat_keluar_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."surat_keluar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_masuk" ADD CONSTRAINT "surat_masuk_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD CONSTRAINT "surat_keluar_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surat_keluar" ADD CONSTRAINT "surat_keluar_current_approver_id_users_id_fk" FOREIGN KEY ("current_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;