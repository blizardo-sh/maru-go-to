CREATE TABLE "counter_progress" (
	"user_id" text NOT NULL,
	"counter_id" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counter_progress_user_id_counter_id_pk" PRIMARY KEY("user_id","counter_id")
);
--> statement-breakpoint
ALTER TABLE "counter_progress" ADD CONSTRAINT "counter_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;