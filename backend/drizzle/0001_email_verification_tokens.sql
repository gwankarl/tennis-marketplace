CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email_address" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_email_not_blank" CHECK (length(btrim("email_verification_tokens"."email_address")) > 0),
	CONSTRAINT "email_verification_tokens_hash_format" CHECK ("email_verification_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_verification_tokens_one_terminal_state" CHECK ("email_verification_tokens"."consumed_at" IS NULL OR "email_verification_tokens"."invalidated_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_hash_unique" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_account_idx" ON "email_verification_tokens" USING btree ("account_id");