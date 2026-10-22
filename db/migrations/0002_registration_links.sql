CREATE TABLE "registration_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"registration_limit" integer,
	"registrations_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "registration_links_bounded" CHECK ("registration_links"."registration_limit" is not null or "registration_links"."expires_at" is not null),
	CONSTRAINT "registration_links_positive_limit" CHECK ("registration_links"."registration_limit" is null or "registration_links"."registration_limit">0),
	CONSTRAINT "registration_links_valid_count" CHECK ("registration_links"."registrations_count">=0 and ("registration_links"."registration_limit" is null or "registration_links"."registrations_count"<="registration_links"."registration_limit"))
);
--> statement-breakpoint
ALTER TABLE "registration_links" ADD CONSTRAINT "registration_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;