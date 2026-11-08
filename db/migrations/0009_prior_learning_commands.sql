CREATE TABLE prior_learning_commands (
 request_id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE prior_learning ADD COLUMN request_id uuid REFERENCES prior_learning_commands(request_id);
--> statement-breakpoint
CREATE TABLE prior_learning_lessons (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id text NOT NULL,
 request_id uuid NOT NULL REFERENCES prior_learning_commands(request_id), targets jsonb NOT NULL,
 PRIMARY KEY(user_id,lesson_id)
);
