ALTER TABLE "email_delivery_jobs" DROP CONSTRAINT "email_delivery_jobs_purpose_check";--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ALTER COLUMN "verification_token_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ADD COLUMN "password_reset_token_id" uuid;--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ADD CONSTRAINT "email_delivery_jobs_password_reset_token_id_password_reset_tokens_id_fk" FOREIGN KEY ("password_reset_token_id") REFERENCES "public"."password_reset_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_jobs_password_reset_token_unique" ON "email_delivery_jobs" USING btree ("password_reset_token_id") WHERE "email_delivery_jobs"."password_reset_token_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ADD CONSTRAINT "email_delivery_jobs_token_purpose_check" CHECK ((
        "email_delivery_jobs"."purpose" = 'email_verification'
        AND "email_delivery_jobs"."verification_token_id" IS NOT NULL
        AND "email_delivery_jobs"."password_reset_token_id" IS NULL
      ) OR (
        "email_delivery_jobs"."purpose" = 'password_reset'
        AND "email_delivery_jobs"."verification_token_id" IS NULL
        AND "email_delivery_jobs"."password_reset_token_id" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "email_delivery_jobs" ADD CONSTRAINT "email_delivery_jobs_purpose_check" CHECK ("email_delivery_jobs"."purpose" IN ('email_verification', 'password_reset'));