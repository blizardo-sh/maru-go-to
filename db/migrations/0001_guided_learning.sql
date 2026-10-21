CREATE TABLE "learning_attempts" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_states" (
	"user_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"route_version" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_states_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_states" ADD CONSTRAINT "learning_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;