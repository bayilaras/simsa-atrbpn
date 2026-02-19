CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_kerja_id" varchar(50) NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"level" varchar(20) NOT NULL,
	"parent_id" uuid,
	"description" text,
	"capacity" integer,
	"current_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_lending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lending_type" varchar(20) NOT NULL,
	"arsip_id" uuid,
	"storage_location_id" uuid,
	"borrower_id" uuid NOT NULL,
	"borrower_name" varchar(255) NOT NULL,
	"department_unit" varchar(255),
	"borrow_date" date NOT NULL,
	"due_date" date NOT NULL,
	"return_date" date,
	"status" varchar(20) DEFAULT 'borrowed' NOT NULL,
	"purpose" text,
	"notes" text,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "lending_status" varchar(20) DEFAULT 'available';--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_unit_kerja_id_unit_kerja_id_fk" FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_lending" ADD CONSTRAINT "archive_lending_arsip_id_arsip_id_fk" FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_lending" ADD CONSTRAINT "archive_lending_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_lending" ADD CONSTRAINT "archive_lending_borrower_id_users_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_lending" ADD CONSTRAINT "archive_lending_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_lending" ADD CONSTRAINT "archive_lending_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arsip" ADD CONSTRAINT "arsip_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;