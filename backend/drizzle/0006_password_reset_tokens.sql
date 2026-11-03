CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email_address" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_email_not_blank" CHECK (length(btrim("password_reset_tokens"."email_address")) > 0),
	CONSTRAINT "password_reset_tokens_hash_format" CHECK ("password_reset_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "password_reset_tokens_one_terminal_state" CHECK ("password_reset_tokens"."consumed_at" IS NULL OR "password_reset_tokens"."invalidated_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_account_idx" ON "password_reset_tokens" USING btree ("account_id");