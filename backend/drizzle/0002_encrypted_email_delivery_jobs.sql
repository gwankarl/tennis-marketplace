CREATE TYPE "public"."email_delivery_job_status" AS ENUM('pending', 'leased', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "email_delivery_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"verification_token_id" uuid NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"status" "email_delivery_job_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"encryption_key_id" varchar(64),
	"encrypted_payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_jobs_purpose_check" CHECK ("email_delivery_jobs"."purpose" = 'email_verification'),
	CONSTRAINT "email_delivery_jobs_attempt_count_bounded" CHECK ("email_delivery_jobs"."attempt_count" BETWEEN 0 AND 5),
	CONSTRAINT "email_delivery_jobs_lease_shape" CHECK ((
        "email_delivery_jobs"."status" = 'leased'
        AND "email_delivery_jobs"."lease_owner" IS NOT NULL
        AND "email_delivery_jobs"."lease_expires_at" IS NOT NULL
      ) OR (
        "email_delivery_jobs"."status" <> 'leased'
        AND "email_delivery_jobs"."lease_owner" IS NULL
        AND "email_delivery_jobs"."lease_expires_at" IS NULL
      )),
	CONSTRAINT "email_delivery_jobs_payload_matches_status" CHECK ((
        "email_delivery_jobs"."status" IN ('pending', 'leased')
        AND "email_delivery_jobs"."encryption_key_id" IS NOT NULL
        AND "email_delivery_jobs"."encrypted_payload" IS NOT NULL
      ) OR (
        "email_delivery_jobs"."status" IN ('sent', 'failed', 'cancelled')
        AND "email_delivery_jobs"."encryption_key_id" IS NULL
        AND "email_delivery_jobs"."encrypted_payload" IS NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ADD CONSTRAINT "email_delivery_jobs_verification_token_id_email_verification_tokens_id_fk" FOREIGN KEY ("verification_token_id") REFERENCES "public"."email_verification_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_jobs_token_unique" ON "email_delivery_jobs" USING btree ("verification_token_id");--> statement-breakpoint
CREATE INDEX "email_delivery_jobs_schedule_idx" ON "email_delivery_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "email_delivery_jobs_expiry_idx" ON "email_delivery_jobs" USING btree ("status","expires_at");