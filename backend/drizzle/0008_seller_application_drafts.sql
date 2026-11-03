CREATE TYPE "public"."seller_applicant_relationship" AS ENUM('owner', 'authorized_representative');--> statement-breakpoint
CREATE TYPE "public"."seller_application_status" AS ENUM('draft', 'submitted', 'changes_requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."seller_fulfillment_option" AS ENUM('pickup', 'local_delivery', 'both');--> statement-breakpoint
CREATE TYPE "public"."seller_inventory_condition" AS ENUM('new', 'used', 'both');--> statement-breakpoint
CREATE TYPE "public"."seller_registration_status" AS ENUM('registered', 'registration_pending', 'not_registered');--> statement-breakpoint
CREATE TYPE "public"."seller_type" AS ENUM('individual', 'commercial');--> statement-breakpoint
CREATE TABLE "seller_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "seller_application_status" DEFAULT 'draft' NOT NULL,
	"seller_type" "seller_type",
	"applicant_relationship" "seller_applicant_relationship",
	"proposed_store_name" varchar(120),
	"private_contact_phone" varchar(32),
	"city" varchar(100) DEFAULT 'Yaoundé',
	"neighborhood" varchar(100),
	"seller_description" varchar(500),
	"inventory_condition" "seller_inventory_condition",
	"fulfillment_option" "seller_fulfillment_option",
	"business_trading_name" varchar(150),
	"business_contact_name" varchar(100),
	"registration_status" "seller_registration_status",
	"registration_reference" varchar(100),
	"private_operating_address" varchar(250),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_applications_commercial_fields_require_commercial_type" CHECK ((
        COALESCE("seller_applications"."seller_type" = 'commercial', false)
        OR (
          "seller_applications"."business_trading_name" IS NULL
          AND "seller_applications"."business_contact_name" IS NULL
          AND "seller_applications"."registration_status" IS NULL
          AND "seller_applications"."registration_reference" IS NULL
          AND "seller_applications"."private_operating_address" IS NULL
        )
      )),
	CONSTRAINT "seller_applications_registration_reference_requires_registered_status" CHECK ((
        COALESCE("seller_applications"."registration_status" = 'registered', false)
        OR "seller_applications"."registration_reference" IS NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_applications_account_idx" ON "seller_applications" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_applications_one_active_per_account" ON "seller_applications" USING btree ("account_id") WHERE "seller_applications"."status" IN ('draft', 'submitted', 'changes_requested');