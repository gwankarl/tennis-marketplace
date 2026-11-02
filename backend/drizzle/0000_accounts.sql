CREATE TYPE "public"."account_status" AS ENUM('pending_email_verification', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_permission" AS ENUM('administrator');--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" "user_permission" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"status" "account_status" DEFAULT 'pending_email_verification' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"terms_accepted_version" varchar(64) NOT NULL,
	"terms_accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_first_name_not_blank" CHECK (length(btrim("users"."first_name")) > 0),
	CONSTRAINT "users_last_name_not_blank" CHECK (length(btrim("users"."last_name")) > 0),
	CONSTRAINT "users_email_not_blank" CHECK (length(btrim("users"."email")) > 0 AND "users"."email" = btrim("users"."email")),
	CONSTRAINT "users_password_hash_not_blank" CHECK (length(btrim("users"."password_hash")) > 0),
	CONSTRAINT "users_terms_version_not_blank" CHECK (length(btrim("users"."terms_accepted_version")) > 0),
	CONSTRAINT "users_active_requires_verified_email" CHECK ("users"."status" <> 'active' OR "users"."email_verified_at" IS NOT NULL),
	CONSTRAINT "users_pending_requires_unverified_email" CHECK ("users"."status" <> 'pending_email_verification' OR "users"."email_verified_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree (lower(btrim("email")));