CREATE TYPE "public"."login_rate_limit_scope" AS ENUM('ip', 'email');--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_sessions_credential_hash_format" CHECK ("user_sessions"."credential_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "user_sessions_expiry_after_creation" CHECK ("user_sessions"."absolute_expires_at" > "user_sessions"."created_at"),
	CONSTRAINT "user_sessions_activity_after_creation" CHECK ("user_sessions"."last_activity_at" >= "user_sessions"."created_at"),
	CONSTRAINT "user_sessions_revocation_after_creation" CHECK ("user_sessions"."revoked_at" IS NULL OR "user_sessions"."revoked_at" >= "user_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "login_attempt_counters" (
	"scope" "login_rate_limit_scope" NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "login_attempt_counters_pk" PRIMARY KEY("scope","key_hash"),
	CONSTRAINT "login_attempt_counters_key_hash_format" CHECK ("login_attempt_counters"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "login_attempt_counters_count_bounded" CHECK ("login_attempt_counters"."attempt_count" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" DROP CONSTRAINT "email_delivery_jobs_purpose_check";--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_credential_hash_unique" ON "user_sessions" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_active_expiry_idx" ON "user_sessions" USING btree ("absolute_expires_at") WHERE "user_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "login_attempt_counters_window_idx" ON "login_attempt_counters" USING btree ("window_started_at");--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ADD CONSTRAINT "email_delivery_jobs_purpose_check" CHECK ("email_delivery_jobs"."purpose" = 'email_verification');