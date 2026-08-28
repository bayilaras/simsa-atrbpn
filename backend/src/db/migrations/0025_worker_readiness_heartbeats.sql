CREATE TABLE "operational_heartbeats" (
    "worker" varchar(40) NOT NULL,
    "instance_id" uuid NOT NULL,
    "status" varchar(20) NOT NULL,
    "details" jsonb,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "operational_heartbeats_worker_check"
        CHECK ("worker" IN ('malware-scan', 'srikandi')),
    CONSTRAINT "operational_heartbeats_status_check"
        CHECK ("status" IN ('running', 'degraded', 'stopped')),
    CONSTRAINT "operational_heartbeats_worker_instance_pk"
        PRIMARY KEY ("worker", "instance_id")
);
--> statement-breakpoint
CREATE INDEX "operational_heartbeats_last_seen_idx"
    ON "operational_heartbeats" ("last_seen_at");
--> statement-breakpoint
CREATE INDEX "operational_heartbeats_worker_seen_idx"
    ON "operational_heartbeats" ("worker", "last_seen_at");
